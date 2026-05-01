// @vitest-environment node
/**
 * TC-COUP-GUARD-01 — guard de pricing_mode na criação de cupom (ADR-002).
 *
 * Verifica que `createCoupon` rejeita os 3 tipos novos
 * (FIRST_UNIT_DISCOUNT, TIER_UPGRADE, MIN_QTY_PERCENT) quando o produto
 * está em `pricing_mode='FIXED'`. É a Camada 1 da defesa profunda
 * (Camada 2: trigger `freeze_order_item_price`, mig-080).
 *
 * Sem este guard, um cupom novo associado a produto FIXED chegaria ao
 * branch legacy da trigger e cairia no `ELSE` (que assume FIXED-tipo),
 * aplicando matemática errada. INV-1..INV-4 dependem desse contrato.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── mocks ──────────────────────────────────────────────────────────────
const adminFromMock = vi.fn()
const adminClientMock = { from: adminFromMock }

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => adminClientMock,
}))
vi.mock('@/lib/auth/session', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/rbac', () => ({
  requireRole: vi.fn().mockResolvedValue({ id: 'actor-id', roles: ['SUPER_ADMIN'] }),
}))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  AuditAction: { CREATE: 'CREATE' },
  AuditEntity: { ORDER: 'ORDER' },
}))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/services/atomic.server', () => ({
  applyCouponAtomic: vi.fn(),
  recordAtomicFallback: vi.fn(),
  shouldUseAtomicRpc: vi.fn().mockReturnValue(false),
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

// ── helpers ────────────────────────────────────────────────────────────
const PROD_ID = '11111111-1111-1111-1111-111111111111'
const CLINIC_ID = '22222222-2222-2222-2222-222222222222'

/**
 * Builds a Supabase query-builder mock that, for a `select()` chain
 * followed by `.eq().eq()...maybeSingle()`, resolves to `result`.
 */
function makeQB(result: { data: unknown; error: unknown }) {
  const qb: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
  }
  return qb
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TC-COUP-GUARD-01 — pricing_mode guard em createCoupon', () => {
  it.each([
    ['FIRST_UNIT_DISCOUNT' as const, { discount_value: 100 }],
    ['TIER_UPGRADE' as const, { discount_value: 0, tier_promotion_steps: 2 }],
    ['MIN_QTY_PERCENT' as const, { discount_value: 10, min_quantity: 3 }],
  ])('rejeita tipo novo %s em produto FIXED', async (discount_type, extras) => {
    // Configura o admin mock: products select retorna FIXED.
    const productsQB = makeQB({
      data: { pricing_mode: 'FIXED', name: 'Produto Legacy' },
      error: null,
    })
    adminFromMock.mockImplementation((table: string) => {
      if (table === 'products') return productsQB
      throw new Error(`unexpected table read: ${table}`)
    })

    const { createCoupon } = await import('@/services/coupons')
    const result = await createCoupon({
      product_id: PROD_ID,
      clinic_id: CLINIC_ID,
      discount_type,
      ...extras,
    })

    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/só pode ser aplicado a produtos com preço por escala/)
    expect(result.error).toContain(discount_type)
    expect(result.coupon).toBeUndefined()
  })

  it('aceita PERCENT em produto FIXED (legacy path intacto)', async () => {
    // products select NÃO deve nem ser chamado pra PERCENT/FIXED.
    // Configuramos o resto do happy path: existing-coupon-check + insert + product fetch p/ notification + clinic fetch.
    const existingQB = makeQB({ data: null, error: null })
    const insertQB: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'new-coupon',
          code: 'X',
          product_id: PROD_ID,
          clinic_id: CLINIC_ID,
          doctor_id: null,
          discount_type: 'PERCENT',
          discount_value: 10,
          max_discount_amount: null,
          valid_from: new Date().toISOString(),
          valid_until: null,
          activated_at: null,
          active: true,
          created_by_user_id: 'actor-id',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          used_count: 0,
          min_quantity: 1,
          tier_promotion_steps: 0,
        },
        error: null,
      }),
    }
    const productNameQB = makeQB({ data: { name: 'Produto Qualquer' }, error: null })
    const clinicMembersQB: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const clinicTradeQB = makeQB({ data: { trade_name: 'Clínica X' }, error: null })

    let couponsCallIndex = 0
    let productsCallIndex = 0
    adminFromMock.mockImplementation((table: string) => {
      if (table === 'coupons') {
        couponsCallIndex += 1
        return couponsCallIndex === 1 ? existingQB : insertQB
      }
      if (table === 'products') {
        productsCallIndex += 1
        return productNameQB
      }
      if (table === 'clinic_members') return clinicMembersQB
      if (table === 'clinics') return clinicTradeQB
      throw new Error(`unexpected table: ${table}`)
    })

    const { createCoupon } = await import('@/services/coupons')
    const result = await createCoupon({
      product_id: PROD_ID,
      clinic_id: CLINIC_ID,
      discount_type: 'PERCENT',
      discount_value: 10,
    })

    expect(result.error).toBeUndefined()
    expect(result.coupon).toBeDefined()
    // Produto NÃO deve ter sido consultado para o guard quando type = PERCENT.
    // (consultas a products acontecem só pra notificação).
    expect(productsCallIndex).toBeLessThanOrEqual(1)
  })

  it('aceita TIER_UPGRADE em produto TIERED_PROFILE (caminho válido)', async () => {
    const productsGuardQB = makeQB({
      data: { pricing_mode: 'TIERED_PROFILE', name: 'Tirzepatida 60mg' },
      error: null,
    })
    const existingQB = makeQB({ data: null, error: null })
    const insertQB: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'new-coupon',
          code: 'X',
          product_id: PROD_ID,
          clinic_id: CLINIC_ID,
          doctor_id: null,
          discount_type: 'TIER_UPGRADE',
          discount_value: 0,
          max_discount_amount: null,
          valid_from: new Date().toISOString(),
          valid_until: null,
          activated_at: null,
          active: true,
          created_by_user_id: 'actor-id',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          used_count: 0,
          min_quantity: 1,
          tier_promotion_steps: 2,
        },
        error: null,
      }),
    }
    const productNameQB = makeQB({ data: { name: 'Tirzepatida 60mg' }, error: null })
    const clinicMembersQB: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const clinicTradeQB = makeQB({ data: { trade_name: 'Clínica X' }, error: null })

    let couponsCallIndex = 0
    let productsCallIndex = 0
    adminFromMock.mockImplementation((table: string) => {
      if (table === 'products') {
        productsCallIndex += 1
        return productsCallIndex === 1 ? productsGuardQB : productNameQB
      }
      if (table === 'coupons') {
        couponsCallIndex += 1
        return couponsCallIndex === 1 ? existingQB : insertQB
      }
      if (table === 'clinic_members') return clinicMembersQB
      if (table === 'clinics') return clinicTradeQB
      throw new Error(`unexpected table: ${table}`)
    })

    const { createCoupon } = await import('@/services/coupons')
    const result = await createCoupon({
      product_id: PROD_ID,
      clinic_id: CLINIC_ID,
      discount_type: 'TIER_UPGRADE',
      discount_value: 0,
      tier_promotion_steps: 2,
    })

    expect(result.error).toBeUndefined()
    expect(result.coupon).toBeDefined()
    // O guard precisa ter consultado pricing_mode pelo menos uma vez.
    expect(productsGuardQB.select).toHaveBeenCalled()
  })

  it('rejeita quando o produto não existe (defensivo)', async () => {
    const productsQB = makeQB({ data: null, error: null })
    adminFromMock.mockImplementation((table: string) => {
      if (table === 'products') return productsQB
      throw new Error(`unexpected table: ${table}`)
    })

    const { createCoupon } = await import('@/services/coupons')
    const result = await createCoupon({
      product_id: PROD_ID,
      clinic_id: CLINIC_ID,
      discount_type: 'TIER_UPGRADE',
      discount_value: 0,
      tier_promotion_steps: 2,
    })

    expect(result.error).toMatch(/Produto não encontrado/)
  })
})
