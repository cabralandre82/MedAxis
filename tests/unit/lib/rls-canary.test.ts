// @vitest-environment node
/**
 * Unit tests for `lib/rls-canary.ts` (Wave 14).
 *
 * The runtime split — JWT forging in pure Node, RPC orchestration
 * via supabase-js — means we mock at three boundaries:
 *
 *   1. `@supabase/supabase-js`        → control the canary client.
 *   2. `@/lib/db/admin`               → control the recorder client.
 *   3. `@/lib/metrics`                → assert label cardinality.
 *
 * The HS256 signing is exercised against the real `node:crypto` so
 * we can decode the resulting JWT and verify `sub`, `role`, `iss`,
 * `exp` shape — that's the contract PostgREST will rely on in prod.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ── mocks ──────────────────────────────────────────────────────────────

const canaryRpcMock = vi.fn()
const adminRpcMock = vi.fn()
const adminFromMock = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: canaryRpcMock,
  }),
}))

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc: adminRpcMock,
    from: (t: string) => adminFromMock(t),
  }),
}))

const incCounter = vi.fn()
const setGauge = vi.fn()
const observeHistogram = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...a: unknown[]) => incCounter(...a),
    setGauge: (...a: unknown[]) => setGauge(...a),
    observeHistogram: (...a: unknown[]) => observeHistogram(...a),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_JWT_SECRET = 'test-secret-do-not-use-in-prod'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
  // Default: assertions return zero violations.
  canaryRpcMock.mockResolvedValue({
    data: [
      {
        table_name: 'orders',
        bucket: 'tenant',
        visible_rows: 0,
        expected_max: 0,
        violated: false,
        error_message: null,
      },
      {
        table_name: 'payments',
        bucket: 'tenant',
        visible_rows: 0,
        expected_max: 0,
        violated: false,
        error_message: null,
      },
    ],
    error: null,
  })
  adminRpcMock.mockResolvedValue({
    data: { id: 'log-row-uuid' },
    error: null,
  })
})

// ── signCanaryJwt ──────────────────────────────────────────────────────

describe('signCanaryJwt', () => {
  it('produces a valid HS256 JWT with sub/role/iss claims', async () => {
    const { signCanaryJwt } = await import('@/lib/rls-canary')
    const sub = '11111111-1111-4111-8111-111111111111'
    const jwt = signCanaryJwt(sub, 60)

    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)

    const [headerB64, payloadB64, sigB64] = parts
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payload.sub).toBe(sub)
    expect(payload.role).toBe('authenticated')
    expect(payload.aud).toBe('authenticated')
    expect(payload.iss).toBe('rls-canary')
    expect(payload.exp - payload.iat).toBe(60)

    // Verify signature manually with the known secret.
    const expectedSig = createHmac('sha256', 'test-secret-do-not-use-in-prod')
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')
    expect(sigB64).toBe(expectedSig)
  })

  it('throws when SUPABASE_JWT_SECRET is missing', async () => {
    delete process.env.SUPABASE_JWT_SECRET
    const { signCanaryJwt } = await import('@/lib/rls-canary')
    expect(() => signCanaryJwt('any-uuid')).toThrow(/SUPABASE_JWT_SECRET/)
  })
})

// ── canarySubjectUuid ──────────────────────────────────────────────────

describe('canarySubjectUuid', () => {
  it('returns a fresh UUID on every call', async () => {
    const { canarySubjectUuid } = await import('@/lib/rls-canary')
    const a = canarySubjectUuid()
    const b = canarySubjectUuid()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

// ── runCanary ──────────────────────────────────────────────────────────

describe('runCanary', () => {
  it('calls assert RPC with the forged subject and persists a 0-violation summary', async () => {
    const { runCanary } = await import('@/lib/rls-canary')
    const run = await runCanary()

    expect(run.violations).toBe(0)
    expect(run.tablesChecked).toBe(2)
    expect(canaryRpcMock).toHaveBeenCalledWith('rls_canary_assert', {
      p_subject_uuid: run.subject,
    })
    expect(adminRpcMock).toHaveBeenCalledWith(
      'rls_canary_record',
      expect.objectContaining({
        p_subject_uuid: run.subject,
        p_tables_checked: 2,
        p_violations: 0,
      })
    )

    expect(incCounter).toHaveBeenCalledWith('rls_canary_runs_total', { outcome: 'ok' })
    expect(setGauge).toHaveBeenCalledWith('rls_canary_tables_checked', 2)
    expect(setGauge).toHaveBeenCalledWith('rls_canary_last_success_ts', expect.any(Number))
    expect(observeHistogram).toHaveBeenCalledWith('rls_canary_duration_ms', expect.any(Number))
  })

  it('counts violations and emits the violation gauge', async () => {
    canaryRpcMock.mockResolvedValueOnce({
      data: [
        {
          table_name: 'orders',
          bucket: 'tenant',
          visible_rows: 5,
          expected_max: 0,
          violated: true,
          error_message: null,
        },
        {
          table_name: 'payments',
          bucket: 'tenant',
          visible_rows: 0,
          expected_max: 0,
          violated: false,
          error_message: null,
        },
      ],
      error: null,
    })
    const { runCanary } = await import('@/lib/rls-canary')
    const run = await runCanary()

    expect(run.violations).toBe(1)
    expect(incCounter).toHaveBeenCalledWith('rls_canary_runs_total', { outcome: 'violation' })
    expect(incCounter).toHaveBeenCalledWith('rls_canary_violations_total', {}, 1)
    expect(setGauge).toHaveBeenCalledWith('rls_canary_last_violation_ts', expect.any(Number))

    // Persist call should include only the violating row in details.
    const persistCall = adminRpcMock.mock.calls.find((c) => c[0] === 'rls_canary_record')!
    const details = persistCall[1].p_details
    expect(details.violating).toHaveLength(1)
    expect(details.violating[0]).toMatchObject({
      table: 'orders',
      bucket: 'tenant',
      visible_rows: 5,
    })
  })

  it('treats RPC error as a single violation and still attempts persistence', async () => {
    canaryRpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    })
    const { runCanary } = await import('@/lib/rls-canary')
    const run = await runCanary()

    expect(run.violations).toBe(1)
    expect(run.tablesChecked).toBe(0)
    expect(incCounter).toHaveBeenCalledWith('rls_canary_runs_total', { outcome: 'error' })
    expect(adminRpcMock).toHaveBeenCalledWith(
      'rls_canary_record',
      expect.objectContaining({ p_violations: 1 })
    )
    const call = adminRpcMock.mock.calls.find((c) => c[0] === 'rls_canary_record')!
    expect(call[1].p_details.rpc_error).toBe('connection refused')
  })

  it('caps the violating list to 50 to avoid jsonb bloat', async () => {
    const huge = Array.from({ length: 80 }, (_, i) => ({
      table_name: `t${i}`,
      bucket: 'tenant' as const,
      visible_rows: 1,
      expected_max: 0,
      violated: true,
      error_message: null,
    }))
    canaryRpcMock.mockResolvedValueOnce({ data: huge, error: null })

    const { runCanary } = await import('@/lib/rls-canary')
    await runCanary()

    const call = adminRpcMock.mock.calls.find((c) => c[0] === 'rls_canary_record')!
    expect(call[1].p_violations).toBe(80)
    expect(call[1].p_details.violating.length).toBe(50)
  })

  it('does not fail the run when persistence errors', async () => {
    adminRpcMock.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
    const { runCanary } = await import('@/lib/rls-canary')
    const run = await runCanary()
    expect(run.violations).toBe(0)
    expect(run.tablesChecked).toBe(2)
  })
})

// ── readLatestCanaryStatus ─────────────────────────────────────────────

describe('readLatestCanaryStatus', () => {
  it('returns null when ledger is empty (pre-migration)', async () => {
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    })
    const { readLatestCanaryStatus } = await import('@/lib/rls-canary')
    const result = await readLatestCanaryStatus()
    expect(result).toBeNull()
  })

  it('computes age and emits the age gauge', async () => {
    const ranAt = new Date(Date.now() - 3600 * 1000).toISOString()
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () => ({
          limit: () =>
            Promise.resolve({
              data: [{ ran_at: ranAt, violations: 0, tables_checked: 40 }],
              error: null,
            }),
        }),
      }),
    })
    const { readLatestCanaryStatus } = await import('@/lib/rls-canary')
    const result = await readLatestCanaryStatus()
    expect(result).not.toBeNull()
    expect(result!.lastRunAgeSeconds).toBeGreaterThanOrEqual(3599)
    expect(result!.lastRunAgeSeconds).toBeLessThanOrEqual(3601)
    expect(result!.lastViolations).toBe(0)
    expect(setGauge).toHaveBeenCalledWith('rls_canary_age_seconds', expect.any(Number))
  })

  it('throws on DB error', async () => {
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: 'denied' } }),
        }),
      }),
    })
    const { readLatestCanaryStatus } = await import('@/lib/rls-canary')
    await expect(readLatestCanaryStatus()).rejects.toThrow(/denied/)
  })
})
