import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'
import {
  computeUnitPrice,
  resolveEffectiveFloor,
  buildPricingMatrix,
  previewUnitPrice,
  buildCouponImpactMatrix,
  type CouponVariant,
} from '@/lib/services/pricing-engine.server'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))

const PRODUCT_ID = '22222222-2222-2222-2222-222222222222'
const CLINIC_ID = '33333333-3333-3333-3333-333333333333'

function mockRpc(impl: ReturnType<typeof vi.fn>) {
  vi.mocked(adminModule.createAdminClient).mockReturnValue({
    rpc: impl,
  } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  return impl
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── computeUnitPrice ─────────────────────────────────────────────────────

describe('computeUnitPrice', () => {
  it('returns the breakdown on the happy path', async () => {
    const rpc = mockRpc(
      vi.fn().mockResolvedValue({
        data: {
          pricing_profile_id: 'p-1',
          tier_id: 't-1',
          tier_unit_cents: 150000,
          pharmacy_cost_unit_cents: 50000,
          effective_floor_cents: 50000,
          floor_breakdown: {
            floor_cents: 50000,
            source: 'product',
            profile_id: 'p-1',
            floor_abs_cents: 12000,
            floor_pct_cents: 12000,
          },
          coupon_id: null,
          coupon_disc_per_unit_raw_cents: 0,
          coupon_disc_per_unit_capped_cents: 0,
          coupon_capped: false,
          final_unit_price_cents: 150000,
          platform_commission_per_unit_cents: 100000,
          consultant_basis: 'TOTAL_PRICE',
          consultant_per_unit_raw_cents: 7500,
          consultant_per_unit_cents: 7500,
          consultant_capped: false,
          quantity: 1,
          final_total_cents: 150000,
          pharmacy_transfer_cents: 50000,
          platform_commission_total_cents: 100000,
          consultant_commission_total_cents: 7500,
        },
        error: null,
      })
    )

    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error).toBeUndefined()
    expect(res.data?.final_unit_price_cents).toBe(150000)
    // p_at is intentionally OMITTED when args.at is null/undefined.
    // PostgREST forwards JSON null literally, which bypasses the SQL
    // function's `DEFAULT now()` and produces a spurious
    // `no_active_profile`. Smoke 2026-04-30 catch — see migration 078.
    expect(rpc).toHaveBeenCalledWith('compute_unit_price', {
      p_product_id: PRODUCT_ID,
      p_quantity: 1,
      p_clinic_id: null,
      p_doctor_id: null,
      p_coupon_id: null,
    })
  })

  it('forwards p_at when caller provides it (PostgREST keeps explicit value)', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: { error: null }, error: null }))
    await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1, at: '2026-04-30T19:00:00Z' })
    expect(rpc).toHaveBeenCalledWith(
      'compute_unit_price',
      expect.objectContaining({ p_at: '2026-04-30T19:00:00Z' })
    )
  })

  it('OMITS p_at when caller passes null/undefined (regression guard for mig-078)', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: { error: null }, error: null }))
    await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1, at: null })
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args).not.toHaveProperty('p_at')
  })

  it('translates inline {error: no_active_profile} to a typed reason', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: { error: 'no_active_profile' },
        error: null,
      })
    )

    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.data).toBeUndefined()
    expect(res.error?.reason).toBe('no_active_profile')
  })

  it('translates inline {error: no_tier_for_quantity}', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: { error: 'no_tier_for_quantity', profile_id: 'p-1', quantity: 999 },
        error: null,
      })
    )

    const res = await computeUnitPrice({
      productId: PRODUCT_ID,
      quantity: 999,
      clinicId: CLINIC_ID,
    })
    expect(res.error?.reason).toBe('no_tier_for_quantity')
  })

  it('rejects invalid quantity client-side without hitting RPC', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 0 })
    expect(res.error?.reason).toBe('invalid_quantity')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps Supabase RPC error to rpc_unavailable', async () => {
    mockRpc(
      vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      })
    )
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error?.reason).toBe('rpc_unavailable')
  })

  it('maps thrown RPC to rpc_unavailable', async () => {
    mockRpc(vi.fn().mockRejectedValue(new Error('boom')))
    const res = await computeUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    expect(res.error?.reason).toBe('rpc_unavailable')
  })
})

// ── resolveEffectiveFloor ────────────────────────────────────────────────

describe('resolveEffectiveFloor', () => {
  it('returns the floor breakdown jsonb', async () => {
    const rpc = mockRpc(
      vi.fn().mockResolvedValue({
        data: {
          floor_cents: 12000,
          source: 'product',
          profile_id: 'p-1',
          floor_abs_cents: 12000,
          floor_pct_cents: 10400,
        },
        error: null,
      })
    )

    const res = await resolveEffectiveFloor({
      productId: PRODUCT_ID,
      tierUnitCents: 130000,
      clinicId: CLINIC_ID,
    })
    expect(res.error).toBeUndefined()
    expect(res.data?.floor_cents).toBe(12000)
    expect(res.data?.source).toBe('product')
    expect(rpc).toHaveBeenCalledWith('resolve_effective_floor', {
      p_product_id: PRODUCT_ID,
      p_clinic_id: CLINIC_ID,
      p_doctor_id: null,
      p_tier_unit_cents: 130000,
    })
  })
})

// ── buildPricingMatrix ───────────────────────────────────────────────────

describe('buildPricingMatrix', () => {
  it('emits one cell per (quantity, coupon) combination in order', async () => {
    const calls: Array<{ qty: number; coupon: string | null }> = []
    mockRpc(
      vi.fn().mockImplementation(async (_rpc: string, params: Record<string, unknown>) => {
        calls.push({
          qty: params.p_quantity as number,
          coupon: (params.p_coupon_id as string | null) ?? null,
        })
        return {
          data: {
            final_unit_price_cents: 100000 + calls.length,
            pricing_profile_id: 'p-1',
            tier_id: 't-1',
            tier_unit_cents: 150000,
            pharmacy_cost_unit_cents: 50000,
            effective_floor_cents: 50000,
            floor_breakdown: { floor_cents: 50000, source: 'product' },
            coupon_id: null,
            coupon_disc_per_unit_raw_cents: 0,
            coupon_disc_per_unit_capped_cents: 0,
            coupon_capped: false,
            platform_commission_per_unit_cents: 50000,
            consultant_basis: 'TOTAL_PRICE',
            consultant_per_unit_raw_cents: 0,
            consultant_per_unit_cents: 0,
            consultant_capped: false,
            quantity: params.p_quantity,
            final_total_cents: 0,
            pharmacy_transfer_cents: 0,
            platform_commission_total_cents: 0,
            consultant_commission_total_cents: 0,
          },
          error: null,
        }
      })
    )

    const cells = await buildPricingMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 2, 3],
      couponIds: ['c-A', 'c-B'],
    })

    expect(cells.length).toBe(6)
    // Order: q1×cA, q1×cB, q2×cA, q2×cB, q3×cA, q3×cB
    expect(calls.map((c) => `${c.qty}-${c.coupon}`)).toEqual([
      '1-c-A',
      '1-c-B',
      '2-c-A',
      '2-c-B',
      '3-c-A',
      '3-c-B',
    ])
    expect(cells[0]?.breakdown?.final_unit_price_cents).toBe(100001)
  })

  // --- previewUnitPrice (PR-C3) -----------------------------------------

  it('defaults to a single null-coupon column when couponIds omitted (legacy buildPricingMatrix)', async () => {
    const rpcCalls: Array<{ coupon: unknown }> = []
    mockRpc(
      vi.fn().mockImplementation(async (_rpc: string, params: Record<string, unknown>) => {
        rpcCalls.push({ coupon: params.p_coupon_id })
        return {
          data: {
            final_unit_price_cents: 150000,
            pricing_profile_id: 'p-1',
            tier_id: 't-1',
            tier_unit_cents: 150000,
            pharmacy_cost_unit_cents: 50000,
            effective_floor_cents: 50000,
            floor_breakdown: { floor_cents: 50000, source: 'product' },
            coupon_id: null,
            coupon_disc_per_unit_raw_cents: 0,
            coupon_disc_per_unit_capped_cents: 0,
            coupon_capped: false,
            platform_commission_per_unit_cents: 100000,
            consultant_basis: 'TOTAL_PRICE',
            consultant_per_unit_raw_cents: 0,
            consultant_per_unit_cents: 0,
            consultant_capped: false,
            quantity: params.p_quantity,
            final_total_cents: 0,
            pharmacy_transfer_cents: 0,
            platform_commission_total_cents: 0,
            consultant_commission_total_cents: 0,
          },
          error: null,
        }
      })
    )

    const cells = await buildPricingMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 2],
    })
    expect(cells.length).toBe(2)
    expect(rpcCalls.every((c) => c.coupon === null)).toBe(true)
  })
})

// ── previewUnitPrice (PR-C3) ─────────────────────────────────────────────

const HAPPY_PREVIEW = {
  pricing_profile_id: 'p-1',
  tier_id: 't-1',
  tier_unit_cents: 150000,
  pharmacy_cost_unit_cents: 50000,
  effective_floor_cents: 50000,
  floor_breakdown: { floor_cents: 50000, source: 'product' },
  coupon_id: null,
  coupon_disc_per_unit_raw_cents: 45000,
  coupon_disc_per_unit_capped_cents: 45000,
  coupon_capped: false,
  final_unit_price_cents: 105000,
  platform_commission_per_unit_cents: 55000,
  consultant_basis: 'TOTAL_PRICE',
  consultant_per_unit_raw_cents: 5250,
  consultant_per_unit_cents: 5250,
  consultant_capped: false,
  quantity: 1,
  final_total_cents: 105000,
  pharmacy_transfer_cents: 50000,
  platform_commission_total_cents: 55000,
  consultant_commission_total_cents: 5250,
  is_preview: true,
  coupon_active: true,
}

describe('previewUnitPrice (hypothetical coupon)', () => {
  it('passes hypothetical params through to preview_unit_price RPC', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 3,
      hypothetical: { discountType: 'PERCENT', discountValue: 30 },
      clinicId: CLINIC_ID,
    })
    expect(res.error).toBeUndefined()
    expect(res.data?.final_unit_price_cents).toBe(105000)
    expect(rpc).toHaveBeenCalledWith('preview_unit_price', {
      p_product_id: PRODUCT_ID,
      p_quantity: 3,
      p_clinic_id: CLINIC_ID,
      p_doctor_id: null,
      p_disc_type: 'PERCENT',
      p_disc_value: 30,
      p_max_disc_cents: null,
    })
  })

  it('forwards no_coupon (no hypothetical) as nulls', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    await previewUnitPrice({ productId: PRODUCT_ID, quantity: 1 })
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_disc_type).toBeNull()
    expect(args.p_disc_value).toBeNull()
    expect(args.p_max_disc_cents).toBeNull()
  })

  it('rejects invalid PERCENT > 100 client-side without RPC call', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      hypothetical: { discountType: 'PERCENT', discountValue: 150 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects invalid quantity client-side', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 0,
      hypothetical: { discountType: 'PERCENT', discountValue: 30 },
    })
    expect(res.error?.reason).toBe('invalid_quantity')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects FIXED with negative value client-side', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      hypothetical: { discountType: 'FIXED', discountValue: -10 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })

  // ── ADR-002: 3 novos tipos ─────────────────────────────────────────────

  it('FIRST_UNIT_DISCOUNT — encaminha para o RPC com p_disc_type correto', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      hypothetical: { discountType: 'FIRST_UNIT_DISCOUNT', discountValue: 100 },
    })
    expect(res.error).toBeUndefined()
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_disc_type).toBe('FIRST_UNIT_DISCOUNT')
    expect(args.p_disc_value).toBe(100)
    // Não deve mandar os parâmetros que pertencem a outros tipos.
    expect(args.p_min_quantity).toBeUndefined()
    expect(args.p_tier_promotion_steps).toBeUndefined()
  })

  it('TIER_UPGRADE — exige tierPromotionSteps em [1..10]', async () => {
    const rpc = mockRpc(vi.fn())
    // Sem steps → rejeita
    let res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      hypothetical: { discountType: 'TIER_UPGRADE', discountValue: 0 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()

    // Acima do limite → rejeita
    res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      hypothetical: { discountType: 'TIER_UPGRADE', discountValue: 0, tierPromotionSteps: 11 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('TIER_UPGRADE — encaminha p_tier_promotion_steps', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 2,
      hypothetical: { discountType: 'TIER_UPGRADE', discountValue: 0, tierPromotionSteps: 3 },
    })
    expect(res.error).toBeUndefined()
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_disc_type).toBe('TIER_UPGRADE')
    expect(args.p_tier_promotion_steps).toBe(3)
    expect(args.p_min_quantity).toBeUndefined()
  })

  it('MIN_QTY_PERCENT — exige minQuantity >= 2', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 5,
      hypothetical: { discountType: 'MIN_QTY_PERCENT', discountValue: 10, minQuantity: 1 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('MIN_QTY_PERCENT — encaminha p_min_quantity e cap percentual de 100', async () => {
    const rpc = mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 5,
      hypothetical: { discountType: 'MIN_QTY_PERCENT', discountValue: 15, minQuantity: 3 },
    })
    expect(res.error).toBeUndefined()
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args.p_disc_type).toBe('MIN_QTY_PERCENT')
    expect(args.p_disc_value).toBe(15)
    expect(args.p_min_quantity).toBe(3)
    expect(args.p_tier_promotion_steps).toBeUndefined()

    // > 100% deve ser rejeitado
    rpc.mockClear()
    const res2 = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 5,
      hypothetical: { discountType: 'MIN_QTY_PERCENT', discountValue: 150, minQuantity: 3 },
    })
    expect(res2.error?.reason).toBe('rpc_unavailable')
  })

  it('rejeita discountType desconhecido', async () => {
    const rpc = mockRpc(vi.fn())
    const res = await previewUnitPrice({
      productId: PRODUCT_ID,
      quantity: 1,
      // @ts-expect-error testando entrada inválida em runtime
      hypothetical: { discountType: 'BOGUS', discountValue: 10 },
    })
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ── buildCouponImpactMatrix (PR-C3) ──────────────────────────────────────

describe('buildCouponImpactMatrix', () => {
  it('routes each variant to the correct RPC (preview vs compute)', async () => {
    const rpcCalls: Array<{ rpc: string; params: Record<string, unknown> }> = []
    mockRpc(
      vi.fn().mockImplementation(async (rpc: string, params: Record<string, unknown>) => {
        rpcCalls.push({ rpc, params })
        return {
          data: { ...HAPPY_PREVIEW, quantity: params.p_quantity },
          error: null,
        }
      })
    )

    const variants: CouponVariant[] = [
      { kind: 'no_coupon', label: 'Sem cupom' },
      {
        kind: 'hypothetical',
        label: '30% PCT',
        discountType: 'PERCENT',
        discountValue: 30,
      },
      { kind: 'existing', label: 'CODE-X', couponId: 'coupon-1' },
    ]
    const cells = await buildCouponImpactMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 4],
      variants,
      clinicId: CLINIC_ID,
    })

    expect(cells.length).toBe(6) // 2 qty × 3 variants
    // Order: q1·v0, q1·v1, q1·v2, q4·v0, q4·v1, q4·v2
    const order = cells.map((c) => `${c.quantity}-${c.variantKind}`)
    expect(order).toEqual([
      '1-no_coupon',
      '1-hypothetical',
      '1-existing',
      '4-no_coupon',
      '4-hypothetical',
      '4-existing',
    ])

    // Variant 0 + 1 should hit preview_unit_price; variant 2 hits
    // compute_unit_price.
    const previewCalls = rpcCalls.filter((c) => c.rpc === 'preview_unit_price')
    const computeCalls = rpcCalls.filter((c) => c.rpc === 'compute_unit_price')
    expect(previewCalls.length).toBe(4) // 2 qty × 2 variants
    expect(computeCalls.length).toBe(2)
    expect(computeCalls[0]?.params.p_coupon_id).toBe('coupon-1')
  })

  it('preserves variantIdx and label on every cell', async () => {
    mockRpc(vi.fn().mockResolvedValue({ data: HAPPY_PREVIEW, error: null }))
    const cells = await buildCouponImpactMatrix({
      productId: PRODUCT_ID,
      quantities: [1],
      variants: [
        { kind: 'no_coupon', label: 'A' },
        { kind: 'no_coupon', label: 'B' },
      ],
    })
    expect(cells[0]?.variantIdx).toBe(0)
    expect(cells[0]?.variantLabel).toBe('A')
    expect(cells[1]?.variantIdx).toBe(1)
    expect(cells[1]?.variantLabel).toBe('B')
  })

  it('captures pricing errors per cell without short-circuiting the matrix', async () => {
    let call = 0
    mockRpc(
      vi.fn().mockImplementation(async () => {
        call += 1
        if (call === 2) {
          // 2nd cell: pricing error
          return { data: { error: 'no_tier_for_quantity' }, error: null }
        }
        return { data: HAPPY_PREVIEW, error: null }
      })
    )
    const cells = await buildCouponImpactMatrix({
      productId: PRODUCT_ID,
      quantities: [1, 999],
      variants: [{ kind: 'no_coupon', label: 'baseline' }],
    })
    expect(cells.length).toBe(2)
    expect(cells[0]?.error).toBeUndefined()
    expect(cells[1]?.error?.reason).toBe('no_tier_for_quantity')
    expect(cells[1]?.breakdown).toBeUndefined()
  })
})
