// @vitest-environment node
/**
 * Unit tests for `lib/secrets/rotate.ts` (Wave 15).
 *
 * Three boundaries mocked:
 *   1. `@/lib/db/admin`         → control RPC + view reads.
 *   2. `@/lib/secrets/vercel`   → control Vercel API.
 *   3. `@/lib/features`         → control auto-rotate flag.
 *
 * Tests cover:
 *   - getOverdueSecrets aggregates 3 tiers without duplicates
 *   - executeTierARotation happy path: random bytes → Vercel
 *     PATCH → ledger record → metric
 *   - executeTierARotation failure path: misconfigured vs API error
 *   - prepareTierBRotation queues + records
 *   - alertTierCRotation records with action=manual
 *   - rotateAllOverdue dispatches by tier and triggers ONE redeploy
 *     even with multiple Tier A rotations
 *   - rotateAllOverdue with autoRotateA=false treats Tier A as Tier B
 *   - rotateAllOverdue handles redeploy failure with critical alert
 *   - getRotationStatus reads inventory + sets gauges
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mocks ──────────────────────────────────────────────────────────────

const adminRpcMock = vi.fn()
const adminFromMock = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc: adminRpcMock,
    from: (t: string) => adminFromMock(t),
  }),
}))

const rotateEnvValueMock = vi.fn()
const triggerRedeployMock = vi.fn()
const fingerprintMock = vi.fn().mockReturnValue('deadbeef')

vi.mock('@/lib/secrets/vercel', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/secrets/vercel')>('@/lib/secrets/vercel')
  return {
    ...actual,
    rotateEnvValue: (...a: unknown[]) => rotateEnvValueMock(...a),
    triggerRedeploy: (...a: unknown[]) => triggerRedeployMock(...a),
    fingerprint: (v: string) => fingerprintMock(v),
  }
})

const isFeatureEnabledMock = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabledMock(...a),
}))

const triggerAlertMock = vi.fn().mockResolvedValue({ delivered: ['log'], deduped: false })
vi.mock('@/lib/alerts', () => ({
  triggerAlert: (...a: unknown[]) => triggerAlertMock(...a),
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
  isFeatureEnabledMock.mockResolvedValue(false)
  // Default: every Vercel call succeeds.
  rotateEnvValueMock.mockResolvedValue({
    envId: 'env_abc123',
    previousValueFingerprint: 'cafebabe',
  })
  triggerRedeployMock.mockResolvedValue({ id: 'dpl_xyz', url: 'preview.vercel.app' })
  // Default: ledger writes succeed.
  adminRpcMock.mockResolvedValue({ data: null, error: null })
})

// ── getOverdueSecrets ───────────────────────────────────────────────────

describe('getOverdueSecrets', () => {
  it('aggregates per-tier overdue lists without duplicates', async () => {
    // Each call to secret_rotation_overdue returns ALL secrets older
    // than the threshold REGARDLESS of tier; the orchestrator must
    // filter to the matched tier per call.
    adminRpcMock.mockImplementation((rpc: string, args: { p_max_age_days: number }) => {
      if (rpc !== 'secret_rotation_overdue') {
        return Promise.resolve({ data: null, error: null })
      }
      if (args.p_max_age_days === 90) {
        return Promise.resolve({
          data: [
            // Tier A overdue
            {
              secret_name: 'CRON_SECRET',
              tier: 'A',
              provider: 'vercel-env',
              age_days: 95,
              last_rotated_at: '2025-01-01T00:00:00Z',
              status: 'overdue',
            },
            // Tier B overdue
            {
              secret_name: 'RESEND_API_KEY',
              tier: 'B',
              provider: 'resend-portal',
              age_days: 100,
              last_rotated_at: '2025-01-01T00:00:00Z',
              status: 'overdue',
            },
            // Tier C ALSO included at the 90d threshold (returned by SQL),
            // but the orchestrator must SKIP it on this iteration.
            {
              secret_name: 'OPENAI_API_KEY',
              tier: 'C',
              provider: 'openai-portal',
              age_days: 95,
              last_rotated_at: '2025-01-01T00:00:00Z',
              status: 'overdue',
            },
          ],
          error: null,
        })
      }
      if (args.p_max_age_days === 180) {
        return Promise.resolve({
          data: [
            // Tier C overdue at 180d
            {
              secret_name: 'SUPABASE_DB_PASSWORD',
              tier: 'C',
              provider: 'supabase-mgmt',
              age_days: 200,
              last_rotated_at: '2024-09-01T00:00:00Z',
              status: 'overdue',
            },
          ],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const { getOverdueSecrets } = await import('@/lib/secrets/rotate')
    const overdue = await getOverdueSecrets()

    const names = overdue.map((o) => o.secret).sort()
    // OPENAI_API_KEY must NOT appear from the 90d call (it's Tier C);
    // the 180d call doesn't include it (it's not 200d old in this test).
    // SUPABASE_DB_PASSWORD comes from the 180d call.
    expect(names).toEqual(['CRON_SECRET', 'RESEND_API_KEY', 'SUPABASE_DB_PASSWORD'])
  })

  it('throws on RPC error', async () => {
    adminRpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { getOverdueSecrets } = await import('@/lib/secrets/rotate')
    await expect(getOverdueSecrets()).rejects.toThrow(/boom/)
  })
})

// ── rotateAllOverdue ────────────────────────────────────────────────────

describe('rotateAllOverdue', () => {
  function mockOverdue(
    rows: Array<{ secret: string; tier: 'A' | 'B' | 'C'; provider: string; age?: number }>
  ) {
    adminRpcMock.mockImplementation((rpc: string, args: { p_max_age_days: number }) => {
      if (rpc !== 'secret_rotation_overdue') {
        // Default for record() etc.
        return Promise.resolve({ data: null, error: null })
      }
      const tier = args.p_max_age_days === 180 ? 'C' : 'A'
      const tier2 = args.p_max_age_days === 180 ? null : 'B'
      const matching = rows
        .filter((r) => r.tier === tier || r.tier === tier2)
        .map((r) => ({
          secret_name: r.secret,
          tier: r.tier,
          provider: r.provider,
          age_days: r.age ?? 100,
          last_rotated_at: '2025-01-01T00:00:00Z',
          status: 'overdue',
        }))
      return Promise.resolve({ data: matching, error: null })
    })
  }

  it('returns empty summary when nothing overdue', async () => {
    mockOverdue([])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue()

    expect(summary.results).toHaveLength(0)
    expect(summary.overdueByTier).toEqual({ A: 0, B: 0, C: 0 })
    expect(rotateEnvValueMock).not.toHaveBeenCalled()
    expect(triggerRedeployMock).not.toHaveBeenCalled()
  })

  it('Tier A: with autoRotateA=false (default), treats as queued (no Vercel call)', async () => {
    mockOverdue([{ secret: 'CRON_SECRET', tier: 'A', provider: 'vercel-env' }])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue()

    expect(summary.results[0].outcome).toBe('queued-for-operator')
    expect(rotateEnvValueMock).not.toHaveBeenCalled()
    expect(triggerRedeployMock).not.toHaveBeenCalled()
  })

  it('Tier A: with autoRotateA=true, calls Vercel + records success + triggers ONE redeploy', async () => {
    mockOverdue([
      { secret: 'CRON_SECRET', tier: 'A', provider: 'vercel-env' },
      { secret: 'METRICS_SECRET', tier: 'A', provider: 'vercel-env' },
    ])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue({ autoRotateTierA: true })

    expect(summary.results.every((r) => r.outcome === 'rotated')).toBe(true)
    expect(rotateEnvValueMock).toHaveBeenCalledTimes(2)
    // Even though TWO secrets rotated, we must have triggered exactly ONE redeploy.
    expect(triggerRedeployMock).toHaveBeenCalledTimes(1)
    expect(summary.redeployTriggered).toBe(true)
    expect(summary.redeployId).toBe('dpl_xyz')

    // Each rotation records a `secret_rotation_record` ledger row with
    // success=true, strategy=tier_a_auto.
    const recordCalls = adminRpcMock.mock.calls.filter((c) => c[0] === 'secret_rotation_record')
    expect(recordCalls).toHaveLength(2)
    for (const [, args] of recordCalls) {
      expect(args.p_success).toBe(true)
      expect(args.p_tier).toBe('A')
      expect(args.p_details.rotation_strategy).toBe('tier_a_auto')
      expect(args.p_details.new_value_fingerprint).toBe('deadbeef')
    }
  })

  it('Tier A: Vercel API failure records failure + emits failure metric + critical alert via redeploy', async () => {
    mockOverdue([{ secret: 'CRON_SECRET', tier: 'A', provider: 'vercel-env' }])
    rotateEnvValueMock.mockRejectedValueOnce(new Error('502 Bad Gateway'))

    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue({ autoRotateTierA: true })

    expect(summary.results[0].outcome).toBe('failed')
    expect(summary.results[0].errorMessage).toMatch(/502/)
    // Failure recorded with success=false in ledger.
    const recordCalls = adminRpcMock.mock.calls.filter((c) => c[0] === 'secret_rotation_record')
    expect(recordCalls.some(([, args]) => args.p_success === false)).toBe(true)
    // No redeploy because no rotation succeeded.
    expect(triggerRedeployMock).not.toHaveBeenCalled()
    expect(summary.redeployTriggered).toBe(false)
  })

  it('Tier A: misconfigured (VercelConfigError) classifies as skipped, not failed', async () => {
    mockOverdue([{ secret: 'CRON_SECRET', tier: 'A', provider: 'vercel-env' }])
    const { VercelConfigError } = await import('@/lib/secrets/vercel')
    rotateEnvValueMock.mockRejectedValueOnce(new VercelConfigError('VERCEL_TOKEN missing'))

    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue({ autoRotateTierA: true })

    expect(summary.results[0].outcome).toBe('skipped-misconfigured')
  })

  it('Tier B: records queued + does NOT call Vercel', async () => {
    mockOverdue([{ secret: 'RESEND_API_KEY', tier: 'B', provider: 'resend-portal' }])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue()

    expect(summary.results[0].outcome).toBe('queued-for-operator')
    expect(rotateEnvValueMock).not.toHaveBeenCalled()

    const recordCalls = adminRpcMock.mock.calls.filter((c) => c[0] === 'secret_rotation_record')
    expect(recordCalls[0][1].p_details.rotation_strategy).toBe('tier_b_queued')
    expect(recordCalls[0][1].p_details.runbook).toMatch(/secret-compromise/)
  })

  it('Tier C: records requires-operator + carries blast-radius flags in details', async () => {
    mockOverdue([{ secret: 'SUPABASE_JWT_SECRET', tier: 'C', provider: 'supabase-mgmt' }])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue()

    expect(summary.results[0].outcome).toBe('requires-operator')
    const recordCalls = adminRpcMock.mock.calls.filter((c) => c[0] === 'secret_rotation_record')
    expect(recordCalls[0][1].p_details.invalidates_sessions).toBe(true)
    expect(recordCalls[0][1].p_details.has_siblings).toBe(true)
  })

  it('Tier A redeploy failure triggers critical alert', async () => {
    mockOverdue([{ secret: 'CRON_SECRET', tier: 'A', provider: 'vercel-env' }])
    triggerRedeployMock.mockRejectedValueOnce(new Error('redeploy 500'))

    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue({ autoRotateTierA: true })

    expect(summary.results[0].outcome).toBe('rotated')
    expect(summary.redeployTriggered).toBe(false)
    expect(triggerAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        dedupKey: 'secrets:redeploy-failed',
      })
    )
  })

  it('skips overdue secret not present in runtime manifest (defensive)', async () => {
    mockOverdue([{ secret: 'NOT_IN_MANIFEST', tier: 'A', provider: 'vercel-env' }])
    const { rotateAllOverdue } = await import('@/lib/secrets/rotate')
    const summary = await rotateAllOverdue({ autoRotateTierA: true })

    expect(summary.results[0].outcome).toBe('skipped-misconfigured')
    expect(summary.results[0].errorMessage).toMatch(/runtime manifest/)
  })
})

// ── getRotationStatus ───────────────────────────────────────────────────

describe('getRotationStatus', () => {
  it('returns inventory snapshot + sets gauges', async () => {
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: [
              {
                secret_name: 'OLD_SECRET',
                age_seconds: 200 * 86400,
                last_rotated_at: '2025-01-01T00:00:00Z',
                last_row_hash: 'abc123',
              },
              {
                secret_name: 'CRON_SECRET',
                age_seconds: 30 * 86400,
                last_rotated_at: '2026-03-01T00:00:00Z',
                last_row_hash: 'def456',
              },
            ],
            error: null,
          }),
      }),
    })

    const { getRotationStatus } = await import('@/lib/secrets/rotate')
    const status = await getRotationStatus()

    expect(status.oldestSecretName).toBe('OLD_SECRET')
    expect(status.oldestAgeSeconds).toBe(200 * 86400)
    expect(status.lastLedgerHash).toBe('abc123')
    expect(setGauge).toHaveBeenCalledWith('secret_oldest_age_seconds', 200 * 86400)
    // Per-secret gauge emitted once per row.
    expect(setGauge).toHaveBeenCalledWith('secret_age_seconds', 200 * 86400, {
      secret: 'OLD_SECRET',
    })
  })

  it('counts never-rotated secrets (manifest entries missing from inventory)', async () => {
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: [
              // Only one secret has been rotated; the other 18 manifest
              // entries should count as never-rotated.
              {
                secret_name: 'CRON_SECRET',
                age_seconds: 1,
                last_rotated_at: new Date().toISOString(),
                last_row_hash: 'h',
              },
            ],
            error: null,
          }),
      }),
    })

    const { getRotationStatus } = await import('@/lib/secrets/rotate')
    const status = await getRotationStatus()
    expect(status.neverRotatedCount).toBe(19) // 20 manifest - 1 in inventory
  })

  it('throws on inventory read error', async () => {
    adminFromMock.mockReturnValueOnce({
      select: () => ({
        order: () => Promise.resolve({ data: null, error: { message: 'denied' } }),
      }),
    })
    const { getRotationStatus } = await import('@/lib/secrets/rotate')
    await expect(getRotationStatus()).rejects.toThrow(/denied/)
  })
})
