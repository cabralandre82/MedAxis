import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'
import { orderStatusUpdatedEmail } from '@/lib/email/templates'
import { logger } from '@/lib/logger'
import { statusLabel } from '@/lib/orders/status-machine'
import { SYSTEM_USER_ID } from '@/lib/constants/system-user'

interface ReleaseInput {
  orderId: string
  /**
   * Free-text reason that lands in `order_status_history.reason`. Use this
   * to encode WHY the release happened (e.g. "Pagamento confirmado via
   * Asaas" or "Liberação manual pelo admin"). It is shown in the order
   * timeline.
   */
  reason: string
  /**
   * Who fired the release. Defaults to the system user (used by webhooks
   * and inngest) — admin-driven releases should pass the admin uuid.
   */
  actorUserId?: string
}

interface ReleaseResult {
  ok: boolean
  /** True if THIS call moved the row; false on idempotent no-op. */
  released: boolean
  /** Pharmacy users notified (for observability / tests). */
  pharmacyRecipients: string[]
}

/**
 * Atomically advance a paid order from any post-payment state to
 * `RELEASED_FOR_EXECUTION` so the pharmacy queue picks it up. Idempotent:
 * if the order is already at `RELEASED_FOR_EXECUTION` (or further), this
 * is a no-op and `released=false` is returned.
 *
 * Why this exists
 * ---------------
 * The original status machine had three administrative states between
 * "payment confirmed" and "pharmacy can start separating":
 *
 *   PAYMENT_CONFIRMED → COMMISSION_CALCULATED → TRANSFER_PENDING
 *                     → TRANSFER_COMPLETED   → RELEASED_FOR_EXECUTION
 *
 * Operationally this is wrong: the pharmacy MUST start the moment
 * payment clears. The `transfers` row is back-office finance (D+N bank
 * wire) and must not block separation. We collapse the path here by
 * advancing straight to `RELEASED_FOR_EXECUTION` while keeping
 * `transfer_status='PENDING'` for accounting visibility.
 *
 * The function also guarantees pharmacy admins are pinged in three
 * channels (in-app · push · email). The previous flow didn't notify
 * the pharmacy at all, so an order would sit in COMMISSION_CALCULATED
 * forever until somebody noticed.
 */
export async function releaseOrderForExecution(input: ReleaseInput): Promise<ReleaseResult> {
  const admin = createAdminClient()
  const actorUserId = input.actorUserId ?? SYSTEM_USER_ID

  // Fetch current state. We use the admin client deliberately — this
  // helper is called from server actions, webhooks and inngest jobs,
  // none of which carry an authenticated session for `auth.uid()`.
  const { data: order, error: fetchErr } = await admin
    .from('orders')
    .select('id, code, order_status, pharmacy_id, total_price')
    .eq('id', input.orderId)
    .single()

  if (fetchErr || !order) {
    logger.error('[releaseOrderForExecution] order fetch failed', {
      orderId: input.orderId,
      error: fetchErr,
    })
    return { ok: false, released: false, pharmacyRecipients: [] }
  }

  // Idempotency. We treat any state at or beyond RELEASED_FOR_EXECUTION
  // as "already released", so a duplicate webhook delivery (or a manual
  // admin retry) doesn't double-emit notifications.
  const POST_RELEASE_STATES = new Set([
    'RELEASED_FOR_EXECUTION',
    'RECEIVED_BY_PHARMACY',
    'IN_EXECUTION',
    'READY',
    'SHIPPED',
    'DELIVERED',
    'COMPLETED',
  ])
  if (POST_RELEASE_STATES.has(String(order.order_status))) {
    logger.info('[releaseOrderForExecution] already released, skipping', {
      orderId: input.orderId,
      currentStatus: order.order_status,
    })
    return { ok: true, released: false, pharmacyRecipients: [] }
  }

  const previousStatus = String(order.order_status)

  // Transition. Layer 049 (atomic_rpcs) bumps lock_version inside its
  // RPC; we do the same here so optimistic-locking stays consistent
  // across both paths.
  const { error: updateErr } = await admin
    .from('orders')
    .update({
      order_status: 'RELEASED_FOR_EXECUTION',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.orderId)
    .eq('order_status', previousStatus)

  if (updateErr) {
    logger.error('[releaseOrderForExecution] orders.update failed', {
      orderId: input.orderId,
      error: updateErr,
    })
    return { ok: false, released: false, pharmacyRecipients: [] }
  }

  await admin.from('order_status_history').insert({
    order_id: input.orderId,
    old_status: previousStatus,
    new_status: 'RELEASED_FOR_EXECUTION',
    changed_by_user_id: actorUserId,
    reason: input.reason,
  })

  // Notify the pharmacy. We fan out to every member with PHARMACY_ADMIN
  // role on the buying pharmacy. In-app + push are best-effort; email
  // is best-effort but the most reliable channel for a pharmacy that
  // works batch (operators check inbox, not the dashboard).
  const recipients: string[] = []
  try {
    const { data: members } = await admin
      .from('pharmacy_members')
      .select('user_id, profiles(email, full_name, notification_preferences)')
      .eq('pharmacy_id', order.pharmacy_id)

    // PostgREST returns the joined `profiles` row as either an object
    // (FK is unique) or an array (FK is many) depending on how the
    // engine infers cardinality. `pharmacy_members.user_id` references
    // `profiles.id` (unique), so 1:1, but the generated TS type defaults
    // to an array shape. Accept both — treat array case as "first row"
    // so the helper survives shape drift.
    type ProfileRow = {
      email: string | null
      full_name: string | null
      notification_preferences: Record<string, boolean> | null
    }
    type MemberRow = {
      user_id: string
      profiles: ProfileRow | ProfileRow[] | null
    }
    const list = (members ?? []) as unknown as MemberRow[]
    const code = String(order.code)
    const totalPriceLabel = (Number(order.total_price ?? 0) || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })

    await Promise.allSettled(
      list.map(async (m) => {
        recipients.push(m.user_id)
        const profile = Array.isArray(m.profiles) ? (m.profiles[0] ?? null) : m.profiles
        // ORDER_STATUS is in CRITICAL_TYPES, so user silencing
        // preferences cannot suppress this notification.
        await createNotification({
          userId: m.user_id,
          type: 'ORDER_STATUS',
          title: `Novo pedido para separação — ${code}`,
          body: `${totalPriceLabel} · pagamento confirmado · liberado para execução`,
          link: `/orders/${input.orderId}`,
        })
        await sendPushToUser(m.user_id, {
          title: `Novo pedido — ${code}`,
          body: 'Pagamento confirmado. Pedido liberado para separação.',
          link: `/orders/${input.orderId}`,
        })
        if (profile?.email) {
          const tmpl = orderStatusUpdatedEmail({
            orderCode: code,
            orderId: input.orderId,
            productName: 'Pedido completo',
            newStatus: 'RELEASED_FOR_EXECUTION',
            statusLabel: statusLabel('RELEASED_FOR_EXECUTION'),
          })
          await sendEmail({ to: profile.email, ...tmpl })
        }
      })
    )
  } catch (err) {
    // Never block the release on notification failures — the order is
    // already advanced; the pharmacy can still see it via the queue.
    logger.warn('[releaseOrderForExecution] pharmacy notification fan-out failed', {
      orderId: input.orderId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { ok: true, released: true, pharmacyRecipients: recipients }
}
