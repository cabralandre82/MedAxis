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

export interface CatalogCouponPreview {
  id: string
  code: string
  discount_type: 'PERCENT' | 'FIXED'
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
  } else {
    // FIXED is expressed as a per-unit absolute amount.
    perUnitDiscount = coupon.discount_value
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
