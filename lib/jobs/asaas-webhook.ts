import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { sendSms, SMS, sendWhatsApp, WA } from '@/lib/zenvia'
import { sendPushToUser } from '@/lib/push'
import { releaseOrderForExecution } from '@/lib/orders/release-for-execution'
import { confirmPaymentViaAsaasWebhook } from '@/lib/payments/confirm-via-webhook'
import { logger } from '@/lib/logger'

type ClinicData = {
  trade_name: string
  profiles: {
    email: string | null
    phone: string | null
    full_name: string
    notification_preferences: Record<string, boolean>
  } | null
} | null

/**
 * Background job: Process confirmed Asaas payment webhooks with automatic retry.
 * The webhook route enqueues this job and returns 200 immediately to Asaas.
 * This avoids lost payments on transient DB failures (retried 3× with backoff).
 */
export const asaasWebhookJob = inngest.createFunction(
  {
    id: 'process-asaas-webhook',
    name: 'Process Asaas Webhook',
    triggers: [{ event: 'webhook/asaas.received' as const }],
    retries: 3,
    timeouts: { finish: '2m' },
  },
  async ({ event, step }) => {
    const { payment } = event.data
    const orderId = payment.externalReference

    if (!orderId) throw new Error('Missing externalReference in Asaas payment')

    const order = await step.run('fetch-order', async () => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('orders')
        .select(
          `
          id, code, order_status, clinic_id,
          clinics(trade_name, profiles(email, phone, full_name, notification_preferences))
        `
        )
        .eq('id', orderId)
        .single()

      if (error || !data) throw new Error(`Order ${orderId} not found`)
      return data
    })

    // Idempotency guard — treat any post-payment state as already done
    // so duplicate Inngest deliveries don't double-emit notifications.
    const POST_PAYMENT_STATES = new Set([
      'PAYMENT_CONFIRMED',
      'COMMISSION_CALCULATED',
      'TRANSFER_PENDING',
      'TRANSFER_COMPLETED',
      'RELEASED_FOR_EXECUTION',
      'RECEIVED_BY_PHARMACY',
      'IN_EXECUTION',
      'READY',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
    ])
    if (POST_PAYMENT_STATES.has((order as { order_status: string }).order_status)) {
      return { skipped: true, reason: 'already_confirmed' }
    }

    // Pre-Launch S1 / F1 — confirm the financial ledger BEFORE releasing
    // the order to the pharmacy. This calls `confirm_payment_atomic`
    // (the same SECURITY DEFINER RPC the manual super-admin path uses)
    // so commissions, transfers and consultant_commissions land in a
    // single transaction. Idempotent: if no PENDING payment exists for
    // the order (because the manual path beat us, or because the order
    // is already past confirmation), the helper returns a skip and we
    // fall through to the release step. If the helper throws, Inngest
    // retries 3× with backoff — a real PIX/cartão never silently
    // bypasses the ledger.
    const ledgerResult = await step.run('confirm-payment-ledger', async () => {
      return await confirmPaymentViaAsaasWebhook({
        orderId,
        asaasEvent: event.data.event,
        asaasPaymentId: event.data.payment.id,
        billingType: event.data.payment.billingType,
      })
    })

    if (ledgerResult.action === 'confirmed') {
      logger.info('[asaas-webhook] ledger confirmed, releasing for execution', {
        orderId,
        paymentId: ledgerResult.paymentId,
      })
    }

    // Advance directly to RELEASED_FOR_EXECUTION so the pharmacy queue
    // picks the order up. The shared helper writes the status history
    // row and notifies pharmacy admins (in-app + push + email).
    // NOTE: the `payment_status` column is already set to 'CONFIRMED'
    // by `confirm_payment_atomic` when the ledger step ran. When the
    // ledger step skipped (manual path beat us), the column was already
    // CONFIRMED before we got here. Either way, no defensive update is
    // needed — the helper below is idempotent against the order_status.
    await step.run('release-for-execution', async () => {
      await releaseOrderForExecution({
        orderId,
        reason: `Pagamento confirmado via Asaas (evento: ${event.data.event})`,
      })
    })

    await step.run('notify-clinic', async () => {
      const admin = createAdminClient()
      const clinic = (order as unknown as { clinics: ClinicData }).clinics

      const { data: clinicMember } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', (order as { clinic_id: string }).clinic_id)
        .limit(1)
        .maybeSingle()

      if (clinicMember) {
        await createNotification({
          userId: clinicMember.user_id,
          type: 'PAYMENT_CONFIRMED',
          title: `Pagamento confirmado — Pedido ${(order as { code: string }).code}`,
          message: `O pagamento foi confirmado. A farmácia iniciará a execução em breve.`,
          link: `/orders/${orderId}`,
        })

        await sendPushToUser(clinicMember.user_id, {
          title: `✅ Pagamento confirmado — ${(order as { code: string }).code}`,
          body: `A farmácia iniciará a execução do pedido em breve.`,
          link: `/orders/${orderId}`,
        })
      }

      const phone = clinic?.profiles?.phone
      const clinicEmail = clinic?.profiles?.email
      const code = (order as { code: string }).code

      if (phone) {
        await sendSms(phone, SMS.paymentConfirmed(code))
        await sendWhatsApp(phone, WA.paymentConfirmed(code))
      }

      if (clinicEmail) {
        await sendEmail({
          to: clinicEmail,
          subject: `✅ Pagamento confirmado — Pedido ${code}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0f3460">Pagamento Confirmado</h2>
              <p>Olá, <strong>${clinic?.profiles?.full_name ?? clinic?.trade_name}</strong>!</p>
              <p>O pagamento do pedido <strong>${code}</strong> foi confirmado.</p>
              <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}" style="background:#0f3460;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ver pedido</a></p>
            </div>
          `,
        })
      }

      await createNotificationForRole('SUPER_ADMIN', {
        type: 'PAYMENT_CONFIRMED',
        title: `Pagamento confirmado — Pedido ${code}`,
        message: `Pagamento do pedido ${code} (${clinic?.trade_name ?? ''}) confirmado.`,
        link: `/orders/${orderId}`,
      })
    })

    return { processed: true, orderId }
  }
)
