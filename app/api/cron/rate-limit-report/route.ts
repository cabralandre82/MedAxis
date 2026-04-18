/**
 * GET /api/cron/rate-limit-report — Wave 10.
 *
 * Aggregates the last 60 minutes of `rate_limit_violations`
 * and pages on-call when abuse patterns appear. Runs every 15
 * minutes via `vercel.json`.
 *
 * ### Alert ladder
 *
 *   - **P3 (info)**  — < 10 distinct IPs in the last hour. Quiet.
 *   - **P2 (warn)**  — 10–49 distinct IPs OR one IP with
 *     > 100 hits in an hour. `rate-limit-abuse.md` runbook,
 *     dedupKey `rate-limit:spike`.
 *   - **P1 (crit)**  — 50+ distinct IPs, OR any single IP with
 *     > 500 hits, OR > 5 distinct buckets hit by one IP
 *     (indicates credential-stuffing / scanner). Page immediately.
 *
 * ### Retention
 *
 * Every run also calls `rate_limit_purge_old(30)` so the table
 * stays small. Deletion count is logged but does not influence
 * alerting.
 *
 * ### Metrics emitted
 *
 *   rate_limit_suspicious_ips_total — absolute count of IPs in
 *     the last-hour report. Gauge-like, emitted once per run.
 *
 * The endpoint is idempotent: re-running twice within the same
 * minute produces the same verdict (the violation table is
 * minute-bucketed, and PagerDuty dedup keys collapse repeats).
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, Metrics } from '@/lib/metrics'
import { classifyReport, type ReportRow } from '@/lib/cron/rate-limit-report-helpers'

export const GET = withCronGuard('rate-limit-report', async () => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('rate_limit_report_view')
    .select(
      'ip_hash, distinct_buckets, total_hits, last_seen_at, first_seen_at, buckets, sample_user_id'
    )

  if (error) {
    logger.error('[rate-limit-report] query failed', { error })
    throw new Error(`rate_limit_report_view query failed: ${error.message}`)
  }

  const rows = (data ?? []) as ReportRow[]
  const verdict = classifyReport(rows)

  incCounter(Metrics.RATE_LIMIT_SUSPICIOUS_IPS_TOTAL, { severity: verdict.severity }, rows.length)

  // ── Retention ──────────────────────────────────────────────
  // 30 days is plenty for trend analysis. The service_role
  // executes directly under the RPC's SECURITY DEFINER.
  let purgedCount = 0
  try {
    const { data: purged, error: purgeErr } = await admin.rpc('rate_limit_purge_old', {
      p_retention_days: 30,
    })
    if (purgeErr) {
      logger.warn('[rate-limit-report] purge failed', { error: purgeErr })
    } else {
      purgedCount = Number(purged ?? 0)
    }
  } catch (err) {
    logger.warn('[rate-limit-report] purge threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── Alert dispatch ─────────────────────────────────────────
  if (verdict.severity !== 'info') {
    try {
      const { triggerAlert } = await import('@/lib/alerts')
      await triggerAlert({
        severity: verdict.severity === 'critical' ? 'critical' : 'warning',
        title: `Rate-limit anomaly — ${verdict.reason}`,
        message:
          `Runbook: docs/runbooks/rate-limit-abuse.md\n` +
          `Top offenders (ip_hash prefix · total_hits · buckets):\n` +
          verdict.topOffenders
            .map(
              (r) => `- ${r.ip_hash.slice(0, 12)}… · ${r.total_hits} hits · ${r.buckets.join(',')}`
            )
            .join('\n'),
        dedupKey:
          verdict.severity === 'critical' ? 'rate-limit:spike:crit' : 'rate-limit:spike:warn',
        component: 'cron/rate-limit-report',
        customDetails: {
          reason: verdict.reason,
          distinctIps: rows.length,
          topOffenders: verdict.topOffenders.map((r) => ({
            ipHashPrefix: r.ip_hash.slice(0, 12),
            totalHits: r.total_hits,
            distinctBuckets: r.distinct_buckets,
            buckets: r.buckets,
            lastSeenAt: r.last_seen_at,
          })),
        },
      })
    } catch (alertErr) {
      logger.error('[rate-limit-report] alert dispatch failed', { error: alertErr })
    }
  }

  logger.info('[rate-limit-report] run complete', {
    distinctIps: rows.length,
    severity: verdict.severity,
    reason: verdict.reason,
    purgedCount,
  })

  return {
    severity: verdict.severity,
    reason: verdict.reason,
    distinctIps: rows.length,
    purgedCount,
  }
})
