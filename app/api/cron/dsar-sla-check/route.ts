/**
 * GET /api/cron/dsar-sla-check — Wave 9 LGPD Art. 19 SLA enforcer.
 *
 * Scans `public.dsar_requests` for non-terminal rows and classifies
 * each by how close it is to the 15-calendar-day legal SLA:
 *
 *   - `BREACH`  sla_due_at already past          → P1 alert, auto-expire at +30d
 *   - `WARNING` within 3 days of sla_due_at      → P2 alert
 *   - `OK`      otherwise                        → bookkeeping only
 *
 * When `dsar.sla_enforce` is ON:
 *   - BREACH fires pages PagerDuty (P1, `lgpd:sla:breach`).
 *   - After alerting, `public.dsar_expire_stale(30)` is called to
 *     flip any request that sat unhandled for > 30 days past SLA to
 *     EXPIRED — terminal and audit-logged.
 *
 * When `dsar.sla_enforce` is OFF (default during rollout):
 *   - BREACH still paginates at P2 (warning) so on-call sees it.
 *   - The auto-expire step is SKIPPED so admins can recover the
 *     requests manually during the rollout window.
 *
 * Emits:
 *   - `dsar_sla_breach_total{kind}` and `dsar_sla_warning_total{kind}`.
 *   - `dsar_expired_total{via="cron"}` on auto-expire.
 *
 * Schedule: every hour via `vercel.json` (cheap — the index
 * `idx_dsar_requests_status_due` makes it a BTree seek).
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, Metrics } from '@/lib/metrics'
import { isFeatureEnabled } from '@/lib/features'

interface OpenRow {
  id: string
  kind: 'EXPORT' | 'ERASURE' | 'RECTIFICATION'
  status: 'RECEIVED' | 'PROCESSING'
  sla_due_at: string
  requested_at: string
  subject_user_id: string
}

const WARNING_WINDOW_DAYS = Number(process.env.DSAR_SLA_WARNING_DAYS ?? '3')
const EXPIRE_GRACE_DAYS = Number(process.env.DSAR_SLA_EXPIRE_GRACE_DAYS ?? '30')

export const GET = withCronGuard('dsar-sla-check', async () => {
  const admin = createAdminClient()
  const now = Date.now()
  const warningCutoff = new Date(now + WARNING_WINDOW_DAYS * 86400_000).toISOString()
  const nowIso = new Date(now).toISOString()

  const { data, error } = await admin
    .from('dsar_requests')
    .select('id, kind, status, sla_due_at, requested_at, subject_user_id')
    .in('status', ['RECEIVED', 'PROCESSING'])
    .lte('sla_due_at', warningCutoff)
    .order('sla_due_at', { ascending: true })

  if (error) {
    logger.error('[dsar-sla-check] query failed', { error })
    throw new Error(`dsar_requests query failed: ${error.message}`)
  }

  const rows = (data ?? []) as OpenRow[]
  const breaches: OpenRow[] = []
  const warnings: OpenRow[] = []

  for (const row of rows) {
    const dueMs = Date.parse(row.sla_due_at)
    if (dueMs <= now) {
      breaches.push(row)
      incCounter(Metrics.DSAR_SLA_BREACH_TOTAL, { kind: row.kind })
    } else {
      warnings.push(row)
      incCounter(Metrics.DSAR_SLA_WARNING_TOTAL, { kind: row.kind })
    }
  }

  const enforce = await isFeatureEnabled('dsar.sla_enforce', {})
  let expiredCount = 0

  if (breaches.length > 0) {
    // Fire alerts BEFORE expiring — we want on-call to see the
    // pre-expire state.
    try {
      const { triggerAlert } = await import('@/lib/alerts')
      await triggerAlert({
        severity: enforce ? 'critical' : 'warning',
        title: `LGPD DSAR SLA breach: ${breaches.length} request(s) past 15-day deadline`,
        message:
          `See runbook docs/runbooks/dsar-sla-missed.md. Sample:\n` +
          breaches
            .slice(0, 10)
            .map(
              (r) =>
                `- ${r.kind} #${r.id} subject=${r.subject_user_id} due=${r.sla_due_at} status=${r.status}`
            )
            .join('\n'),
        dedupKey: 'lgpd:dsar:sla:breach',
        component: 'cron/dsar-sla-check',
        customDetails: {
          breachCount: breaches.length,
          warningCount: warnings.length,
          enforce,
          sample: breaches.slice(0, 10).map((r) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            dueAt: r.sla_due_at,
          })),
        },
      })
    } catch (alertErr) {
      logger.error('[dsar-sla-check] alert dispatch failed', { error: alertErr })
    }

    // Auto-expire only when enforce flag is ON.
    if (enforce) {
      const { data: expired, error: expireErr } = await admin.rpc('dsar_expire_stale', {
        p_grace_days: EXPIRE_GRACE_DAYS,
      })
      if (expireErr) {
        logger.error('[dsar-sla-check] dsar_expire_stale failed', { error: expireErr })
      } else {
        expiredCount = Number(expired ?? 0)
        if (expiredCount > 0) {
          incCounter(Metrics.DSAR_EXPIRED_TOTAL, { via: 'cron' })
        }
      }
    }
  }

  // Warning-only alert (separate dedupKey so we don't silence the
  // breach alert when only warnings are present).
  if (breaches.length === 0 && warnings.length > 0) {
    try {
      const { triggerAlert } = await import('@/lib/alerts')
      await triggerAlert({
        severity: 'warning',
        title: `LGPD DSAR SLA warning: ${warnings.length} request(s) within ${WARNING_WINDOW_DAYS}d of deadline`,
        message:
          `Triage now to avoid breach. Sample:\n` +
          warnings
            .slice(0, 10)
            .map((r) => `- ${r.kind} #${r.id} subject=${r.subject_user_id} due=${r.sla_due_at}`)
            .join('\n'),
        dedupKey: 'lgpd:dsar:sla:warning',
        component: 'cron/dsar-sla-check',
        customDetails: {
          warningCount: warnings.length,
          sample: warnings.slice(0, 10).map((r) => ({
            id: r.id,
            kind: r.kind,
            dueAt: r.sla_due_at,
          })),
        },
      })
    } catch (alertErr) {
      logger.error('[dsar-sla-check] warning alert dispatch failed', { error: alertErr })
    }
  }

  logger.info('[dsar-sla-check] completed', {
    nowIso,
    breachCount: breaches.length,
    warningCount: warnings.length,
    expiredCount,
    enforce,
  })

  // Return 200 even with breaches — the cron's job is to SURFACE
  // them, not to mark itself failed. (Breach alerting happens via
  // triggerAlert. Only query errors bubble to 500.)
  return {
    breachCount: breaches.length,
    warningCount: warnings.length,
    expiredCount,
    enforce,
    warningWindowDays: WARNING_WINDOW_DAYS,
  }
})
