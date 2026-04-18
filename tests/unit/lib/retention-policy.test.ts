import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

// Wave 13 — retention-policy now consults legal-hold and the
// feature flag. Default mocks: nothing is held, flag OFF. The
// `isUnderLegalHold` mock accepts the optional Map cache arg.
vi.mock('@/lib/legal-hold', () => ({
  isUnderLegalHold: vi.fn().mockResolvedValue(false),
  recordPurgeBlocked: vi.fn(),
  expireStaleHolds: vi.fn().mockResolvedValue({ expired: 0 }),
  refreshActiveHoldGauge: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getRetentionDates', () => {
  it('returns correct dates for a given creation timestamp', async () => {
    const { getRetentionDates } = await import('@/lib/retention-policy')
    const base = new Date('2020-01-01T00:00:00Z')
    const dates = getRetentionDates(base)

    // 5 years from 2020 = 2024 or 2025 depending on leap year rounding
    const personalYear = dates.personal_data_purge.getFullYear()
    expect(personalYear).toBeGreaterThanOrEqual(2024)
    expect(personalYear).toBeLessThanOrEqual(2025)

    const auditYear = dates.audit_log_purge.getFullYear()
    expect(auditYear).toBeGreaterThanOrEqual(2024)
    expect(auditYear).toBeLessThanOrEqual(2025)

    // 10 years from 2020 = 2029 or 2030
    const financialYear = dates.financial_data_purge.getFullYear()
    expect(financialYear).toBeGreaterThanOrEqual(2029)
    expect(financialYear).toBeLessThanOrEqual(2030)
  })
})

describe('enforceRetentionPolicy', () => {
  // Wave 3: retention now delegates audit_logs purge to the
  // audit_purge_retention RPC (append-only via migration 046).
  function mockRpc(
    result: { data?: unknown; error?: unknown } = {
      data: [{ purged_count: 0, checkpoint_id: null }],
      error: null,
    }
  ) {
    return vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  }

  /**
   * Factory for a Supabase admin stub that handles the 3 tables the
   * retention policy touches post-Wave-13:
   *   profiles.select.eq.lt.not  → list stale
   *   profiles.update.eq         → anonymise
   *   notifications.select.lt.limit → list candidates
   *   notifications.delete.in.select → remove
   */
  function makeRetentionAdmin({
    profiles = [] as Array<{ id: string; full_name?: string; email?: string }>,
    notifications = [] as Array<{ id: string; user_id: string | null }>,
    rpc = mockRpc(),
  }: {
    profiles?: Array<{ id: string; full_name?: string; email?: string }>
    notifications?: Array<{ id: string; user_id: string | null }>
    rpc?: ReturnType<typeof mockRpc>
  }) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          const profileChain: Record<string, unknown> = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: profiles, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
          return profileChain
        }
        if (table === 'notifications') {
          return {
            select: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: notifications, error: null }),
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: notifications, error: null }),
              }),
            }),
          }
        }
        return {}
      }),
      rpc,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>
  }

  it('anonymizes stale inactive profiles', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeRetentionAdmin({ profiles: [{ id: 'user-1', full_name: 'Old', email: 'old@x' }] })
    )

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.profilesAnonymized).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('counts purged notifications', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeRetentionAdmin({
        notifications: [
          { id: 'n1', user_id: 'u1' },
          { id: 'n2', user_id: 'u2' },
        ],
      })
    )

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.notificationsPurged).toBe(2)
  })

  it('counts purged audit logs via audit_purge_retention RPC', async () => {
    const rpcMock = mockRpc({
      data: [{ purged_count: 7, checkpoint_id: 42, held_count: 0 }],
      error: null,
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(makeRetentionAdmin({ rpc: rpcMock }))

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.auditLogsPurged).toBe(7)
    expect(rpcMock).toHaveBeenCalledWith(
      'audit_purge_retention',
      expect.objectContaining({
        p_exclude_entity_types: ['PAYMENT', 'COMMISSION', 'TRANSFER', 'CONSULTANT_TRANSFER'],
      })
    )
  })

  it('surfaces held_count from the RPC', async () => {
    const rpcMock = mockRpc({
      data: [{ purged_count: 5, checkpoint_id: 88, held_count: 2 }],
      error: null,
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(makeRetentionAdmin({ rpc: rpcMock }))

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.auditLogsHeldByLegalHold).toBe(2)
  })

  it('skips profiles under active hold when enforce flag is ON', async () => {
    const legalHoldMod = await import('@/lib/legal-hold')
    const featuresMod = await import('@/lib/features')
    vi.mocked(legalHoldMod.isUnderLegalHold).mockResolvedValue(true)
    vi.mocked(featuresMod.isFeatureEnabled).mockImplementation(
      async (key: string) => key === 'legal_hold.block_purge'
    )

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeRetentionAdmin({
        profiles: [{ id: 'held-user', full_name: 'H', email: 'h@x' }],
      })
    )

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.profilesAnonymized).toBe(0)
    expect(result.profilesHeldByLegalHold).toBe(1)
  })

  it('records audit_logs errors without throwing when RPC fails', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeRetentionAdmin({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'DELETE forbidden' } }),
      })
    )

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.errors.some((e) => e.includes('audit_logs'))).toBe(true)
  })
})
