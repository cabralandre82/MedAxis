/**
 * GET /api/cron/asaas-reconcile — Pre-Launch Onda S1 / F5.
 *
 * Fail-safe last resort for the Asaas webhook ledger.
 *
 * In steady state F1 (`lib/jobs/asaas-webhook.ts`) confirms every
 * payment via `confirm_payment_atomic` the moment the gateway pings
 * us. This cron exists for the corner cases where that path didn't
 * fire — Inngest retried 3× and dead-lettered, gateway never
 * delivered the event, deploy slot lost the in-flight retry, etc.
 *
 * Every 15 minutes:
 *   1. Ask the database for PENDING payments < 7 days old that
 *      have an `asaas_payment_id`.
 *   2. Hit `GET /payments/{id}` on Asaas for each.
 *   3. If the gateway already says CONFIRMED/RECEIVED, run the
 *      same `confirmPaymentViaAsaasWebhook` helper the webhook
 *      uses — same triple-idempotency guarantees, no duplicate
 *      ledger entries, no orphan order.
 *   4. Otherwise (still PENDING / OVERDUE / etc), log + count
 *      and move on.
 *
 * Why 15-min cadence
 * ------------------
 * A real PIX confirms in seconds. The webhook either fires
 * immediately or Inngest retries in 30s/2m/10m. If after 15 min
 * we still see PENDING we want to reconcile FAST so the pharmacy
 * can act on the order — but we don't want to hit the Asaas API
 * harder than necessary in steady state. 15 min is the same
 * cadence as `rate-limit-report` and well within the 60 req/min
 * Asaas limit even at 50 payments/run.
 *
 * Schedule entry: `*\/15 * * * *` in `vercel.json`.
 *
 * Output shape (when wrapped by `withCronGuard`):
 *
 *   { ok: true, job: 'asaas-reconcile', runId, durationMs,
 *     result: { scanned, reconciled, gatewayPending, gatewayLost,
 *               errors, items: [...] } }
 *
 * `reconciled > 0` is INFORMATIVE (cron caught a webhook miss).
 * `errors > 0` warrants investigation — see runbook
 * `docs/runbooks/asaas-reconcile.md`.
 */

import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { setGauge, Metrics } from '@/lib/metrics'
import { reconcileAsaasPayments } from '@/lib/payments/asaas-reconcile'

export const GET = withCronGuard(
  'asaas-reconcile',
  async () => {
    const out = await reconcileAsaasPayments()

    // Stamp the gauge regardless of the run's logical outcome — this
    // protects against "cron ran but found no work" silent staleness
    // alerts.
    setGauge(Metrics.ASAAS_RECONCILE_LAST_RUN_TS, Math.floor(Date.now() / 1000))

    if (out.reconciled > 0) {
      // Real signal: the webhook missed at least one payment.
      // Surface it loudly so we can investigate why F1 didn't catch it.
      logger.warn('[asaas-reconcile] cron recovered payment(s) — webhook missed', {
        reconciled: out.reconciled,
        scanned: out.scanned,
        sampleItems: out.items
          .filter((i) => i.outcome === 'reconciled')
          .slice(0, 5)
          .map((i) => ({
            paymentId: i.paymentId,
            orderId: i.orderId,
            asaasStatus: i.asaasStatus,
          })),
      })
    } else if (out.errors > 0) {
      logger.warn('[asaas-reconcile] cron completed with errors', {
        errors: out.errors,
        scanned: out.scanned,
        sampleErrors: out.items
          .filter((i) => i.outcome.startsWith('error_'))
          .slice(0, 5)
          .map((i) => ({
            paymentId: i.paymentId,
            outcome: i.outcome,
            detail: i.detail,
          })),
      })
    } else {
      logger.info('[asaas-reconcile] cron completed clean', {
        scanned: out.scanned,
        gatewayPending: out.gatewayPending,
        gatewayLost: out.gatewayLost,
      })
    }

    return out
  },
  // 5-minute TTL is plenty for a 50-payment/run loop bounded by
  // Asaas's ~100 ms latency per call (≈ 5 s p99). The lock TTL
  // doesn't bound the run — `withCronGuard` releases on success
  // — but provides a wedged-runner safety net.
  { ttlSeconds: 300 }
)

export const POST = GET
