// @vitest-environment node
/**
 * Unit tests for lib/dsar (Wave 9).
 *
 * Covers the four contracts every LGPD state-machine caller relies on:
 *
 *   1. `createDsarRequest()` inserts the correct row and surfaces
 *      the duplicate-open unique-constraint violation as a stable
 *      error code.
 *   2. `transitionDsarRequest()` forwards to the `dsar_transition`
 *      RPC with the correct payload shape, maps PL/pgSQL errors to
 *      stable enums, and emits counters/histograms.
 *   3. `hashCanonicalBundle()` is deterministic under key reorder,
 *      whitespace, `undefined` stripping, and nested arrays.
 *   4. `signCanonicalBundle` / `verifyCanonicalBundle` round-trip;
 *      fail closed on missing key; reject forged signatures in
 *      constant time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

const incCounter = vi.fn()
const observeHistogram = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...args: unknown[]) => incCounter(...args),
    observeHistogram: (...args: unknown[]) => observeHistogram(...args),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LGPD_EXPORT_HMAC_KEY', 'a'.repeat(48))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── createDsarRequest ───────────────────────────────────────────────────

describe('createDsarRequest', () => {
  function makeAdmin(result: { data?: unknown; error?: unknown }) {
    return {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }
  }

  it('returns inserted row and increments opened counter on success', async () => {
    const row = {
      id: 'aaaa',
      subject_user_id: 'u1',
      kind: 'EXPORT',
      status: 'RECEIVED',
      sla_due_at: '2099-01-01T00:00:00Z',
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({ data: row, error: null }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { createDsarRequest } = await import('@/lib/dsar')
    const out = await createDsarRequest({ subjectUserId: 'u1', kind: 'EXPORT' })
    expect(out.data?.id).toBe('aaaa')
    expect(incCounter).toHaveBeenCalledWith('dsar_opened_total', { kind: 'EXPORT' })
  })

  it('maps unique-constraint violation (23505) to duplicate_open', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { createDsarRequest } = await import('@/lib/dsar')
    const out = await createDsarRequest({ subjectUserId: 'u1', kind: 'ERASURE' })
    expect(out.data).toBeUndefined()
    expect(out.error?.reason).toBe('duplicate_open')
    expect(incCounter).toHaveBeenCalledWith('dsar_duplicate_open_total', { kind: 'ERASURE' })
  })

  it('returns db_error for unknown errors', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { code: '42P01', message: 'relation "dsar_requests" does not exist' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { createDsarRequest } = await import('@/lib/dsar')
    const out = await createDsarRequest({ subjectUserId: 'u1', kind: 'EXPORT' })
    expect(out.error?.reason).toBe('db_error')
  })
})

// ── transitionDsarRequest ───────────────────────────────────────────────

describe('transitionDsarRequest', () => {
  function makeAdmin(rpcResult: { data?: unknown; error?: unknown }) {
    return {
      rpc: vi.fn().mockResolvedValue(rpcResult),
    }
  }

  it('forwards correct shape to dsar_transition RPC on success', async () => {
    const admin = makeAdmin({ data: { id: 'r1', status: 'PROCESSING' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING', {
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      metadata: { note: 'triaged' },
    })

    expect(out.data?.status).toBe('PROCESSING')
    expect(admin.rpc).toHaveBeenCalledWith('dsar_transition', {
      p_request_id: 'r1',
      p_to_status: 'PROCESSING',
      p_args: {
        actor_user_id: 'admin-1',
        actor_role: 'SUPER_ADMIN',
        metadata: { note: 'triaged' },
      },
    })
    expect(incCounter).toHaveBeenCalledWith('dsar_transition_total', { to: 'PROCESSING' })
    expect(observeHistogram).toHaveBeenCalledWith('dsar_transition_duration_ms', expect.any(Number))
  })

  it('includes delivery_hash/ref/reject_code only when provided', async () => {
    const admin = makeAdmin({ data: { id: 'r1', status: 'FULFILLED' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { transitionDsarRequest } = await import('@/lib/dsar')
    await transitionDsarRequest('r1', 'FULFILLED', {
      actorUserId: 'u1',
      deliveryHash: 'abc',
      deliveryRef: 'ref-1',
    })
    const [, args] = admin.rpc.mock.calls[0]
    expect(args.p_args).toMatchObject({
      actor_user_id: 'u1',
      delivery_hash: 'abc',
      delivery_ref: 'ref-1',
    })
    expect(args.p_args).not.toHaveProperty('reject_code')
  })

  it('maps invalid transition message to invalid_transition', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'dsar_requests: invalid transition FULFILLED → PROCESSING' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING')
    expect(out.error?.reason).toBe('invalid_transition')
    expect(incCounter).toHaveBeenCalledWith('dsar_transition_error_total', {
      reason: 'invalid_transition',
      to: 'PROCESSING',
    })
  })

  it('maps reject_code required message', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'dsar_requests: reject_code required when status=REJECTED' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'REJECTED')
    expect(out.error?.reason).toBe('reject_code_required')
  })

  it('maps delivery_hash required message', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: {
          message: 'dsar_requests: delivery_hash and fulfilled_at required when FULFILLED',
        },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'FULFILLED')
    expect(out.error?.reason).toBe('delivery_hash_required')
  })

  it('maps direct update forbidden message', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'dsar_requests: direct UPDATE forbidden; use public.dsar_transition()' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING')
    expect(out.error?.reason).toBe('direct_update_forbidden')
  })

  it('maps append-only message', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'dsar_audit is append-only' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING')
    expect(out.error?.reason).toBe('audit_append_only')
  })

  it('maps not found message', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'dsar_transition: request abc not found' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING')
    expect(out.error?.reason).toBe('not_found')
  })

  it('falls back to unknown for unexpected errors', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({
        data: null,
        error: { message: 'connection timeout' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { transitionDsarRequest } = await import('@/lib/dsar')
    const out = await transitionDsarRequest('r1', 'PROCESSING')
    expect(out.error?.reason).toBe('unknown')
  })
})

// ── Canonicalization + hashing ──────────────────────────────────────────

describe('hashCanonicalBundle', () => {
  it('is deterministic across key reorder', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const a = hashCanonicalBundle({ b: 2, a: 1, c: [3, 2, 1] })
    const b = hashCanonicalBundle({ c: [3, 2, 1], a: 1, b: 2 })
    expect(a).toBe(b)
  })

  it('differs for different values', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    expect(hashCanonicalBundle({ a: 1 })).not.toBe(hashCanonicalBundle({ a: 2 }))
  })

  it('preserves array order (unlike key order)', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const a = hashCanonicalBundle({ xs: [1, 2] })
    const b = hashCanonicalBundle({ xs: [2, 1] })
    expect(a).not.toBe(b)
  })

  it('strips undefined values so they do not affect the hash', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const a = hashCanonicalBundle({ a: 1, b: undefined })
    const b = hashCanonicalBundle({ a: 1 })
    expect(a).toBe(b)
  })

  it('treats null and missing as distinct', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const a = hashCanonicalBundle({ a: 1, b: null })
    const b = hashCanonicalBundle({ a: 1 })
    expect(a).not.toBe(b)
  })

  it('recurses through nested objects', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const a = hashCanonicalBundle({ outer: { b: 2, a: 1 } })
    const b = hashCanonicalBundle({ outer: { a: 1, b: 2 } })
    expect(a).toBe(b)
  })

  it('produces 64-char hex SHA-256', async () => {
    const { hashCanonicalBundle } = await import('@/lib/dsar')
    const h = hashCanonicalBundle({ x: 1 })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── HMAC signing ────────────────────────────────────────────────────────

describe('signCanonicalBundle / verifyCanonicalBundle', () => {
  it('throws when HMAC key missing', async () => {
    vi.unstubAllEnvs()
    const { signCanonicalBundle } = await import('@/lib/dsar')
    expect(() => signCanonicalBundle({ a: 1 })).toThrow(/LGPD_EXPORT_HMAC_KEY/)
  })

  it('throws when HMAC key too short', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('LGPD_EXPORT_HMAC_KEY', 'short')
    const { signCanonicalBundle } = await import('@/lib/dsar')
    expect(() => signCanonicalBundle({ a: 1 })).toThrow(/LGPD_EXPORT_HMAC_KEY/)
  })

  it('produces sha256=<hex> signature', async () => {
    const { signCanonicalBundle } = await import('@/lib/dsar')
    const { signature, hash } = signCanonicalBundle({ x: 1 })
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('round-trips verification', async () => {
    const { signCanonicalBundle, verifyCanonicalBundle } = await import('@/lib/dsar')
    const payload = { user_id: 'u1', orders: [{ id: 'o1', total: 100 }] }
    const { signature } = signCanonicalBundle(payload)
    expect(verifyCanonicalBundle(payload, signature)).toBe(true)
  })

  it('verification rejects forged signature', async () => {
    const { verifyCanonicalBundle } = await import('@/lib/dsar')
    const payload = { user_id: 'u1' }
    expect(verifyCanonicalBundle(payload, 'sha256=' + 'f'.repeat(64))).toBe(false)
  })

  it('verification rejects wrong prefix', async () => {
    const { verifyCanonicalBundle } = await import('@/lib/dsar')
    expect(verifyCanonicalBundle({ a: 1 }, 'md5=xyz')).toBe(false)
  })

  it('verification rejects length mismatch', async () => {
    const { verifyCanonicalBundle } = await import('@/lib/dsar')
    expect(verifyCanonicalBundle({ a: 1 }, 'sha256=abc')).toBe(false)
  })

  it('tampered payload fails verification', async () => {
    const { signCanonicalBundle, verifyCanonicalBundle } = await import('@/lib/dsar')
    const orig = { user_id: 'u1', amount: 100 }
    const { signature } = signCanonicalBundle(orig)
    const tampered = { user_id: 'u1', amount: 101 }
    expect(verifyCanonicalBundle(tampered, signature)).toBe(false)
  })
})

// ── mapPostgresError ────────────────────────────────────────────────────

describe('mapPostgresError', () => {
  it('maps null/undefined to unknown', async () => {
    const { mapPostgresError } = await import('@/lib/dsar')
    expect(mapPostgresError(null)).toBe('unknown')
    expect(mapPostgresError(undefined)).toBe('unknown')
    expect(mapPostgresError('')).toBe('unknown')
  })

  it('handles case-insensitive matching', async () => {
    const { mapPostgresError } = await import('@/lib/dsar')
    expect(mapPostgresError('DSAR_TRANSITION: REQUEST abc NOT FOUND')).toBe('not_found')
  })

  it('maps bad_initial_state', async () => {
    const { mapPostgresError } = await import('@/lib/dsar')
    expect(mapPostgresError('dsar_requests: new rows must start in RECEIVED (got FULFILLED)')).toBe(
      'bad_initial_state'
    )
  })

  it('maps unknown_target_status', async () => {
    const { mapPostgresError } = await import('@/lib/dsar')
    expect(mapPostgresError('dsar_transition: unknown target status BOGUS')).toBe(
      'unknown_target_status'
    )
  })
})
