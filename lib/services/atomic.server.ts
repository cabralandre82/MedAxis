/**
 * Atomic-RPC wrappers for the 3 critical write paths:
 *   - orders.atomic_rpc        → public.create_order_atomic
 *   - coupons.atomic_rpc       → public.apply_coupon_atomic
 *   - payments.atomic_confirm  → public.confirm_payment_atomic
 *
 * Design
 * ------
 * Each wrapper takes the same inputs the legacy multi-step flow accepts
 * and returns the same shape the legacy flow returns, so the call site
 * can treat both paths identically. The feature flag decides which
 * internal implementation runs; if the flag is off, the wrapper never
 * touches the RPC and the fall-back function executes unchanged.
 *
 * Contract
 * --------
 *   resolveAtomicPath(flagKey, ctx) → { useRpc: boolean }
 *   applyCouponAtomic / confirmPaymentAtomic / createOrderAtomic → run
 *   the RPC and translate the P0001 reason into the same `{ error }`
 *   shape the legacy service returned. On unexpected errors the wrapper
 *   logs with a Wave-7 correlation tag and bubbles the error so the
 *   caller can decide whether to fall back to the legacy flow.
 *
 * Metrics emitted
 * ---------------
 *   atomic_rpc_total{flow,outcome}
 *   atomic_rpc_duration_ms{flow}
 *   atomic_rpc_fallback_total{flow,reason}
 *
 * See docs/runbooks/atomic-rpc-mismatch.md for the incident response
 * if one of the flows ever diverges between RPC and legacy path.
 *
 * @module lib/services/atomic.server
 */

import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { isFeatureEnabled, type FeatureFlagContext } from '@/lib/features'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

export type AtomicFlow = 'order' | 'coupon' | 'payment'

const FLAG_BY_FLOW: Record<AtomicFlow, string> = {
  order: 'orders.atomic_rpc',
  coupon: 'coupons.atomic_rpc',
  payment: 'payments.atomic_confirm',
}

/** Reason strings the RPC layer can raise via `RAISE EXCEPTION '<reason>'`. */
export type AtomicReason =
  | 'invalid_code'
  | 'invalid_user'
  | 'user_not_linked'
  | 'already_activated'
  | 'not_found_or_forbidden'
  | 'invalid_payment'
  | 'invalid_args'
  | 'not_found'
  | 'already_processed'
  | 'stale_version'
  | 'order_not_found'
  | 'invalid_buyer_type'
  | 'missing_pharmacy'
  | 'missing_actor'
  | 'empty_items'
  | 'rpc_unavailable'

export interface AtomicError {
  reason: AtomicReason
  raw?: unknown
}

// ── Feature-flag resolution ──────────────────────────────────────────────

/**
 * Returns `true` when the caller should take the RPC path. The feature
 * system defaults to false on error (fail-closed) so the legacy flow
 * is the safe fallback.
 */
export async function shouldUseAtomicRpc(
  flow: AtomicFlow,
  ctx: FeatureFlagContext = {}
): Promise<boolean> {
  try {
    return await isFeatureEnabled(FLAG_BY_FLOW[flow], ctx)
  } catch (error) {
    logger.warn('[atomic] feature flag lookup failed, falling back to legacy', {
      flow,
      error,
    })
    return false
  }
}

// ── Shared execution helper ──────────────────────────────────────────────

/**
 * Invokes a PostgREST RPC, measures latency, increments counters, and
 * normalises Supabase error shapes into `AtomicError`. Not exported —
 * call sites go through `applyCouponAtomic` / `confirmPaymentAtomic` /
 * `createOrderAtomic` below.
 */
async function callAtomicRpc<T>(
  flow: AtomicFlow,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ data?: T; error?: AtomicError }> {
  const started = Date.now()
  const admin = createAdminClient()
  try {
    const { data, error } = await admin.rpc(rpcName, params)
    const duration = Date.now() - started

    observeHistogram(Metrics.ATOMIC_RPC_DURATION_MS, duration, { flow })

    if (error) {
      const reason = mapPostgresError(error.message)
      incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow, outcome: reason })
      logger.warn('[atomic] rpc returned error', {
        flow,
        rpc: rpcName,
        reason,
        raw: error.message,
      })
      return { error: { reason, raw: error } }
    }

    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow, outcome: 'success' })
    return { data: data as T }
  } catch (error) {
    const duration = Date.now() - started
    observeHistogram(Metrics.ATOMIC_RPC_DURATION_MS, duration, { flow })
    incCounter(Metrics.ATOMIC_RPC_TOTAL, { flow, outcome: 'exception' })
    logger.error('[atomic] rpc threw', { flow, rpc: rpcName, error })
    return { error: { reason: 'rpc_unavailable', raw: error } }
  }
}

/**
 * The PL/pgSQL `RAISE EXCEPTION '<reason>'` bubbles up as a message like
 * `'reason'` (single-quoted) or `'reason (SQLSTATE P0001)'` depending on
 * the PostgREST version. This helper extracts the known reason.
 */
function mapPostgresError(message: string | null | undefined): AtomicReason {
  if (!message) return 'rpc_unavailable'
  const lower = message.toLowerCase()
  const candidates: AtomicReason[] = [
    'invalid_code',
    'invalid_user',
    'user_not_linked',
    'already_activated',
    'not_found_or_forbidden',
    'invalid_payment',
    'invalid_args',
    'already_processed',
    'stale_version',
    'order_not_found',
    'invalid_buyer_type',
    'missing_pharmacy',
    'missing_actor',
    'empty_items',
    'not_found',
  ]
  for (const reason of candidates) {
    if (lower.includes(reason)) return reason
  }
  return 'rpc_unavailable'
}

/**
 * Records a fallback event when the caller opts to skip the RPC path
 * (e.g. because the flag is off or because the RPC surfaced a recoverable
 * error). Call sites use this to attribute legacy-path traffic.
 */
export function recordAtomicFallback(flow: AtomicFlow, reason: string): void {
  incCounter(Metrics.ATOMIC_RPC_FALLBACK_TOTAL, { flow, reason })
}

// ── Apply coupon ─────────────────────────────────────────────────────────

export interface ApplyCouponResult {
  coupon_id: string
  code: string
  activated_at: string
  clinic_id: string | null
  doctor_id: string | null
  product_id: string
}

export async function applyCouponAtomic(
  code: string,
  userId: string
): Promise<{ data?: ApplyCouponResult; error?: AtomicError }> {
  const { data, error } = await callAtomicRpc<Record<string, unknown>>(
    'coupon',
    'apply_coupon_atomic',
    { p_code: code, p_user_id: userId }
  )
  if (error) return { error }
  return {
    data: {
      coupon_id: String(data?.id),
      code: String(data?.code),
      activated_at: String(data?.activated_at),
      clinic_id: (data?.clinic_id ?? null) as string | null,
      doctor_id: (data?.doctor_id ?? null) as string | null,
      product_id: String(data?.product_id),
    },
  }
}

// ── Confirm payment ──────────────────────────────────────────────────────

export interface ConfirmPaymentArgs {
  paymentMethod: string
  referenceCode?: string | null
  notes?: string | null
  confirmedByUserId: string
  expectedLockVersion?: number
}

export interface ConfirmPaymentResult {
  payment_id: string
  order_id: string
  pharmacy_transfer: number
  platform_commission: number
  consultant_commission: number | null
  new_lock_version: number
}

export async function confirmPaymentAtomic(
  paymentId: string,
  args: ConfirmPaymentArgs
): Promise<{ data?: ConfirmPaymentResult; error?: AtomicError }> {
  const payload = {
    p_payment_id: paymentId,
    p_args: {
      payment_method: args.paymentMethod,
      reference_code: args.referenceCode ?? '',
      notes: args.notes ?? '',
      confirmed_by_user_id: args.confirmedByUserId,
      expected_lock_version: args.expectedLockVersion ?? 0,
    },
  }

  const { data, error } = await callAtomicRpc<Record<string, unknown>>(
    'payment',
    'confirm_payment_atomic',
    payload
  )
  if (error) return { error }
  return {
    data: {
      payment_id: String(data?.payment_id),
      order_id: String(data?.order_id),
      pharmacy_transfer: Number(data?.pharmacy_transfer ?? 0),
      platform_commission: Number(data?.platform_commission ?? 0),
      consultant_commission:
        data?.consultant_commission == null ? null : Number(data.consultant_commission),
      new_lock_version: Number(data?.new_lock_version ?? 0),
    },
  }
}

// ── Create order ─────────────────────────────────────────────────────────

export interface CreateOrderItem {
  product_id: string
  quantity: number
  unit_price: number
  total_price: number
  coupon_id?: string | null
}

export interface CreateOrderArgs {
  buyerType: 'CLINIC' | 'DOCTOR'
  clinicId?: string | null
  doctorId?: string | null
  deliveryAddressId?: string | null
  pharmacyId: string
  notes?: string | null
  createdByUserId: string
  estimatedTotal: number
  items: CreateOrderItem[]
}

export interface CreateOrderResult {
  order_id: string
  order_code: string
  total_price: number
}

export async function createOrderAtomic(
  args: CreateOrderArgs
): Promise<{ data?: CreateOrderResult; error?: AtomicError }> {
  const payload = {
    p_args: {
      buyer_type: args.buyerType,
      clinic_id: args.clinicId ?? '',
      doctor_id: args.doctorId ?? '',
      delivery_address_id: args.deliveryAddressId ?? '',
      pharmacy_id: args.pharmacyId,
      notes: args.notes ?? '',
      created_by_user_id: args.createdByUserId,
      estimated_total: args.estimatedTotal,
      items: args.items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
        coupon_id: i.coupon_id ?? '',
      })),
    },
  }
  const { data, error } = await callAtomicRpc<Record<string, unknown>>(
    'order',
    'create_order_atomic',
    payload
  )
  if (error) return { error }
  return {
    data: {
      order_id: String(data?.order_id),
      order_code: String(data?.order_code),
      total_price: Number(data?.total_price ?? 0),
    },
  }
}

export const _internal = {
  mapPostgresError,
  FLAG_BY_FLOW,
}
