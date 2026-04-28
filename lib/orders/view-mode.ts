/**
 * Single source of truth for "what financial fields does this role see?"
 *
 * Why this exists
 * ---------------
 * In every place that lists orders/products/items we used to write:
 *
 *     {formatCurrency(item.unit_price)}
 *
 * which means each new component reinvents the rule for **what** unit
 * price to show. The rule is:
 *
 *   • CLINIC_ADMIN / DOCTOR / SUPER_ADMIN / PLATFORM_ADMIN
 *       → see `unit_price` (sales price the buyer paid) and `total_price`
 *   • PHARMACY_ADMIN
 *       → MUST ONLY see `pharmacy_cost_per_unit` (the repasse) and the
 *         repasse total (`Σ qty × pharmacy_cost_per_unit`). Sales price
 *         is sensitive financial information about the buyer/platform
 *         margin and is forbidden in any pharmacy-facing surface.
 *
 * v6.5.18 plugged this leak in the transfers list. This module
 * generalises the rule and is enforced by:
 *
 *   • `tests/unit/lib/orders/view-mode.test.ts` (this file)
 *   • `scripts/claims/check-rbac-view-leak.sh` (lint-time)
 *   • E2E `tests/e2e/rbac-pharmacy-view.test.ts` (production-shape)
 *
 * The helpers are deliberately tiny and pure so callers can compute
 * once at the top of a page and pass `viewMode` down by prop. No
 * dynamic imports, no side effects.
 */

export type FinancialViewMode =
  | 'admin' // sees both sales price and repasse
  | 'buyer' // sees only sales price (clinic / doctor / direct buyer)
  | 'pharmacy' // sees only repasse — sales price MUST be hidden

export type RoleName =
  | 'SUPER_ADMIN'
  | 'PLATFORM_ADMIN'
  | 'CLINIC_ADMIN'
  | 'DOCTOR'
  | 'PHARMACY_ADMIN'

/**
 * Returns the view-mode for an authenticated user.
 *
 * Resolution order matches a least-privilege rule: even if a user
 * carries both `PHARMACY_ADMIN` and another role (rare, but possible
 * for staff users wearing multiple hats), the pharmacy view wins
 * because it strictly hides the sales price. An admin viewing the
 * pharmacy section through the lens of a pharmacy account should
 * see what a pharmacy sees.
 *
 * `null` is treated as anonymous → buyer view (most restrictive
 * non-pharmacy mode), but in practice the pages calling this are
 * server-side authenticated already.
 */
export function resolveViewMode(roles: readonly string[] | null | undefined): FinancialViewMode {
  if (!roles || roles.length === 0) return 'buyer'
  if (roles.includes('PHARMACY_ADMIN')) return 'pharmacy'
  if (roles.includes('SUPER_ADMIN') || roles.includes('PLATFORM_ADMIN')) return 'admin'
  return 'buyer'
}

export function isPharmacyView(mode: FinancialViewMode): boolean {
  return mode === 'pharmacy'
}

/**
 * Per-line-item visible amount, given the view mode.
 *
 * For pharmacy view: `pharmacy_cost_per_unit × quantity` is the
 * repasse line. If `pharmacy_cost_per_unit` is null/undefined we
 * deliberately fall back to **0** rather than `unit_price` — better
 * to show R$ 0,00 (which the operator will notice and report) than
 * leak the sales price as "fallback".
 */
export function visibleLineTotal(
  mode: FinancialViewMode,
  item: {
    quantity: number
    unit_price?: number | null
    total_price?: number | null
    pharmacy_cost_per_unit?: number | null
  }
): number {
  if (mode === 'pharmacy') {
    const cost = Number(item.pharmacy_cost_per_unit ?? 0)
    return cost * Number(item.quantity)
  }
  return Number(item.total_price ?? Number(item.unit_price ?? 0) * Number(item.quantity))
}

export function visibleUnitAmount(
  mode: FinancialViewMode,
  item: {
    unit_price?: number | null
    pharmacy_cost_per_unit?: number | null
  }
): number {
  if (mode === 'pharmacy') return Number(item.pharmacy_cost_per_unit ?? 0)
  return Number(item.unit_price ?? 0)
}

/**
 * Order-level total visible to the role. Used by `/orders` (list)
 * and the totals row on `/orders/[id]`. The pharmacy total is
 * `Σ visibleLineTotal(...)` over all items. The buyer/admin total
 * is the persisted `orders.total_price`.
 */
export function visibleOrderTotal(
  mode: FinancialViewMode,
  order: {
    total_price?: number | null
    order_items?: Array<{
      quantity: number
      pharmacy_cost_per_unit?: number | null
    }> | null
  }
): number {
  if (mode === 'pharmacy') {
    const items = order.order_items ?? []
    return items.reduce(
      (sum, i) => sum + Number(i.pharmacy_cost_per_unit ?? 0) * Number(i.quantity),
      0
    )
  }
  return Number(order.total_price ?? 0)
}

/**
 * Locale label for the price column header. Pharmacy sees "Repasse"
 * everywhere; everyone else sees "Preço" (the sales price the buyer
 * pays). Centralised so tests can grep this single string.
 */
export function priceColumnLabel(mode: FinancialViewMode): 'Preço' | 'Repasse' {
  return mode === 'pharmacy' ? 'Repasse' : 'Preço'
}

export function unitColumnLabel(mode: FinancialViewMode): 'Unit.' | 'Repasse/un.' {
  return mode === 'pharmacy' ? 'Repasse/un.' : 'Unit.'
}
