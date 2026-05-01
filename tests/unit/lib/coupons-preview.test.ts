import { describe, it, expect } from 'vitest'
import { previewDiscountedUnitPrice } from '@/lib/coupons/preview'

/**
 * Pin the discount math so the catalog preview and the server-side
 * order creation agree to the cent. Drift here is the bug class
 * reported on 2026-04-28 (cupom ativo não aparece no catálogo): if the
 * preview rounds down differently than the server, the buyer sees
 * R$ 80,00 in the card and is charged R$ 80,01 in the order — same
 * trust-erosion outcome as not showing it at all.
 */

describe('previewDiscountedUnitPrice', () => {
  describe('PERCENT', () => {
    it('applies the percentage', () => {
      expect(
        previewDiscountedUnitPrice(100, {
          discount_type: 'PERCENT',
          discount_value: 10,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 90, perUnitDiscount: 10 })
    })

    it('caps at max_discount_amount when set', () => {
      // 50% of 200 = 100, but max is 30 → only 30 off.
      expect(
        previewDiscountedUnitPrice(200, {
          discount_type: 'PERCENT',
          discount_value: 50,
          max_discount_amount: 30,
        })
      ).toEqual({ discountedUnit: 170, perUnitDiscount: 30 })
    })

    it('100% gets clamped to "free" without going negative', () => {
      expect(
        previewDiscountedUnitPrice(50, {
          discount_type: 'PERCENT',
          discount_value: 100,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 0, perUnitDiscount: 50 })
    })

    it('200% never goes negative', () => {
      expect(
        previewDiscountedUnitPrice(50, {
          discount_type: 'PERCENT',
          discount_value: 200,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 0, perUnitDiscount: 50 })
    })
  })

  describe('FIXED', () => {
    it('subtracts the absolute amount per unit', () => {
      expect(
        previewDiscountedUnitPrice(80, {
          discount_type: 'FIXED',
          discount_value: 15,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 65, perUnitDiscount: 15 })
    })

    it('FIXED greater than unit price does not go negative', () => {
      expect(
        previewDiscountedUnitPrice(10, {
          discount_type: 'FIXED',
          discount_value: 25,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 0, perUnitDiscount: 10 })
    })
  })

  it('zero discount returns the unit price unchanged', () => {
    expect(
      previewDiscountedUnitPrice(99.5, {
        discount_type: 'PERCENT',
        discount_value: 0,
        max_discount_amount: null,
      })
    ).toEqual({ discountedUnit: 99.5, perUnitDiscount: 0 })
  })

  // ── ADR-002 — tipos novos não calculam no catálogo ─────────────────────
  // Esses dependem de quantidade/tier e o catálogo (grid público) não
  // sabe quanto o usuário vai comprar. O helper retorna 0 por contrato
  // e a UI exibe apenas o badge "tem cupom"; o cálculo correto vive em
  // `compute_unit_price` (mig-079) e roda no checkout. Esse teste
  // congela esse contrato — se um dia mudarmos a estratégia, os testes
  // do catálogo grid também precisam atualizar.
  describe('ADR-002 — quantity-dependent types return 0 (badge-only)', () => {
    it.each([
      ['FIRST_UNIT_DISCOUNT', 100],
      ['TIER_UPGRADE', 0],
      ['MIN_QTY_PERCENT', 10],
    ] as const)('%s returns no per-unit discount in the catalog grid', (type, value) => {
      expect(
        previewDiscountedUnitPrice(150, {
          discount_type: type,
          discount_value: value,
          max_discount_amount: null,
        })
      ).toEqual({ discountedUnit: 150, perUnitDiscount: 0 })
    })

    it('respects max_discount_amount even though the underlying discount is 0', () => {
      // Defensive: setting max_discount_amount on a TIER_UPGRADE coupon
      // should not produce a negative discount or otherwise flip the math.
      expect(
        previewDiscountedUnitPrice(150, {
          discount_type: 'TIER_UPGRADE',
          discount_value: 0,
          max_discount_amount: 50,
        })
      ).toEqual({ discountedUnit: 150, perUnitDiscount: 0 })
    })
  })
})
