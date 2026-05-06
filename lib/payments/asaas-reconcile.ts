/**
 * Asaas reconciliation — fail-safe last resort for the webhook ledger.
 *
 * Pre-Launch Onda S1 / F5
 * -----------------------
 * F1 made the Asaas webhook chamber call `confirm_payment_atomic` so a
 * real PIX/cartão never silently bypasses the financial ledger. F5
 * is the safety net: if the webhook itself failed (Inngest retried 3×
 * and dead-lettered, gateway never delivered the event, network
 * partition during the retry window…), we still need the order to
 * make it to the pharmacy queue with a correct ledger.
 *
 * Strategy — REUSE F1, don't fork the path
 * ----------------------------------------
 * This module deliberately does NOT introduce a new code path for
 * confirming payments. It calls the same `confirmPaymentViaAsaasWebhook`
 * function the webhook job uses; the triple-idempotency guard there
 * (POST_PAYMENT_STATES, `status='PENDING'` filter, RPC `WHERE
 * status='PENDING'`) protects every race we can imagine:
 *
 *   - F5 runs while webhook is still retrying → RPC sees PENDING
 *     once, the loser receives `already_processed`, F5 reports skip.
 *   - F5 runs and the manual super-admin path is in flight → same
 *     resolution.
 *   - Two F5 invocations overlap → `withCronGuard` lock prevents it.
 *
 * Loop
 * ----
 *   1. Query local: payments WHERE status='PENDING' AND
 *      asaas_payment_id IS NOT NULL AND created_at > now() - 7 days
 *      LIMIT 50.
 *   2. For each, call `getPayment(asaas_payment_id)` against the
 *      Asaas API.
 *   3. Translate Asaas status into one of three buckets:
 *      - confirmed_in_gateway → call `confirmPaymentViaAsaasWebhook`
 *      - still_pending        → skip silent (cliente ainda não pagou)
 *      - gateway_lost         → log info (canceled/overdue/expired)
 *   4. On any HTTP error, log + count `error`, continue loop.
 *   5. Return per-payment outcomes for the cron caller to surface.
 *
 * Why 7 days and 50/run
 * ---------------------
 * 7 days: any Asaas payment older than that is OVERDUE/EXPIRED on
 * the gateway side; resolving older orders is a separate flow
 * (back-office reconcile / manual). We bound the scan window to
 * keep latency predictable.
 *
 * 50/run: Asaas rate limit is roughly 60 req/min. With a 15 min
 * cron cadence we have plenty of headroom; in steady state we
 * expect 0 PENDING (webhook works), so 50 is a worst-case floor.
 *
 * Metrics
 * -------
 *   asaas_reconcile_total{outcome}
 *     - scanned                — every PENDING payment we examined
 *     - reconciled             — every payment we successfully advanced
 *     - gateway_pending        — Asaas still says PENDING; skip silent
 *     - gateway_lost           — Asaas says OVERDUE/CANCELLED/etc.
 *     - error_gateway_unavailable
 *     - error_local_advance    — confirm-via-webhook helper threw
 *
 *   asaas_reconcile_recovered_total — convenience counter (= reconciled)
 *   asaas_reconcile_duration_ms     — histogram for the whole run
 *   asaas_reconcile_last_run_ts     — gauge for staleness alerting
 *
 * @module lib/payments/asaas-reconcile
 */

import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { getPayment } from '@/lib/asaas'
import {
  confirmPaymentViaAsaasWebhook,
  WebhookLedgerError,
} from '@/lib/payments/confirm-via-webhook'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

/** How a single payment ended up after reconciliation attempt. */
export type ReconcileOutcome =
  | 'reconciled'
  | 'gateway_pending'
  | 'gateway_lost'
  | 'error_gateway_unavailable'
  | 'error_local_advance'

export interface ReconcileItemResult {
  paymentId: string
  orderId: string
  asaasPaymentId: string
  outcome: ReconcileOutcome
  /** Raw Asaas status when we got a response; null on gateway errors. */
  asaasStatus: string | null
  /** Free-text detail used in logs / alerts. */
  detail?: string
}

export interface ReconcileResult {
  scanned: number
  reconciled: number
  gatewayPending: number
  gatewayLost: number
  errors: number
  /** Shaped per-item record so the cron can include a sample in alerts. */
  items: ReconcileItemResult[]
}

export interface ReconcileOptions {
  /** Days back to scan. Default 7. */
  windowDays?: number
  /** Max payments to scan per run. Default 50. */
  limit?: number
}

/** Bucket Asaas's gateway statuses into reconciliation actions.
 *  Asaas docs list these status values for `GET /payments/{id}`:
 *    PENDING, AWAITING_RISK_ANALYSIS, APPROVED_BY_RISK_ANALYSIS,
 *    AUTHORIZED, RECEIVED, CONFIRMED, RECEIVED_IN_CASH,
 *    OVERDUE, REFUNDED, REFUND_REQUESTED, REFUND_IN_PROGRESS,
 *    CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE, AWAITING_CHARGEBACK_REVERSAL,
 *    DUNNING_REQUESTED, DUNNING_RECEIVED, AWAITING_CANCELLATION,
 *    CANCELLED.
 */
export function classifyAsaasStatus(
  status: string
): 'confirmed_in_gateway' | 'still_pending' | 'gateway_lost' | 'unknown' {
  switch (status) {
    case 'CONFIRMED':
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return 'confirmed_in_gateway'
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
    case 'APPROVED_BY_RISK_ANALYSIS':
    case 'AUTHORIZED':
      return 'still_pending'
    case 'OVERDUE':
    case 'CANCELLED':
    case 'AWAITING_CANCELLATION':
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'gateway_lost'
    default:
      return 'unknown'
  }
}

interface PendingPaymentRow {
  id: string
  order_id: string
  asaas_payment_id: string | null
  created_at: string
}

/**
 * Examines local PENDING payments against the Asaas gateway and
 * triggers ledger confirmation for any that the gateway already
 * confirmed. Idempotent and safe to invoke concurrently with the
 * webhook job — the underlying RPC's optimistic locking handles
 * the race.
 */
export async function reconcileAsaasPayments(
  opts: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const started = Date.now()
  const windowDays = Math.max(1, Math.floor(opts.windowDays ?? 7))
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)))

  const admin = createAdminClient()

  const cutoffISO = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  // We deliberately use a non-null filter on `asaas_payment_id`. A
  // payment can be PENDING with a null gateway id when the local
  // checkout failed mid-flight (e.g. the gateway POST never returned
  // 200). Those orphans are a different flow — they need the user to
  // retry or super-admin to manually inspect. Reconciliation has no
  // gateway side to compare against, so skipping is correct.
  const { data, error } = await admin
    .from('payments')
    .select('id, order_id, asaas_payment_id, created_at')
    .eq('status', 'PENDING')
    .not('asaas_payment_id', 'is', null)
    .gte('created_at', cutoffISO)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error('[asaas-reconcile] payments fetch failed', { error: error.message })
    observeHistogram(Metrics.ASAAS_RECONCILE_DURATION_MS, Date.now() - started)
    incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'error_query_failed' })
    throw new Error(`asaas-reconcile: payments fetch failed: ${error.message}`)
  }

  const rows = (data ?? []) as PendingPaymentRow[]

  if (rows.length === 0) {
    logger.info('[asaas-reconcile] no PENDING payments in window', {
      windowDays,
      limit,
    })
    observeHistogram(Metrics.ASAAS_RECONCILE_DURATION_MS, Date.now() - started)
    incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'scanned' }, 0)
    return {
      scanned: 0,
      reconciled: 0,
      gatewayPending: 0,
      gatewayLost: 0,
      errors: 0,
      items: [],
    }
  }

  const results: ReconcileItemResult[] = []
  let reconciled = 0
  let gatewayPending = 0
  let gatewayLost = 0
  let errors = 0

  for (const row of rows) {
    incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'scanned' })

    if (!row.asaas_payment_id) continue

    let gatewayStatus: string | null = null
    let billingType: string | undefined

    try {
      const gw = await getPayment(row.asaas_payment_id)
      gatewayStatus = gw.status
      billingType = gw.billingType
    } catch (gwErr) {
      errors += 1
      const message = gwErr instanceof Error ? gwErr.message : String(gwErr)
      logger.warn('[asaas-reconcile] gateway fetch failed', {
        paymentId: row.id,
        asaasPaymentId: row.asaas_payment_id,
        error: message,
      })
      incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'error_gateway_unavailable' })
      results.push({
        paymentId: row.id,
        orderId: row.order_id,
        asaasPaymentId: row.asaas_payment_id,
        outcome: 'error_gateway_unavailable',
        asaasStatus: null,
        detail: message,
      })
      continue
    }

    const klass = classifyAsaasStatus(gatewayStatus)

    if (klass === 'still_pending' || klass === 'unknown') {
      // 'unknown' falls into still_pending so we don't accidentally
      // mark a CHARGEBACK_DISPUTE_REVERSED-style new state as lost.
      // Conservative: treat the unknown the same as PENDING and log.
      if (klass === 'unknown') {
        logger.warn('[asaas-reconcile] unknown Asaas status, treating as still_pending', {
          paymentId: row.id,
          asaasStatus: gatewayStatus,
        })
      }
      gatewayPending += 1
      incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'gateway_pending' })
      results.push({
        paymentId: row.id,
        orderId: row.order_id,
        asaasPaymentId: row.asaas_payment_id,
        outcome: 'gateway_pending',
        asaasStatus: gatewayStatus,
      })
      continue
    }

    if (klass === 'gateway_lost') {
      // Asaas reports the charge as OVERDUE/CANCELLED/REFUNDED/etc.
      // The local payment row stays PENDING — the right move is
      // OPERATOR-driven (manual cancel/refund). We log info so this
      // shows up in dashboards but don't fire an alert from the
      // cron itself; persistent gateway_lost is the symptom of a
      // separate, orchestrator-level problem.
      gatewayLost += 1
      incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'gateway_lost' })
      logger.info('[asaas-reconcile] gateway lost (overdue/cancelled/refunded)', {
        paymentId: row.id,
        orderId: row.order_id,
        asaasStatus: gatewayStatus,
      })
      results.push({
        paymentId: row.id,
        orderId: row.order_id,
        asaasPaymentId: row.asaas_payment_id,
        outcome: 'gateway_lost',
        asaasStatus: gatewayStatus,
      })
      continue
    }

    // klass === 'confirmed_in_gateway' → bring the local ledger up to date.
    try {
      const ledger = await confirmPaymentViaAsaasWebhook({
        orderId: row.order_id,
        asaasEvent: 'PAYMENT_RECONCILED',
        asaasPaymentId: row.asaas_payment_id,
        billingType,
      })

      if (ledger.action === 'confirmed') {
        reconciled += 1
        incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'reconciled' })
        incCounter(Metrics.ASAAS_RECONCILE_RECOVERED_TOTAL)
        // Info-level so it lights up the dashboard. Webhook missing
        // a confirmation is a real signal even if F5 papered over it.
        logger.info('[asaas-reconcile] webhook missed — recovered via cron', {
          paymentId: row.id,
          orderId: row.order_id,
          asaasPaymentId: row.asaas_payment_id,
          asaasStatus: gatewayStatus,
        })
        results.push({
          paymentId: row.id,
          orderId: row.order_id,
          asaasPaymentId: row.asaas_payment_id,
          outcome: 'reconciled',
          asaasStatus: gatewayStatus,
          detail: 'recovered via cron after webhook missed it',
        })
      } else {
        // Action 'skipped' — manual path or earlier F5 run already
        // processed the payment. Idempotent no-op.
        gatewayPending += 1
        incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'gateway_pending' })
        logger.debug('[asaas-reconcile] confirm-via-webhook returned skip', {
          paymentId: row.id,
          reason: ledger.reason,
        })
        results.push({
          paymentId: row.id,
          orderId: row.order_id,
          asaasPaymentId: row.asaas_payment_id,
          outcome: 'gateway_pending',
          asaasStatus: gatewayStatus,
          detail: `skipped: ${ledger.reason}`,
        })
      }
    } catch (advanceErr) {
      errors += 1
      const message = advanceErr instanceof Error ? advanceErr.message : String(advanceErr)
      const code = advanceErr instanceof WebhookLedgerError ? advanceErr.code : 'unknown'
      logger.error('[asaas-reconcile] confirm-via-webhook threw', {
        paymentId: row.id,
        orderId: row.order_id,
        code,
        error: message,
      })
      incCounter(Metrics.ASAAS_RECONCILE_TOTAL, { outcome: 'error_local_advance' })
      results.push({
        paymentId: row.id,
        orderId: row.order_id,
        asaasPaymentId: row.asaas_payment_id,
        outcome: 'error_local_advance',
        asaasStatus: gatewayStatus,
        detail: `${code}: ${message}`,
      })
    }
  }

  observeHistogram(Metrics.ASAAS_RECONCILE_DURATION_MS, Date.now() - started)

  return {
    scanned: rows.length,
    reconciled,
    gatewayPending,
    gatewayLost,
    errors,
    items: results,
  }
}
