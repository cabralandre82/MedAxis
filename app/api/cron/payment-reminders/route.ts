import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { paymentReminderEmail, type PaymentReminderKind } from '@/lib/email/templates'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { decideReminderCadence } from '@/lib/payments/reminder-cadence'
import { incCounter, Metrics } from '@/lib/metrics'

/**
 * GET /api/cron/payment-reminders
 *
 * Fires daily at 09:30 UTC (06:30 BRT) — well before clinic admins
 * start their workday so the reminder is the first thing they see.
 * Replaces Asaas-side reminder e-mails (disabled 2026-04-29 via
 * `notificationDisabled = true` on every customer).
 *
 * Cadence
 * -------
 *   D-3 (3 days before due_date)  — friendly heads-up
 *   D-1 (1 day before)            — warning, last chance for boleto
 *   D-day (due_date == today)     — urgent
 *   OVERDUE (1..30 days late)     — daily nudge
 *
 * After 30 days late we stop e-mailing — the order is either going to
 * be cancelled by `expire-doc-deadlines` or the operator will follow
 * up manually. Keeping the cadence finite avoids spam loops.
 *
 * Idempotency
 * -----------
 * `payment_reminders_sent` has UNIQUE(payment_id, kind). We INSERT
 * first with ON CONFLICT DO NOTHING; only when the insert actually
 * landed do we send the e-mail + in-app notification. That makes the
 * cron safe to retry, hand-trigger, or run twice in parallel (the
 * `withCronGuard` lease should prevent the latter, but defense in
 * depth costs nothing).
 *
 * Recipient
 * ---------
 * Reminder goes to the buyer. For clinic orders, that's the user who
 * created the order (`orders.created_by_user_id`) — the human who is
 * watching the pedido. We deliberately do NOT spam every clinic
 * member. If created_by is missing (legacy orders), we fall back to
 * the first clinic_admin we find for the clinic; if even that fails,
 * we send only the e-mail using the billing profile e-mail and skip
 * the in-app notification (it has nowhere to land).
 *
 * Wrapped by withCronGuard — single-flight + cron_runs audit.
 */
export const GET = withCronGuard('payment-reminders', async () => {
  const admin = createAdminClient()
  const todayIso = new Date().toISOString().slice(0, 10)

  // Pull every PENDING payment whose due date is within the cadence
  // envelope. We over-fetch slightly (-3..+30 days) to keep the SQL
  // simple, then let `decideReminderCadence` reject anything that
  // doesn't match a cadence today.
  const lowerBound = new Date()
  lowerBound.setUTCDate(lowerBound.getUTCDate() - 30)
  const upperBound = new Date()
  upperBound.setUTCDate(upperBound.getUTCDate() + 3)

  const { data: candidates, error } = await admin
    .from('payments')
    .select(
      `id, order_id, gross_amount, payment_due_date,
       orders!inner(id, code, total_price, order_status, clinic_id, created_by_user_id,
         clinics(trade_name))`
    )
    .eq('status', 'PENDING')
    .eq('orders.order_status', 'AWAITING_PAYMENT')
    .not('payment_due_date', 'is', null)
    .gte('payment_due_date', lowerBound.toISOString().slice(0, 10))
    .lte('payment_due_date', upperBound.toISOString().slice(0, 10))

  if (error) {
    logger.error('payment-reminders query failed', {
      action: 'payment-reminders',
      error,
    })
    throw new Error(`query failed: ${error.message}`)
  }

  if (!candidates?.length) {
    return { evaluated: 0, sent: 0, skipped: 0 }
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of candidates) {
    const order = (row as { orders: unknown }).orders as {
      id: string
      code: string
      total_price: number
      order_status: string
      clinic_id: string | null
      created_by_user_id: string | null
      clinics: { trade_name: string } | null
    } | null

    const dueDate = (row as { payment_due_date: string }).payment_due_date
    const verdict = decideReminderCadence(todayIso, dueDate)
    if (!verdict || !order) {
      skipped++
      continue
    }

    try {
      const inserted = await claimReminderSlot(admin, {
        paymentId: row.id as string,
        orderId: order.id,
        kind: verdict.kind,
        dueDate,
      })
      if (!inserted) {
        // Already sent for this (payment, kind). Idempotency win.
        skipped++
        continue
      }

      const recipientUserId = await resolveRecipientUserId(admin, {
        createdByUserId: order.created_by_user_id,
        clinicId: order.clinic_id,
      })

      const billingEmail = await resolveBillingEmail(admin, {
        userId: recipientUserId,
        clinicId: order.clinic_id,
      })

      const totalPriceText = formatBRL(Number(order.total_price ?? 0))
      const dueDateText = formatBRDate(dueDate)

      const { subject, html } = paymentReminderEmail(verdict.kind, {
        orderCode: order.code,
        orderId: order.id,
        totalPrice: totalPriceText,
        dueDate: dueDateText,
        daysFromDue: verdict.daysFromDue,
        recipientName: order.clinics?.trade_name,
      })

      if (billingEmail) {
        await sendEmail({ to: billingEmail, subject, html })
      }

      if (recipientUserId) {
        await createNotification({
          userId: recipientUserId,
          type: 'PAYMENT_REMINDER',
          title: subject,
          body: `Vencimento ${dueDateText} — ${totalPriceText}`,
          link: `/orders/${order.id}`,
          push: true,
        })
      }

      await persistRecipient(admin, {
        paymentId: row.id as string,
        kind: verdict.kind,
        recipientUserId,
      })

      incCounter(Metrics.PAYMENT_REMINDER_SENT_TOTAL, { kind: verdict.kind })
      sent++
    } catch (err) {
      failed++
      logger.error('payment-reminders send failed', {
        action: 'payment-reminders',
        paymentId: row.id,
        orderId: order?.id,
        kind: verdict.kind,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { evaluated: candidates.length, sent, skipped, failed }
})

interface ClaimSlotInput {
  paymentId: string
  orderId: string
  kind: PaymentReminderKind
  dueDate: string
}

/**
 * Inserts the dedup row. Returns `true` if this caller is the one
 * who actually claimed the slot (and should therefore send the
 * e-mail), `false` if a previous run already won the race.
 *
 * We rely on `unique (payment_id, kind)` for the lock — no advisory
 * lock needed. PostgREST returns 409 on conflict; we translate that
 * into the boolean.
 */
async function claimReminderSlot(
  admin: ReturnType<typeof createAdminClient>,
  input: ClaimSlotInput
): Promise<boolean> {
  const { error } = await admin
    .from('payment_reminders_sent')
    .insert({
      payment_id: input.paymentId,
      order_id: input.orderId,
      kind: input.kind,
      due_date: input.dueDate,
    })
    .select('id')
    .single()

  if (!error) return true

  // 23505 = unique_violation (Postgres SQLSTATE). Anything else is a
  // real failure and should bubble.
  if (error.code === '23505') return false
  throw new Error(`payment_reminders_sent insert: ${error.message}`)
}

/**
 * Update the row we just inserted with the resolved recipient_user_id
 * (we couldn't put it in the INSERT because the recipient lookup
 * happens after the slot is claimed — by design, we want the slot to
 * be locked before we even start hitting profiles).
 */
async function persistRecipient(
  admin: ReturnType<typeof createAdminClient>,
  input: { paymentId: string; kind: PaymentReminderKind; recipientUserId: string | null }
): Promise<void> {
  if (!input.recipientUserId) return
  await admin
    .from('payment_reminders_sent')
    .update({ recipient_user_id: input.recipientUserId })
    .eq('payment_id', input.paymentId)
    .eq('kind', input.kind)
}

async function resolveRecipientUserId(
  admin: ReturnType<typeof createAdminClient>,
  input: { createdByUserId: string | null; clinicId: string | null }
): Promise<string | null> {
  if (input.createdByUserId) return input.createdByUserId
  if (!input.clinicId) return null
  const { data } = await admin
    .from('clinic_members')
    .select('user_id')
    .eq('clinic_id', input.clinicId)
    .limit(1)
    .maybeSingle()
  return (data as { user_id: string } | null)?.user_id ?? null
}

async function resolveBillingEmail(
  admin: ReturnType<typeof createAdminClient>,
  input: { userId: string | null; clinicId: string | null }
): Promise<string | null> {
  if (input.userId) {
    const { data } = await admin
      .from('profiles')
      .select('email')
      .eq('id', input.userId)
      .maybeSingle()
    const email = (data as { email: string | null } | null)?.email
    if (email) return email
  }
  if (input.clinicId) {
    const { data } = await admin
      .from('clinic_members')
      .select('profiles(email)')
      .eq('clinic_id', input.clinicId)
      .limit(1)
      .maybeSingle()
    const profile = (data as { profiles: { email: string | null } | null } | null)?.profiles
    return profile?.email ?? null
  }
  return null
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatBRDate(iso: string): string {
  const datePart = iso.slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return `${d}/${m}/${y}`
}
