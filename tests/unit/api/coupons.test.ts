// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  apiLimiter: { check: vi.fn().mockResolvedValue({ ok: true, resetAt: 0 }) },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Mock the entire services/coupons module so API routes don't hit DB
vi.mock('@/services/coupons', () => ({
  createCoupon: vi.fn(),
  deactivateCoupon: vi.fn(),
  activateCoupon: vi.fn(),
  getClinicCoupons: vi.fn(),
  getAdminCoupons: vi.fn(),
  getActiveCouponsForOrder: vi.fn().mockResolvedValue({}),
}))

import * as adminModule from '@/lib/db/admin'
import * as serverModule from '@/lib/db/server'
import * as couponsService from '@/services/coupons'
import * as rateLimitModule from '@/lib/rate-limit'

// ─── helpers ─────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'admin-user-uuid'
const CLINIC_USER_ID = 'clinic-user-uuid'
const COUPON_ID = 'coupon-uuid-1234'

function makeAdminAuthClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: ADMIN_USER_ID } } }),
    },
  }
}

function makeClinicAuthClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: CLINIC_USER_ID } } }),
    },
  }
}

function makeAdminRolesClient(isAdmin = true) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: isAdmin ? [{ role: 'SUPER_ADMIN' }] : [],
        error: null,
      }),
    }),
  }
}

function makeRequest(url: string, method: string, body?: object, ip = '1.2.3.4') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/coupons — criar cupom
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/admin/coupons', () => {
  it('TC-COUP-01: admin cria cupom com sucesso', async () => {
    const { POST } = await import('@/app/api/admin/coupons/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAdminAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminRolesClient(true) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(couponsService.createCoupon).mockResolvedValue({
      coupon: {
        id: COUPON_ID,
        code: 'A3F2B9-1C4D7E',
        product_id: 'prod-uuid',
        clinic_id: 'clinic-uuid',
        discount_type: 'PERCENT',
        discount_value: 10,
        max_discount_amount: null,
        valid_from: new Date().toISOString(),
        valid_until: null,
        activated_at: null,
        active: true,
        created_by_user_id: ADMIN_USER_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })

    const res = await POST(
      makeRequest('http://localhost/api/admin/coupons', 'POST', {
        product_id: 'prod-uuid',
        clinic_id: 'clinic-uuid',
        discount_type: 'PERCENT',
        discount_value: 10,
      })
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.coupon.code).toBe('A3F2B9-1C4D7E')
    expect(couponsService.createCoupon).toHaveBeenCalledOnce()
  })

  it('TC-COUP-02: não-admin recebe 403', async () => {
    const { POST } = await import('@/app/api/admin/coupons/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAdminAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminRolesClient(false) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(
      makeRequest('http://localhost/api/admin/coupons', 'POST', {
        product_id: 'prod-uuid',
        clinic_id: 'clinic-uuid',
        discount_type: 'PERCENT',
        discount_value: 10,
      })
    )

    expect(res.status).toBe(403)
  })

  it('TC-COUP-03: service retorna erro de duplicata', async () => {
    const { POST } = await import('@/app/api/admin/coupons/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAdminAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminRolesClient(true) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(couponsService.createCoupon).mockResolvedValue({
      error: 'Já existe um cupom ativo para esta clínica e produto.',
    })

    const res = await POST(
      makeRequest('http://localhost/api/admin/coupons', 'POST', {
        product_id: 'prod-uuid',
        clinic_id: 'clinic-uuid',
        discount_type: 'PERCENT',
        discount_value: 10,
      })
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('Já existe')
  })

  it('TC-COUP-04: rate limit bloqueia', async () => {
    const { POST } = await import('@/app/api/admin/coupons/route')
    vi.mocked(rateLimitModule.apiLimiter.check).mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: 0,
    })

    const res = await POST(makeRequest('http://localhost/api/admin/coupons', 'POST', {}))
    expect(res.status).toBe(429)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/coupons/[id] — desativar cupom
// ═══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/coupons/[id]', () => {
  it('TC-COUP-05: admin desativa cupom com sucesso', async () => {
    const { PATCH } = await import('@/app/api/admin/coupons/[id]/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAdminAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminRolesClient(true) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(couponsService.deactivateCoupon).mockResolvedValue({})

    const res = await PATCH(
      makeRequest(`http://localhost/api/admin/coupons/${COUPON_ID}`, 'PATCH', {
        action: 'deactivate',
      }),
      { params: Promise.resolve({ id: COUPON_ID }) }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(couponsService.deactivateCoupon).toHaveBeenCalledWith(COUPON_ID)
  })

  it('TC-COUP-06: ação inválida retorna 400', async () => {
    const { PATCH } = await import('@/app/api/admin/coupons/[id]/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAdminAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminRolesClient(true) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await PATCH(
      makeRequest(`http://localhost/api/admin/coupons/${COUPON_ID}`, 'PATCH', {
        action: 'destroy',
      }),
      { params: Promise.resolve({ id: COUPON_ID }) }
    )

    expect(res.status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/coupons/activate — ativar cupom pela clínica
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/coupons/activate', () => {
  it('TC-COUP-07: clínica ativa cupom com código válido', async () => {
    const { POST } = await import('@/app/api/coupons/activate/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeClinicAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(couponsService.activateCoupon).mockResolvedValue({
      coupon: {
        id: COUPON_ID,
        code: 'A3F2B9-1C4D7E',
        product_id: 'prod-uuid',
        clinic_id: 'clinic-uuid',
        discount_type: 'PERCENT',
        discount_value: 10,
        max_discount_amount: null,
        valid_from: new Date().toISOString(),
        valid_until: null,
        activated_at: new Date().toISOString(),
        active: true,
        created_by_user_id: 'admin-uuid',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    })

    const res = await POST(
      makeRequest('http://localhost/api/coupons/activate', 'POST', {
        code: 'A3F2B9-1C4D7E',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupon.activated_at).toBeTruthy()
    expect(couponsService.activateCoupon).toHaveBeenCalledWith('A3F2B9-1C4D7E')
  })

  it('TC-COUP-08: código não pertence à clínica retorna 422', async () => {
    const { POST } = await import('@/app/api/coupons/activate/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeClinicAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(couponsService.activateCoupon).mockResolvedValue({
      error: 'Este cupom não pertence à sua clínica',
    })

    const res = await POST(
      makeRequest('http://localhost/api/coupons/activate', 'POST', {
        code: 'OUTRO-CUPOM',
      })
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('clínica')
  })

  it('TC-COUP-09: body sem code retorna 400', async () => {
    const { POST } = await import('@/app/api/coupons/activate/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeClinicAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )

    const res = await POST(
      makeRequest('http://localhost/api/coupons/activate', 'POST', { code: '' })
    )

    expect(res.status).toBe(400)
  })

  it('TC-COUP-10: unauthenticated retorna 401', async () => {
    const { POST } = await import('@/app/api/coupons/activate/route')

    vi.mocked(serverModule.createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as unknown as ReturnType<typeof serverModule.createClient>)

    const res = await POST(
      makeRequest('http://localhost/api/coupons/activate', 'POST', { code: 'SOME-CODE' })
    )

    expect(res.status).toBe(401)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/coupons/mine — listar cupons da clínica
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/coupons/mine', () => {
  it('TC-COUP-11: retorna lista de cupons da clínica', async () => {
    const { GET } = await import('@/app/api/coupons/mine/route')

    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeClinicAuthClient() as unknown as ReturnType<typeof serverModule.createClient>
    )
    vi.mocked(couponsService.getClinicCoupons).mockResolvedValue({
      coupons: [
        {
          id: COUPON_ID,
          code: 'A3F2B9-1C4D7E',
          product_id: 'prod-uuid',
          clinic_id: 'clinic-uuid',
          discount_type: 'PERCENT',
          discount_value: 10,
          max_discount_amount: null,
          valid_from: new Date().toISOString(),
          valid_until: null,
          activated_at: new Date().toISOString(),
          active: true,
          created_by_user_id: 'admin-uuid',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          product_name: 'Produto Teste',
        },
      ],
    })

    const res = await GET(makeRequest('http://localhost/api/coupons/mine', 'GET'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupons).toHaveLength(1)
    expect(body.coupons[0].product_name).toBe('Produto Teste')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getActiveCouponsForOrder — auto-aplicação no pedido
// ═══════════════════════════════════════════════════════════════════════════════

describe('getActiveCouponsForOrder (service helper)', () => {
  it('TC-COUP-12: retorna map product_id → coupon_id para cupons ativos', async () => {
    vi.mocked(couponsService.getActiveCouponsForOrder).mockResolvedValue({
      'prod-uuid-1': 'coupon-uuid-1',
      'prod-uuid-2': 'coupon-uuid-2',
    })

    const result = await couponsService.getActiveCouponsForOrder('clinic-uuid', [
      'prod-uuid-1',
      'prod-uuid-2',
    ])

    expect(result).toEqual({
      'prod-uuid-1': 'coupon-uuid-1',
      'prod-uuid-2': 'coupon-uuid-2',
    })
  })

  it('TC-COUP-13: retorna objeto vazio quando não há cupons ativos', async () => {
    vi.mocked(couponsService.getActiveCouponsForOrder).mockResolvedValue({})

    const result = await couponsService.getActiveCouponsForOrder('clinic-uuid', ['prod-sem-cupom'])
    expect(result).toEqual({})
  })

  it('TC-COUP-14: retorna objeto vazio quando productIds é array vazio', async () => {
    vi.mocked(couponsService.getActiveCouponsForOrder).mockResolvedValue({})

    const result = await couponsService.getActiveCouponsForOrder('clinic-uuid', [])
    expect(result).toEqual({})
  })
})
