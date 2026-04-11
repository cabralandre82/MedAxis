import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

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
  it('anonymizes stale inactive profiles', async () => {
    const staleProfile = { id: 'user-1', full_name: 'Old User', email: 'old@test.com' }

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [staleProfile], error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        // notifications and audit_logs
        return {
          delete: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.profilesAnonymized).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('counts purged notifications', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === 'notifications') {
          return {
            delete: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: 'n1' }, { id: 'n2' }], error: null }),
          }
        }
        // audit_logs
        return {
          delete: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.notificationsPurged).toBe(2)
  })

  it('records errors without throwing', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        delete: vi.fn().mockReturnThis(),
      })),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { enforceRetentionPolicy } = await import('@/lib/retention-policy')
    const result = await enforceRetentionPolicy()

    expect(result.errors.length).toBeGreaterThan(0)
  })
})
