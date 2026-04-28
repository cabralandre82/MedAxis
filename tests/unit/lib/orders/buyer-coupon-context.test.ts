import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'
import * as couponsService from '@/services/coupons'
import { resolveBuyerCouponPreview } from '@/lib/orders/buyer-coupon-context'
import type { ProfileWithRoles } from '@/types'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/services/coupons', () => ({
  getActiveCouponsByProductForBuyer: vi.fn().mockResolvedValue({}),
}))

/**
 * Pin the buyer-resolution contract used by /catalog, /catalog/[slug]
 * and /orders/new.
 *
 * Why these tests matter: the bug behind the regression-audit fix #1
 * follow-up was three different code paths each rolling their own
 * "who is the buyer for coupon purposes?" lookup, with one of them
 * accidentally skipping the doctor branch. Centralising the helper
 * is only useful if the helper itself is tight — these tests are
 * the gate.
 */

function makeUser(overrides: Partial<ProfileWithRoles> = {}): ProfileWithRoles {
  return {
    id: 'user-1',
    full_name: 'User',
    email: 'user@test.com',
    is_active: true,
    registration_status: 'APPROVED',
    notification_preferences: {},
    roles: ['CLINIC_ADMIN'],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as ProfileWithRoles
}

function adminWithRows(rows: Record<string, unknown> | null) {
  // Generic mock: every `from(...).select(...).eq(...).maybeSingle()`
  // returns the same row. Sufficient for both clinic_members and
  // doctors lookups.
  const maybeSingle = vi.fn().mockResolvedValue({ data: rows, error: null })
  const or = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ maybeSingle, or })
  const select = vi.fn().mockReturnValue({ eq, or })
  return { from: vi.fn().mockReturnValue({ select }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveBuyerCouponPreview', () => {
  it('returns empty map for anonymous user', async () => {
    const result = await resolveBuyerCouponPreview(null, ['p-1', 'p-2'])
    expect(result).toEqual({})
    // Critical: never even touches the DB or the coupons service when
    // there is no user to resolve.
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })

  it('returns empty map when productIds is empty', async () => {
    const user = makeUser()
    const result = await resolveBuyerCouponPreview(user, [])
    expect(result).toEqual({})
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })

  it('returns empty map for PHARMACY_ADMIN (buyer-only feature)', async () => {
    const user = makeUser({ roles: ['PHARMACY_ADMIN'] })
    const result = await resolveBuyerCouponPreview(user, ['p-1'])
    expect(result).toEqual({})
    // Hard guarantee: pharmacy never queries buyer coupons. If this
    // assertion fails the verifier is leaking buyer pricing into a
    // pharmacy surface.
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })

  it('resolves CLINIC_ADMIN → clinic_id and forwards to coupons service', async () => {
    const user = makeUser({ roles: ['CLINIC_ADMIN'] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminWithRows({ clinic_id: 'clinic-99' }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    vi.mocked(couponsService.getActiveCouponsByProductForBuyer).mockResolvedValue({
      'p-1': {
        id: 'cup-1',
        code: 'SAVE10',
        discount_type: 'PERCENT',
        discount_value: 10,
        max_discount_amount: null,
        valid_until: null,
      },
    })

    const result = await resolveBuyerCouponPreview(user, ['p-1', 'p-2'])
    expect(result['p-1']?.code).toBe('SAVE10')
    expect(couponsService.getActiveCouponsByProductForBuyer).toHaveBeenCalledWith({
      clinicId: 'clinic-99',
      doctorId: null,
      productIds: ['p-1', 'p-2'],
    })
  })

  it('resolves DOCTOR → doctor_id (not clinic_id) and forwards', async () => {
    const user = makeUser({ roles: ['DOCTOR'] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminWithRows({ id: 'doc-7' }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(couponsService.getActiveCouponsByProductForBuyer).mockResolvedValue({})

    await resolveBuyerCouponPreview(user, ['p-1'])
    expect(couponsService.getActiveCouponsByProductForBuyer).toHaveBeenCalledWith({
      clinicId: null,
      doctorId: 'doc-7',
      productIds: ['p-1'],
    })
  })

  it('returns empty map when CLINIC_ADMIN has no membership row yet', async () => {
    const user = makeUser({ roles: ['CLINIC_ADMIN'] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminWithRows(null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await resolveBuyerCouponPreview(user, ['p-1'])
    expect(result).toEqual({})
    // No buyer resolved → no coupon query (guards against passing
    // null clinicId AND null doctorId, which the underlying RPC
    // guards against, but cheap to short-circuit here too).
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })

  it('returns empty map when DOCTOR has no doctor row (yet to onboard)', async () => {
    const user = makeUser({ roles: ['DOCTOR'] })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminWithRows(null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await resolveBuyerCouponPreview(user, ['p-1'])
    expect(result).toEqual({})
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })

  it('user with both PHARMACY_ADMIN and CLINIC_ADMIN is treated as pharmacy (least-privilege)', async () => {
    // Edge case: a user wearing two hats. The pharmacy gate must win
    // because the consequence of a pharmacy seeing buyer pricing is a
    // financial-info leak (see view-mode.ts ranking), while the
    // consequence of a clinic admin missing a coupon preview is a
    // mild UX miss.
    const user = makeUser({ roles: ['CLINIC_ADMIN', 'PHARMACY_ADMIN'] })
    const result = await resolveBuyerCouponPreview(user, ['p-1'])
    expect(result).toEqual({})
    expect(couponsService.getActiveCouponsByProductForBuyer).not.toHaveBeenCalled()
  })
})
