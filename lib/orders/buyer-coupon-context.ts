import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { getActiveCouponsByProductForBuyer } from '@/services/coupons'
import type { CatalogCouponPreview } from '@/lib/coupons/preview'
import type { ProfileWithRoles } from '@/types'

/**
 * Resolve the buyer (clinic or doctor) attached to the current user and
 * return the active coupons that apply to the supplied products.
 *
 * Why this lives here
 * -------------------
 * The same "who is the buyer for coupon purposes?" lookup happens in
 * three places — `/catalog`, `/catalog/[slug]` and `/orders/new` — and
 * before this module each page reimplemented it slightly differently.
 * After the regression in 2026-04-28 (where catalog showed the
 * discount but product detail and the new-order form did not) we
 * factor it into one helper so any future page that needs the same
 * preview can opt in with one line.
 *
 * Pharmacies are explicitly **excluded** — buyer coupons only apply
 * to clinic/doctor surfaces. A pharmacy admin viewing the catalog
 * never sees a discount chip.
 *
 * Returns an empty map (and never throws) when the user is anonymous,
 * a pharmacy admin, has no clinic/doctor record yet, or the product
 * list is empty. The two callers (server pages) are then free to do
 * `couponPreviewByProduct[productId]` without null-checking.
 */
export async function resolveBuyerCouponPreview(
  user: ProfileWithRoles | null,
  productIds: string[]
): Promise<Record<string, CatalogCouponPreview>> {
  if (!user || !productIds.length) return {}
  if (user.roles.includes('PHARMACY_ADMIN')) return {}

  const admin = createAdminClient()
  let buyerClinicId: string | null = null
  let buyerDoctorId: string | null = null

  if (user.roles.includes('CLINIC_ADMIN')) {
    const { data: cm } = await admin
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', user.id)
      .maybeSingle()
    buyerClinicId = cm?.clinic_id ?? null
  } else if (user.roles.includes('DOCTOR')) {
    const { data: doctor } = await admin
      .from('doctors')
      .select('id')
      .or(`user_id.eq.${user.id},email.eq.${user.email}`)
      .maybeSingle()
    buyerDoctorId = doctor?.id ?? null
  }

  if (!buyerClinicId && !buyerDoctorId) return {}

  return getActiveCouponsByProductForBuyer({
    clinicId: buyerClinicId,
    doctorId: buyerDoctorId,
    productIds,
  })
}
