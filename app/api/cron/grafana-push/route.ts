/**
 * GET /api/cron/grafana-push — Pre-Launch Onda S1 / T6.
 *
 * Pushes the in-memory metrics snapshot of THIS Vercel isolate to
 * Grafana Cloud's Prometheus remote_write endpoint every 60s, where
 * the dashboard at `<stack>.grafana.net` reads from.
 *
 * Why a cron and not an after-each-request hook
 * --------------------------------------------
 *
 * Each isolate has its own `lib/metrics.ts` registry. Vercel pings the
 * cron URL on schedule, hitting some isolate at random — the same one
 * that's been serving traffic, the same registry that traffic is
 * mutating. So the snapshot the cron reads matches what users were
 * doing on that isolate. After 60s the isolate may recycle, the next
 * cron lands on a different isolate, and so on. Grafana sees a
 * mosaic of points across isolates over time, which is exactly the
 * shape we want for rate/p95/burn-rate queries.
 *
 * If we hooked into the request middleware we'd send metrics every
 * request — orders of magnitude more cost for marginal staleness
 * improvement.
 *
 * Output shape (when wrapped by `withCronGuard`):
 *
 *   { ok: true, job: 'grafana-push', runId, durationMs,
 *     result: { outcome, timeseriesCount, durationMs,
 *               httpStatus?, errorMessage? } }
 *
 * - `outcome=success` — happy path, ~150-300 timeseries pushed.
 * - `outcome=error` — Grafana rejected. Log warns; runbook
 *   `docs/runbooks/grafana-push.md` triages.
 * - `outcome=skipped_no_env` — env vars unset (Development env or
 *   token rotated mid-deploy). NOT an alert condition.
 * - `outcome=skipped_empty` — fresh isolate with no metrics emitted
 *   yet. Rare; expected during cold-start window.
 */

import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { setGauge, observeHistogram, incCounter, Metrics } from '@/lib/metrics'
import { pushMetricsToGrafana } from '@/lib/observability/grafana-push'

export const GET = withCronGuard(
  'grafana-push',
  async () => {
    const out = await pushMetricsToGrafana()

    setGauge(Metrics.GRAFANA_PUSH_LAST_RUN_TS, Math.floor(Date.now() / 1000))
    setGauge(Metrics.GRAFANA_PUSH_TIMESERIES_COUNT, out.timeseriesCount)
    observeHistogram(Metrics.GRAFANA_PUSH_DURATION_MS, out.durationMs, {
      outcome: out.outcome,
    })
    incCounter(Metrics.GRAFANA_PUSH_TOTAL, { outcome: out.outcome })

    if (out.outcome === 'success') {
      logger.info('[grafana-push] cron pushed metrics', {
        timeseriesCount: out.timeseriesCount,
        durationMs: out.durationMs,
        httpStatus: out.httpStatus,
      })
    } else if (out.outcome === 'skipped_no_env') {
      // Development environments / fresh forks: not an issue, but
      // log once-per-cycle so an operator can spot a misconfigured
      // preview deploy.
      logger.info('[grafana-push] skipped (env vars not configured)', {
        outcome: out.outcome,
      })
    } else if (out.outcome === 'skipped_empty') {
      logger.info('[grafana-push] skipped (registry empty)', {
        outcome: out.outcome,
      })
    } else {
      // outcome === 'error' — Grafana rejected. Cron stays green
      // (we've already absorbed the error and stamped metrics) but
      // surface the failure so a runbook trigger can fire.
      logger.warn('[grafana-push] push failed — Grafana rejected', {
        timeseriesCount: out.timeseriesCount,
        durationMs: out.durationMs,
        httpStatus: out.httpStatus,
        errorMessage: out.errorMessage,
      })
    }

    return out
  },
  // 60-second TTL matches the cron cadence + leaves no overlap. If
  // a single push takes more than 30s we have other problems
  // (Grafana Cloud SLA is 99.9% with sub-100ms p95).
  { ttlSeconds: 60 }
)

export const POST = GET
