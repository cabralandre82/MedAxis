/**
 * Server-side wrapper for the SQL pricing engine installed in PR-A/B.
 *
 * Three RPC entry points:
 *   - resolvePricingProfile(productId, at)
 *   - resolveEffectiveFloor(productId, clinicId, doctorId, tierUnitCents, at)
 *   - computeUnitPrice(productId, quantity, clinicId, doctorId, couponId, at)
 *
 * Why a wrapper at all
 * --------------------
 * * Type discipline: the SQL functions return raw jsonb. Without a TS
 *   layer the call site juggles unknown payloads. Here we coerce once
 *   and surface `PricingBreakdown` (declared in `types/index.ts`) to
 *   every caller.
 * * Metrics: counter on success/error + latency histogram, same shape
 *   the atomic RPC wrapper uses (so the dashboard already shows them).
 * * Error normalisation: structured `error.reason` so UI code can map
 *   a small set of strings, not raw Postgres messages.
 * * Cache: every call hits Supabase. UI surfaces (catalog, simulator)
 *   call this many times per render — we add a per-request memoization
 *   so that the same input within a single React Server Component
 *   render only runs once.
 *
 * What this is NOT
 * ----------------
 * * Not a pricing oracle for trusted writes. The trigger
 *   `freeze_order_item_price` is the source of truth at order time;
 *   THIS module is read-only (preview / simulator).
 * * No coupon counters are touched here. Use this wrapper to *show*
 *   the buyer a number; freeze the actual order via createOrderAtomic.
 *
 * @module lib/services/pricing-engine.server
 */

import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'
import type { PricingBreakdown } from '@/types'

// ── Reasons surfaced by the SQL functions ────────────────────────────────
//
// These match exact strings either set in the JSON `error` field by
// compute_unit_price OR the Postgres exception messages we re-raise
// (e.g. "no_active_profile", "no_tier_for_quantity"). UI can branch on
// this enum-like type for actionable messaging.

export type PricingEngineReason =
  | 'no_active_profile'
  | 'no_tier_for_quantity'
  | 'invalid_quantity'
  | 'rpc_unavailable'

export interface PricingEngineError {
  reason: PricingEngineReason
  raw?: unknown
}

// ── Internal: call helper ─────────────────────────────────────────────────

async function callPricingRpc<T>(
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data?: T; error?: PricingEngineError }> {
  const started = Date.now()
  const admin = createAdminClient()
  try {
    const { data, error } = await admin.rpc(rpcName, params)
    const duration = Date.now() - started
    observeHistogram(Metrics.ATOMIC_RPC_DURATION_MS, duration, { flow: 'pricing' })

    if (error) {
      const reason = mapPricingError(error.message)
      incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: reason })
      logger.warn('[pricing-engine] rpc returned error', {
        rpc: rpcName,
        reason,
        raw: error.message,
      })
      return { error: { reason, raw: error } }
    }

    // The SQL function may also return `{ error: '...' }` as data
    // when the input is structurally fine but pricing isn't (no
    // active profile, no tier for the quantity, etc). Detect that
    // shape and translate to PricingEngineError so the call site
    // doesn't need to peek inside.
    if (data && typeof data === 'object' && 'error' in (data as object)) {
      const inlineReason = mapPricingError(String((data as { error: unknown }).error))
      incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: inlineReason })
      return { error: { reason: inlineReason, raw: data } }
    }

    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: 'success' })
    return { data: data as T }
  } catch (err) {
    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow: 'pricing', outcome: 'rpc_unavailable' })
    logger.error('[pricing-engine] rpc threw', { rpc: rpcName, error: err })
    return { error: { reason: 'rpc_unavailable', raw: err } }
  }
}

function mapPricingError(message: string | undefined | null): PricingEngineReason {
  const m = (message ?? '').toLowerCase()
  if (m.includes('no_active_profile')) return 'no_active_profile'
  if (m.includes('no_tier_for_quantity')) return 'no_tier_for_quantity'
  if (m.includes('quantity must be > 0') || m.includes('invalid_quantity')) {
    return 'invalid_quantity'
  }
  return 'rpc_unavailable'
}

// ── Public API ────────────────────────────────────────────────────────────

export interface ComputeUnitPriceArgs {
  productId: string
  quantity: number
  clinicId?: string | null
  doctorId?: string | null
  couponId?: string | null
  /** ISO timestamp; defaults to "now" inside the RPC. */
  at?: string | null
}

/**
 * Pure preview of the pricing breakdown for an item. No write side-effects.
 * Use to render the simulator, the coupon-impact matrix, or to show
 * the clinic the dynamic price after they pick a quantity.
 *
 * Returns `error.reason='no_active_profile'` when the product is in
 * `pricing_mode='TIERED_PROFILE'` but no live profile exists yet (a
 * configuration bug the UI should call out clearly so the operator
 * can finish setting up the product).
 *
 * Returns `error.reason='no_tier_for_quantity'` when the requested
 * quantity falls outside any tier — UI should ask the buyer to revise
 * the quantity or contact support.
 */
export async function computeUnitPrice(
  args: ComputeUnitPriceArgs
): Promise<{ data?: PricingBreakdown; error?: PricingEngineError }> {
  if (!args.productId) {
    return { error: { reason: 'rpc_unavailable', raw: 'missing productId' } }
  }
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    return { error: { reason: 'invalid_quantity', raw: args.quantity } }
  }

  // p_at is intentionally omitted when null/undefined: PostgREST
  // forwards `null` literally and the SQL default (`now()`) is NOT
  // applied, which causes `effective_from <= NULL` and a spurious
  // `no_active_profile`. Smoke 2026-04-30 catch — see ADR-001 PR-E
  // section. Same pattern applied below to resolveEffectiveFloor and
  // previewUnitPriceWithHypothetical. Belt-and-braces: migration 078
  // also coerces `COALESCE(p_at, now())` inside the SQL functions.
  const params: Record<string, unknown> = {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_clinic_id: args.clinicId ?? null,
    p_doctor_id: args.doctorId ?? null,
    p_coupon_id: args.couponId ?? null,
  }
  if (args.at) params.p_at = args.at
  return callPricingRpc<PricingBreakdown>('compute_unit_price', params)
}

export interface ResolveFloorArgs {
  productId: string
  clinicId?: string | null
  doctorId?: string | null
  /** Tier price per unit, in cents — required for the pct floor branch. */
  tierUnitCents: number
  at?: string | null
}

export interface FloorBreakdown {
  floor_cents: number | null
  source: 'product' | 'buyer_override' | 'no_profile'
  profile_id?: string
  override_id?: string
  floor_abs_cents: number | null
  floor_pct_cents: number | null
}

/**
 * Resolve the per-unit platform-revenue floor for a (product, buyer,
 * tier price) combination. PR-B: prefers `buyer_pricing_overrides`
 * over the product profile.
 */
export async function resolveEffectiveFloor(
  args: ResolveFloorArgs
): Promise<{ data?: FloorBreakdown; error?: PricingEngineError }> {
  const params: Record<string, unknown> = {
    p_product_id: args.productId,
    p_clinic_id: args.clinicId ?? null,
    p_doctor_id: args.doctorId ?? null,
    p_tier_unit_cents: args.tierUnitCents,
  }
  if (args.at) params.p_at = args.at
  return callPricingRpc<FloorBreakdown>('resolve_effective_floor', params)
}

// ── Hypothetical-coupon preview (PR-C3 of ADR-001) ──────────────────────
//
// Backed by `preview_unit_price` (mig-077, estendido em mig-079). Use when
// the operator is EVALUATING a coupon ('what if I gave clinic X 30% off?')
// BEFORE creating it in the `coupons` table. The function accepts the
// discount params directly instead of looking them up.
//
// ADR-002 (mig-079) added 3 novos discount_type:
//   - FIRST_UNIT_DISCOUNT: discountValue = R$ off na 1ª unidade. Em qty>1 → 0.
//   - TIER_UPGRADE: discountValue ignorado; usar `tierPromotionSteps` (1..10).
//   - MIN_QTY_PERCENT: discountValue = %; gate via `minQuantity` (>= 2).

export type HypotheticalDiscountType =
  | 'PERCENT'
  | 'FIXED'
  | 'FIRST_UNIT_DISCOUNT'
  | 'TIER_UPGRADE'
  | 'MIN_QTY_PERCENT'

export interface PreviewWithHypotheticalArgs {
  productId: string
  quantity: number
  clinicId?: string | null
  doctorId?: string | null
  /** When undefined, simulates "no coupon" (baseline). */
  hypothetical?: {
    discountType: HypotheticalDiscountType
    /**
     * Semântica por tipo:
     *  - PERCENT, MIN_QTY_PERCENT: percentual 0..100
     *  - FIXED, FIRST_UNIT_DISCOUNT: R$ por unidade (FIRST_UNIT_DISCOUNT
     *    aplica só quando `quantity = 1`)
     *  - TIER_UPGRADE: ignorado (passar 0 por convenção)
     */
    discountValue: number
    /** optional global cap in cents (mirrors coupons.max_discount_amount). */
    maxDiscountCents?: number | null
    /**
     * Quantidade mínima para o cupom valer. Default 1 (sem gate).
     * Obrigatório > 1 para `MIN_QTY_PERCENT`. Para os demais tipos é
     * opcional — operador pode usar para limitar PERCENT/FIXED a pedidos
     * acima de N unidades.
     */
    minQuantity?: number
    /**
     * Quantos tiers acima o cliente é promovido (1..10). Obrigatório > 0
     * para `TIER_UPGRADE`. Ignorado pelos outros tipos.
     */
    tierPromotionSteps?: number
  }
  at?: string | null
}

/**
 * Compute the per-unit pricing breakdown for a hypothetical coupon
 * (or none). Same shape as `computeUnitPrice` so the UI can treat
 * both interchangeably; only difference is `coupon_id` is always
 * NULL and (when hypothetical is set) `coupon_active` is true.
 */
export async function previewUnitPrice(
  args: PreviewWithHypotheticalArgs
): Promise<{ data?: PricingBreakdown; error?: PricingEngineError }> {
  if (!args.productId) {
    return { error: { reason: 'rpc_unavailable', raw: 'missing productId' } }
  }
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    return { error: { reason: 'invalid_quantity', raw: args.quantity } }
  }

  const h = args.hypothetical
  if (h) {
    const VALID_TYPES: HypotheticalDiscountType[] = [
      'PERCENT',
      'FIXED',
      'FIRST_UNIT_DISCOUNT',
      'TIER_UPGRADE',
      'MIN_QTY_PERCENT',
    ]
    if (!VALID_TYPES.includes(h.discountType)) {
      return { error: { reason: 'rpc_unavailable', raw: 'invalid discountType' } }
    }
    // TIER_UPGRADE não usa discountValue (semântica é via tierPromotionSteps).
    // Os demais tipos exigem valor > 0.
    if (h.discountType !== 'TIER_UPGRADE') {
      if (!Number.isFinite(h.discountValue) || h.discountValue <= 0) {
        return { error: { reason: 'rpc_unavailable', raw: 'invalid discountValue' } }
      }
    }
    if (
      (h.discountType === 'PERCENT' || h.discountType === 'MIN_QTY_PERCENT') &&
      h.discountValue > 100
    ) {
      return { error: { reason: 'rpc_unavailable', raw: 'PERCENT > 100' } }
    }
    if (h.discountType === 'TIER_UPGRADE') {
      const steps = h.tierPromotionSteps ?? 0
      if (!Number.isInteger(steps) || steps < 1 || steps > 10) {
        return {
          error: {
            reason: 'rpc_unavailable',
            raw: 'TIER_UPGRADE: tierPromotionSteps must be 1..10',
          },
        }
      }
    }
    if (h.discountType === 'MIN_QTY_PERCENT') {
      const minQ = h.minQuantity ?? 1
      if (!Number.isInteger(minQ) || minQ < 2) {
        return {
          error: { reason: 'rpc_unavailable', raw: 'MIN_QTY_PERCENT: minQuantity must be >= 2' },
        }
      }
    }
  }

  const params: Record<string, unknown> = {
    p_product_id: args.productId,
    p_quantity: args.quantity,
    p_clinic_id: args.clinicId ?? null,
    p_doctor_id: args.doctorId ?? null,
    p_disc_type: h?.discountType ?? null,
    p_disc_value: h?.discountValue ?? null,
    p_max_disc_cents: h?.maxDiscountCents ?? null,
  }
  // Os 2 parâmetros novos da mig-079 só são enviados quando o caller os
  // fornece — assim continuamos disparando o DEFAULT da função SQL e
  // mantemos compatibilidade com qualquer futura assinatura.
  if (h?.minQuantity != null) params.p_min_quantity = h.minQuantity
  if (h?.tierPromotionSteps != null) params.p_tier_promotion_steps = h.tierPromotionSteps
  if (args.at) params.p_at = args.at
  return callPricingRpc<PricingBreakdown>('preview_unit_price', params)
}

// ── Matrix preview helper ────────────────────────────────────────────────
//
// Used by PR-C3's super-admin "coupon impact preview" page and by
// PR-D's clinic-side simulator. Computes a 2-D matrix of breakdowns
// for an array of quantities and an optional list of coupon IDs.
// Caller can then aggregate into a heatmap / table.

export interface MatrixCell {
  quantity: number
  couponId: string | null
  /** undefined when the engine returned an error for this cell. */
  breakdown?: PricingBreakdown
  error?: PricingEngineError
}

export interface MatrixArgs {
  productId: string
  quantities: number[]
  couponIds?: Array<string | null>
  clinicId?: string | null
  doctorId?: string | null
  at?: string | null
}

/**
 * Build a 2-D matrix `quantities × coupons`. Sequential because the
 * underlying RPC is cheap (`STABLE`, all indexed lookups) and we want
 * deterministic ordering for the UI. If a future profiling shows this
 * is the bottleneck, switch to `Promise.all` with a small concurrency
 * cap — the function is pure read.
 */
export async function buildPricingMatrix(args: MatrixArgs): Promise<MatrixCell[]> {
  const couponSet = args.couponIds && args.couponIds.length > 0 ? args.couponIds : [null]
  const cells: MatrixCell[] = []

  for (const qty of args.quantities) {
    for (const couponId of couponSet) {
      const { data, error } = await computeUnitPrice({
        productId: args.productId,
        quantity: qty,
        clinicId: args.clinicId,
        doctorId: args.doctorId,
        couponId: couponId ?? null,
        at: args.at,
      })
      cells.push({
        quantity: qty,
        couponId: couponId ?? null,
        breakdown: data,
        error,
      })
    }
  }

  return cells
}

// ── Coupon impact matrix (PR-C3) ─────────────────────────────────────────
//
// A "variant" is what the matrix shows in each column: either
// "no_coupon" (baseline), or a hypothetical (PERCENT/FIXED + value),
// or an existing coupon by id. The matrix is N quantities × M variants.
// Each cell is one breakdown.

export type CouponVariant =
  | { kind: 'no_coupon'; label: string }
  | {
      kind: 'hypothetical'
      label: string
      discountType: HypotheticalDiscountType
      discountValue: number
      maxDiscountCents?: number | null
      /** Para `MIN_QTY_PERCENT` (e opcionalmente PERCENT/FIXED). */
      minQuantity?: number
      /** Para `TIER_UPGRADE`. */
      tierPromotionSteps?: number
    }
  | { kind: 'existing'; label: string; couponId: string }

export interface CouponMatrixCell {
  quantity: number
  variantIdx: number
  variantLabel: string
  variantKind: CouponVariant['kind']
  breakdown?: PricingBreakdown
  error?: PricingEngineError
}

export interface CouponMatrixArgs {
  productId: string
  quantities: number[]
  variants: CouponVariant[]
  clinicId?: string | null
  doctorId?: string | null
  at?: string | null
}

/**
 * Build the coupon impact matrix for the super-admin UI. One call
 * per (quantity, variant) combination — sequential, indexed RPCs.
 *
 * For typical sizes (~6 quantities × ~5 variants = 30 calls) the
 * total is dominated by network round-trip; ~50 ms each on a warm
 * pool. Acceptable for a server component render.
 */
export async function buildCouponImpactMatrix(args: CouponMatrixArgs): Promise<CouponMatrixCell[]> {
  const cells: CouponMatrixCell[] = []
  for (const qty of args.quantities) {
    for (let v = 0; v < args.variants.length; v += 1) {
      const variant = args.variants[v]
      if (!variant) continue
      let cell: { data?: PricingBreakdown; error?: PricingEngineError }

      if (variant.kind === 'no_coupon') {
        cell = await previewUnitPrice({
          productId: args.productId,
          quantity: qty,
          clinicId: args.clinicId,
          doctorId: args.doctorId,
          at: args.at,
        })
      } else if (variant.kind === 'hypothetical') {
        cell = await previewUnitPrice({
          productId: args.productId,
          quantity: qty,
          clinicId: args.clinicId,
          doctorId: args.doctorId,
          hypothetical: {
            discountType: variant.discountType,
            discountValue: variant.discountValue,
            maxDiscountCents: variant.maxDiscountCents ?? null,
            minQuantity: variant.minQuantity,
            tierPromotionSteps: variant.tierPromotionSteps,
          },
          at: args.at,
        })
      } else {
        cell = await computeUnitPrice({
          productId: args.productId,
          quantity: qty,
          clinicId: args.clinicId,
          doctorId: args.doctorId,
          couponId: variant.couponId,
          at: args.at,
        })
      }

      cells.push({
        quantity: qty,
        variantIdx: v,
        variantLabel: variant.label,
        variantKind: variant.kind,
        breakdown: cell.data,
        error: cell.error,
      })
    }
  }
  return cells
}
