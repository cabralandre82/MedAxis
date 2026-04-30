import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import type { BuyerActiveProfile, BuyerTierRow } from './buyer-tiers-shared'

// Re-export the shared shapes so existing imports continue to work
// (`import { BuyerTierRow } from '@/lib/pricing/buyer-tiers'` — the
// shape is here as a type, the helpers in `buyer-tiers-shared`).
export type { BuyerActiveProfile, BuyerTierRow } from './buyer-tiers-shared'
export { formatTierRange, findTierForQuantity } from './buyer-tiers-shared'

/**
 * Returns the currently-active pricing profile for a product, in a
 * buyer-safe shape. Never throws — returns `null` for any failure
 * mode (no active profile, RLS error, missing row).
 *
 * Authorisation
 * -------------
 * This function does NOT call `requireRole`. It is intentionally
 * accessible to any authenticated user — the data it returns is the
 * same data the buyer sees on the product detail page (catalog
 * price, tier brackets). RLS on `pricing_profiles` /
 * `pricing_profile_tiers` is permissive for read, restrictive for
 * write.
 *
 * Use {@link getActivePricingProfile} (in services/pricing) for the
 * super-admin surface that includes the operational fields.
 */
export async function getActiveBuyerTiers(productId: string): Promise<BuyerActiveProfile | null> {
  const admin = createAdminClient()

  const { data: profile, error: profileErr } = await admin
    .from('pricing_profiles')
    .select('id, effective_from')
    .eq('product_id', productId)
    .is('effective_until', null)
    .maybeSingle()

  if (profileErr) {
    logger.warn('[pricing] getActiveBuyerTiers profile read failed', {
      productId,
      code: profileErr.code,
      message: profileErr.message,
    })
    return null
  }
  if (!profile) return null

  const { data: tiers, error: tiersErr } = await admin
    .from('pricing_profile_tiers')
    .select('id, min_quantity, max_quantity, unit_price_cents')
    .eq('pricing_profile_id', profile.id)
    .order('min_quantity', { ascending: true })

  if (tiersErr) {
    logger.warn('[pricing] getActiveBuyerTiers tiers read failed', {
      productId,
      code: tiersErr.code,
      message: tiersErr.message,
    })
    return null
  }
  if (!tiers || tiers.length === 0) return null

  return {
    profile_id: profile.id as string,
    effective_from: profile.effective_from as string,
    tiers: tiers as BuyerTierRow[],
  }
}

/**
 * Batched lookup: for each product id in `productIds`, returns the
 * MIN tier unit price (in cents) across the active pricing profile,
 * or `undefined` when the product has no active profile.
 *
 * Why MIN
 * -------
 * The catalog grid uses this for the "A partir de R$ X" copy. The
 * minimum unit price across tiers is what the buyer COULD pay if they
 * order at the most discounted bracket — the lower bound of the
 * "preço por quantidade" range. We deliberately don't show the upper
 * bound on the grid (it would be the qty=1 price, often higher and
 * less attractive) — the detail page lays out every tier in the
 * `<BuyerTierTable/>`.
 *
 * One round-trip
 * --------------
 * Avoids N+1 by selecting from `pricing_profile_tiers` joined to
 * `pricing_profiles` in a single query, with `pricing_profiles`
 * filtered by `effective_until IS NULL` and `product_id IN (…)`.
 * Returns `{}` on empty input or RLS error (degrades to FIXED-style
 * card display).
 *
 * Buyer-safe: select projects only the four buyer-safe columns
 * (id, min_quantity, max_quantity, unit_price_cents) — same
 * confidentiality contract as `getActiveBuyerTiers`.
 */
export async function getMinTierUnitCentsByProductIds(
  productIds: string[]
): Promise<Record<string, number>> {
  if (!productIds.length) return {}
  const admin = createAdminClient()

  // We Pull all active profiles + their tiers, group on TS-side. This
  // is fine for catalogue page-size (<= 12 products by default) — we
  // get back at most 12 profile rows + at most ~5 tiers each. A
  // bespoke RPC with `MIN(unit_price_cents)` would be faster at
  // scale, but PostgREST doesn't expose aggregates easily and this
  // call is gated by pagination.
  const { data: profiles, error: profileErr } = await admin
    .from('pricing_profiles')
    .select(
      `
      product_id,
      pricing_profile_tiers (unit_price_cents)
    `
    )
    .in('product_id', productIds)
    .is('effective_until', null)

  if (profileErr) {
    logger.warn('[pricing] getMinTierUnitCentsByProductIds failed', {
      productCount: productIds.length,
      code: profileErr.code,
      message: profileErr.message,
    })
    return {}
  }
  if (!profiles) return {}

  const out: Record<string, number> = {}
  for (const row of profiles as Array<{
    product_id: string
    pricing_profile_tiers: { unit_price_cents: number }[]
  }>) {
    const tiers = row.pricing_profile_tiers ?? []
    if (!tiers.length) continue
    let min = tiers[0].unit_price_cents
    for (const t of tiers) {
      if (t.unit_price_cents < min) min = t.unit_price_cents
    }
    out[row.product_id] = min
  }
  return out
}
