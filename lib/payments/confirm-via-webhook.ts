/**
 * Webhook-side payment confirmation helper.
 *
 * Pre-Launch Onda S1 — F1
 * -----------------------
 * Before this module existed, the Asaas webhook job
 * (`lib/jobs/asaas-webhook.ts`) only flipped `payments.payment_status =
 * CONFIRMED` and called `releaseOrderForExecution()`. It did **not**
 * insert into `commissions`, `transfers` or `consultant_commissions`.
 * The financial ledger only got populated when the super-admin clicked
 * "confirmar pagamento" manually — fine for the testing phase (every
 * order to date was confirmed manually), broken the moment a real
 * Asaas webhook landed in production.
 *
 * This module gives the webhook job a single async function it can
 * call inside an Inngest `step.run` to bring the ledger up to date
 * via the SECURITY DEFINER `confirm_payment_atomic` SQL function.
 * The SQL function is the same one the manual path uses when the
 * `payments.atomic_confirm` feature flag is on; the webhook always
 * calls it (no flag check) because for the webhook there is no
 * "legacy path" to fall back to — confirming via webhook is itself
 * the new behaviour, additive on top of the manual path that already
 * works in production.
 *
 * Idempotency
 * -----------
 * Three layers protect against double-processing:
 *
 *   1. The job has a `POST_PAYMENT_STATES` early-exit on the order's
 *      current status. If the manual path already advanced the order,
 *      this function is never called.
 *   2. This function fetches the latest payments for the order and
 *      only invokes the RPC if at least one is `PENDING`. If all are
 *      already `CONFIRMED` / `REFUNDED`, it returns
 *      `skipped: 'all_payments_processed'` without touching anything.
 *   3. The SQL function itself uses `WHERE status = 'PENDING'` on its
 *      UPDATE; if a race lets two callers both reach the RPC, the
 *      loser gets `already_processed` and we surface that as a
 *      benign skip.
 *
 * What about an orphan order with NO payment row?
 *   That means the checkout flow created the order in the gateway
 *   but failed to persist the `payments` row locally — a bug we'd
 *   want to know about. We THROW so Inngest retries 3× and surfaces
 *   the alarm; the operator can then run a manual confirm or open
 *   the F5 reconcile cron (next item on the S1 plan).
 *
 * Metrics
 * -------
 *   webhook_ledger_total{outcome}      — labelled per branch
 *   webhook_ledger_duration_ms          — histogram
 *
 * @module lib/payments/confirm-via-webhook
 */

import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { confirmPaymentAtomic } from '@/lib/services/atomic.server'
import { SYSTEM_USER_ID } from '@/lib/constants/system-user'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

/**
 * Maps the Asaas `billingType` string to the internal `payment_method`
 * value that gets recorded on `payments.payment_method` and on the
 * `order_status_history.reason` text. Unknown / undefined values fall
 * back to `'ASAAS'` so the column is never empty and operators can
 * still tell the source.
 */
export function mapAsaasBillingTypeToPaymentMethod(billingType?: string | null): string {
  switch (billingType) {
    case 'PIX':
      return 'PIX'
    case 'CREDIT_CARD':
      return 'CREDIT_CARD'
    case 'DEBIT_CARD':
      return 'DEBIT_CARD'
    case 'BOLETO':
      return 'BOLETO'
    case 'TRANSFER':
      return 'TRANSFER'
    default:
      return 'ASAAS'
  }
}

export interface ConfirmViaWebhookInput {
  orderId: string
  asaasEvent: string
  asaasPaymentId: string
  billingType?: string | null
}

export type ConfirmViaWebhookResult =
  | {
      ok: true
      action: 'confirmed'
      paymentId: string
      paymentMethod: string
    }
  | {
      ok: true
      action: 'skipped'
      reason: 'all_payments_processed' | 'rpc_already_processed' | 'rpc_stale_version'
    }

/** Thrown when the webhook lacks a corresponding local payment row.
 *  The Inngest job catches `Error` generically — message is logged
 *  and the job is retried by Inngest's policy. */
export class WebhookLedgerError extends Error {
  readonly code: 'no_payment_row' | 'fetch_failed' | 'rpc_failed'
  readonly orderId: string
  constructor(code: WebhookLedgerError['code'], orderId: string, message: string) {
    super(message)
    this.name = 'WebhookLedgerError'
    this.code = code
    this.orderId = orderId
  }
}

/**
 * Brings the financial ledger up to date for an order that the Asaas
 * gateway just confirmed. See module docstring for idempotency model.
 *
 * Returns `{ ok: true, action: 'confirmed' | 'skipped' }` on success
 * (including idempotent skips). Throws `WebhookLedgerError` on
 * unrecoverable problems so the caller / Inngest can retry.
 */
export async function confirmPaymentViaAsaasWebhook(
  input: ConfirmViaWebhookInput
): Promise<ConfirmViaWebhookResult> {
  const started = Date.now()

  const admin = createAdminClient()

  const { data: payments, error: fetchErr } = await admin
    .from('payments')
    .select('id, status, lock_version')
    .eq('order_id', input.orderId)
    .order('created_at', { ascending: false })

  if (fetchErr) {
    incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'error_fetch_failed' })
    observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
    logger.error('[asaas-webhook-ledger] payments fetch failed', {
      orderId: input.orderId,
      error: fetchErr.message,
    })
    throw new WebhookLedgerError(
      'fetch_failed',
      input.orderId,
      `payments fetch failed: ${fetchErr.message}`
    )
  }

  if (!payments || payments.length === 0) {
    incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'error_no_payment' })
    observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
    logger.error('[asaas-webhook-ledger] no payment row for order', {
      orderId: input.orderId,
      asaasPaymentId: input.asaasPaymentId,
    })
    throw new WebhookLedgerError(
      'no_payment_row',
      input.orderId,
      `No payment row for order ${input.orderId} — possible checkout race or external orphan`
    )
  }

  const pendingPayment = payments.find((p) => p.status === 'PENDING')
  if (!pendingPayment) {
    incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'skipped_all_processed' })
    observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
    logger.info('[asaas-webhook-ledger] no PENDING payment, skipping', {
      orderId: input.orderId,
      paymentStatuses: payments.map((p) => p.status),
    })
    return { ok: true, action: 'skipped', reason: 'all_payments_processed' }
  }

  const paymentMethod = mapAsaasBillingTypeToPaymentMethod(input.billingType)

  const { error: rpcErr } = await confirmPaymentAtomic(pendingPayment.id, {
    paymentMethod,
    referenceCode: input.asaasPaymentId,
    notes: `Confirmed via Asaas webhook (${input.asaasEvent})`,
    confirmedByUserId: SYSTEM_USER_ID,
    expectedLockVersion: pendingPayment.lock_version ?? 0,
  })

  if (rpcErr) {
    if (rpcErr.reason === 'already_processed') {
      incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'skipped_already_processed' })
      observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
      logger.info('[asaas-webhook-ledger] payment already processed (race)', {
        orderId: input.orderId,
        paymentId: pendingPayment.id,
      })
      return { ok: true, action: 'skipped', reason: 'rpc_already_processed' }
    }
    if (rpcErr.reason === 'stale_version') {
      incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'skipped_stale_version' })
      observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
      logger.info('[asaas-webhook-ledger] stale lock_version (race)', {
        orderId: input.orderId,
        paymentId: pendingPayment.id,
      })
      return { ok: true, action: 'skipped', reason: 'rpc_stale_version' }
    }
    incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'error_rpc_failed' })
    observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
    logger.error('[asaas-webhook-ledger] confirm_payment_atomic failed', {
      orderId: input.orderId,
      paymentId: pendingPayment.id,
      reason: rpcErr.reason,
    })
    throw new WebhookLedgerError(
      'rpc_failed',
      input.orderId,
      `confirm_payment_atomic returned ${rpcErr.reason}`
    )
  }

  incCounter(Metrics.WEBHOOK_LEDGER_TOTAL, { outcome: 'confirmed' })
  observeHistogram(Metrics.WEBHOOK_LEDGER_DURATION_MS, Date.now() - started)
  logger.info('[asaas-webhook-ledger] payment confirmed via webhook', {
    orderId: input.orderId,
    paymentId: pendingPayment.id,
    paymentMethod,
  })

  return {
    ok: true,
    action: 'confirmed',
    paymentId: pendingPayment.id,
    paymentMethod,
  }
}
