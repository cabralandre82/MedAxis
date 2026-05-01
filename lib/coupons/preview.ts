/**
 * Pure, isomorphic helpers for the coupon preview feature.
 *
 * These functions intentionally live OUTSIDE `services/coupons.ts`
 * (which is a `'use server'` module) so client components like the
 * catalog grid can import them without crossing the server boundary
 * — Next.js refuses to ship `'use server'` modules to the browser.
 *
 * Server code should still import from this file too, so there is
 * exactly one implementation of the discount math. The catalog page
 * (server) and the catalog grid (client) both call
 * `previewDiscountedUnitPrice` and must agree to the cent.
 */

/**
 * ADR-002: discount_type pode assumir 5 valores. Os 2 legacy (PERCENT,
 * FIXED) são totalmente cobertos por este helper isomórfico. Os 3 tipos
 * novos (FIRST_UNIT_DISCOUNT, TIER_UPGRADE, MIN_QTY_PERCENT) dependem
 * de quantidade e/ou tiers e portanto NÃO são calculados aqui — o
 * cálculo correto vive em `compute_unit_price` (mig-079) ou no fluxo
 * de checkout. Para esses, o helper retorna `perUnitDiscount = 0` e a
 * UI mostra apenas a presença do cupom (badge), sem prometer um valor
 * que não pode garantir antes de saber a quantidade.
 *
 * Estas constantes vivem aqui (módulo client-safe) e NÃO em
 * `services/coupons.ts`, que é `'use server'` e portanto restringido
 * pelo App Router a exportar apenas async functions em runtime
 * (ver `tests/unit/services/coupons-use-server.test.ts`).
 */
export const COUPON_DISCOUNT_TYPES = [
  'PERCENT',
  'FIXED',
  'FIRST_UNIT_DISCOUNT',
  'TIER_UPGRADE',
  'MIN_QTY_PERCENT',
] as const

export type CatalogCouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number]

export interface CatalogCouponPreview {
  id: string
  code: string
  discount_type: CatalogCouponDiscountType
  discount_value: number
  max_discount_amount: number | null
  valid_until: string | null
}

export function previewDiscountedUnitPrice(
  unitPrice: number,
  coupon: Pick<CatalogCouponPreview, 'discount_type' | 'discount_value' | 'max_discount_amount'>
): { discountedUnit: number; perUnitDiscount: number } {
  let perUnitDiscount = 0
  if (coupon.discount_type === 'PERCENT') {
    perUnitDiscount = unitPrice * (coupon.discount_value / 100)
  } else if (coupon.discount_type === 'FIXED') {
    // FIXED is expressed as a per-unit absolute amount.
    perUnitDiscount = coupon.discount_value
  } else {
    // ADR-002 — FIRST_UNIT_DISCOUNT / TIER_UPGRADE / MIN_QTY_PERCENT
    // dependem de qty (e, no caso de TIER_UPGRADE, de tiers). O catálogo
    // chama este helper sem saber a quantidade, então retornamos 0 e a
    // UI exibe só o badge "tem cupom" — o cálculo real acontece no
    // checkout via compute_unit_price.
    perUnitDiscount = 0
  }
  if (coupon.max_discount_amount != null) {
    perUnitDiscount = Math.min(perUnitDiscount, coupon.max_discount_amount)
  }
  perUnitDiscount = Math.max(0, Math.min(perUnitDiscount, unitPrice))
  return {
    discountedUnit: Math.max(0, unitPrice - perUnitDiscount),
    perUnitDiscount,
  }
}
