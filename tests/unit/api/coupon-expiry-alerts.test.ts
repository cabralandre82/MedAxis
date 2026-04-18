// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationForRole: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/logger', () => loggerMock())

import * as adminModule from '@/lib/db/admin'
import * as notificationsModule from '@/lib/notifications'

const CRON_SECRET = 'test-cron-secret'

function makeRequest(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/coupon-expiry-alerts', {
    method: 'GET',
    headers: authHeader ? { authorization: `Bearer ${authHeader}` } : {},
  })
}

function couponsFrom({
  coupons = [] as unknown[],
  members = [{ user_id: 'user-1' }] as unknown[],
  queryError = null as null | Error,
}) {
  return (table: string) => {
    if (table === 'coupons') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({
          data: queryError ? null : coupons,
          error: queryError,
        }),
      }
    }
    if (table === 'clinic_members') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: members, error: null }),
      }
    }
    return {}
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

describe('GET /api/cron/coupon-expiry-alerts', () => {
  it('TC-EXPIRY-01: retorna 401 sem token', async () => {
    const { GET } = await import('@/app/api/cron/coupon-expiry-alerts/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('TC-EXPIRY-02: retorna 401 com token errado', async () => {
    const { GET } = await import('@/app/api/cron/coupon-expiry-alerts/route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('TC-EXPIRY-03: retorna 0 quando não há cupons expirando', async () => {
    const { GET } = await import('@/app/api/cron/coupon-expiry-alerts/route')
    const stub = attachCronGuard({ from: couponsFrom({ coupons: [] }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.notified).toBe(0)
  })

  it('TC-EXPIRY-04: notifica clínica e admin para cada cupom expirando', async () => {
    const { GET } = await import('@/app/api/cron/coupon-expiry-alerts/route')

    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const coupons = [
      {
        id: 'coupon-1',
        code: 'ABC123-DEF456',
        clinic_id: 'clinic-1',
        product_id: 'product-1',
        valid_until: expiresAt,
        products: { name: 'Produto A' },
        clinics: { trade_name: 'Clínica São Lucas' },
      },
    ]

    const stub = attachCronGuard({
      from: couponsFrom({
        coupons,
        members: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
      }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.notified).toBe(1)

    expect(notificationsModule.createNotification).toHaveBeenCalledTimes(2)
    expect(notificationsModule.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'COUPON_ASSIGNED',
        link: '/coupons',
      })
    )

    expect(notificationsModule.createNotificationForRole).toHaveBeenCalledWith(
      'SUPER_ADMIN',
      expect.objectContaining({ type: 'COUPON_ASSIGNED' })
    )
  })

  it('TC-EXPIRY-05: retorna 500 quando query falha', async () => {
    const { GET } = await import('@/app/api/cron/coupon-expiry-alerts/route')
    const stub = attachCronGuard({
      from: couponsFrom({ queryError: new Error('DB error') }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
  })
})
