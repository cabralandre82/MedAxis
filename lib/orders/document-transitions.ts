/**
 * Order ↔ Document state coupling.
 *
 * Why this exists
 * ---------------
 * Documents (`order_documents`) and orders (`orders.order_status`) live
 * in two tables. The clinic uploads a recipe → `order_documents` row
 * lands → that should automatically move the order from
 * `AWAITING_DOCUMENTS` to `READY_FOR_REVIEW` so the pharmacy can pick
 * it up for analysis. Until 2026-04-28 this transition only happened
 * inside `services/orders.ts#createOrder` at *creation* time. Late
 * uploads (the common case — clinic creates the order and uploads the
 * recipe afterwards from /orders/[id]) left the order parked at
 * AWAITING_DOCUMENTS forever, which:
 *   • broke the pharmacy's "Revisar documentos" KPI (it counted only
 *     READY_FOR_REVIEW),
 *   • hid the approve/reject buttons (DocumentManager keys them off
 *     `order_status === 'READY_FOR_REVIEW'`),
 *   • showed the wrong timeline entry on the right of the order page,
 *   • generally jammed the funnel.
 *
 * This module centralises the "after-upload" logic so every code path
 * that lands documents (create-with-documents, late-upload via
 * `/api/documents/upload`, future bulk uploads) goes through the same
 * function and stays consistent.
 *
 * Idempotency
 * -----------
 * `advanceOrderAfterDocumentUpload` is safe to call repeatedly. It
 * reads the current status before transitioning and is a no-op for any
 * status other than `AWAITING_DOCUMENTS`. It does not throw on its
 * own — every Supabase error is logged and discarded so that an upload
 * cannot fail the request just because the secondary state update
 * had a transient issue.
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

interface AdvanceArgs {
  orderId: string
  /** User performing the upload — recorded in `order_status_history`. */
  changedByUserId: string
  /** Free-form text appended to the timeline entry. */
  reason?: string
}

interface AdvanceResult {
  /** True if a transition was actually applied. False if no-op (already past AWAITING_DOCUMENTS). */
  transitioned: boolean
  /** Status the order is in *after* this call (might be unchanged). */
  status: string | null
}

export async function advanceOrderAfterDocumentUpload(args: AdvanceArgs): Promise<AdvanceResult> {
  const admin = createAdminClient()

  const { data: order, error: readErr } = await admin
    .from('orders')
    .select('id, order_status')
    .eq('id', args.orderId)
    .single()

  if (readErr || !order) {
    logger.warn('[doc-transition] order lookup failed', {
      orderId: args.orderId,
      error: readErr,
    })
    return { transitioned: false, status: null }
  }

  const currentStatus = String(order.order_status)

  // We only auto-advance from the explicit "waiting on docs" state.
  // Other states (READY_FOR_REVIEW already, AWAITING_PAYMENT, in
  // execution, etc.) keep their own status — uploads after that point
  // are extra evidence, not state-transition triggers.
  if (currentStatus !== 'AWAITING_DOCUMENTS') {
    return { transitioned: false, status: currentStatus }
  }

  const { error: updateErr } = await admin
    .from('orders')
    .update({
      order_status: 'READY_FOR_REVIEW',
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.orderId)
    .eq('order_status', 'AWAITING_DOCUMENTS') // optimistic guard against race

  if (updateErr) {
    logger.error('[doc-transition] order update failed', {
      orderId: args.orderId,
      error: updateErr,
    })
    return { transitioned: false, status: currentStatus }
  }

  const { error: histErr } = await admin.from('order_status_history').insert({
    order_id: args.orderId,
    old_status: 'AWAITING_DOCUMENTS',
    new_status: 'READY_FOR_REVIEW',
    changed_by_user_id: args.changedByUserId,
    reason: args.reason ?? 'Documentação enviada — pronto para análise da farmácia',
  })

  if (histErr) {
    // Status update succeeded; history insert failed — log loudly but
    // don't roll back. The order is already in the right state and the
    // history table is for traceability, not correctness.
    logger.error('[doc-transition] history insert failed', {
      orderId: args.orderId,
      error: histErr,
    })
  }

  return { transitioned: true, status: 'READY_FOR_REVIEW' }
}
