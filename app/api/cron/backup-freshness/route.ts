/**
 * GET /api/cron/backup-freshness — Wave 12.
 *
 * Daily health check for the offsite backup + restore-drill
 * pipeline. It answers one question from inside the platform:
 *
 *   "Can we still restore from R2 today?"
 *
 * The actual heavy lifting (dump, encrypt, upload, restore)
 * happens on GitHub runners. This cron reads the **platform-side
 * ledger** (`public.backup_runs`, migration 053) and pages when:
 *
 *   - The newest successful `BACKUP` row is older than
 *     `BACKUP_SLA.BACKUP_MAX_AGE_S` (9 d default), OR
 *   - The newest successful `RESTORE_DRILL` row is older than
 *     `BACKUP_SLA.RESTORE_DRILL_MAX_AGE_S` (35 d default), OR
 *   - The chain verifier reports a linkage break (append-only
 *     tamper or missing row), OR
 *   - The most recent BACKUP row exists but has outcome='fail'
 *     and no subsequent 'ok' row has landed yet.
 *
 * Severity ladder mirrors the DSAR SLA cron:
 *   - `backup.freshness_enforce = OFF` → P2 warning (email only)
 *   - `backup.freshness_enforce = ON`  → P1 critical (PagerDuty)
 *
 * Deliberate non-goal: this cron does **not** validate archive
 * contents. A corrupt-but-present backup will still look fresh.
 * The monthly restore drill is what proves decryption + restore.
 *
 * Schedule: `0 9 * * *` in `vercel.json` (UTC = 06:00 BRT).
 */
import { withCronGuard } from '@/lib/cron/guarded'
import { getBackupFreshness, verifyBackupChain } from '@/lib/backup'
import { diagnoseFreshness } from '@/lib/cron/backup-freshness-helpers'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter, setGauge, Metrics } from '@/lib/metrics'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export const GET = withCronGuard('backup-freshness', async () => {
  const rows = await getBackupFreshness()

  // Always emit age gauges even when things are healthy so the
  // dashboard has a sparkline.
  for (const r of rows) {
    setGauge(Metrics.BACKUP_AGE_SECONDS, r.age_seconds, { kind: r.kind, label: r.label })
    if (r.kind === 'RESTORE_DRILL') {
      setGauge(Metrics.RESTORE_DRILL_AGE_SECONDS, r.age_seconds, { label: r.label })
    }
  }

  const [backupChain, drillChain] = await Promise.all([
    verifyBackupChain('BACKUP').catch((err) => {
      logger.error('[backup-freshness] chain verify BACKUP failed', { error: err })
      return { first_break_id: null, checked_rows: 0 }
    }),
    verifyBackupChain('RESTORE_DRILL').catch((err) => {
      logger.error('[backup-freshness] chain verify RESTORE_DRILL failed', { error: err })
      return { first_break_id: null, checked_rows: 0 }
    }),
  ])

  const chainBreaks = [
    { kind: 'BACKUP' as const, firstBreakId: backupChain.first_break_id },
    { kind: 'RESTORE_DRILL' as const, firstBreakId: drillChain.first_break_id },
  ]
  for (const br of chainBreaks) {
    if (br.firstBreakId) {
      incCounter(Metrics.BACKUP_CHAIN_BREAK_TOTAL, { kind: br.kind })
    }
  }

  const breaches = diagnoseFreshness(rows, chainBreaks)

  if (breaches.length === 0) {
    logger.info('[backup-freshness] all streams healthy', {
      module: 'backup-freshness',
      streams: rows.length,
    })
    return { streams: rows.length, breaches: 0 }
  }

  incCounter(Metrics.BACKUP_FRESHNESS_BREACH_TOTAL, {}, breaches.length)

  const enforce = await isFeatureEnabled('backup.freshness_enforce', {}).catch(() => false)
  const severity: 'critical' | 'warning' = enforce ? 'critical' : 'warning'

  try {
    const { triggerAlert } = await import('@/lib/alerts')
    await triggerAlert({
      severity,
      title: `Backup freshness SLA breach: ${breaches.length} stream(s)`,
      message:
        `See runbook docs/runbooks/backup-missing.md.\n\n` +
        breaches
          .map(
            (b) =>
              `- ${b.kind}/${b.label}: ${b.reason}` +
              (b.ageSeconds != null ? ` (age=${(b.ageSeconds / 86400).toFixed(1)}d)` : '') +
              (b.r2Prefix ? ` r2=${b.r2Prefix}` : '') +
              (b.lastOutcome && b.reason === 'last_failed' ? ` outcome=${b.lastOutcome}` : '')
          )
          .join('\n'),
      dedupKey: 'backup:freshness',
      component: 'cron/backup-freshness',
      customDetails: {
        enforce,
        breaches,
        rowsChecked: rows.length,
      },
    })
  } catch (err) {
    logger.error('[backup-freshness] alert dispatch failed', { error: err })
  }

  return {
    streams: rows.length,
    breaches: breaches.length,
    severity,
    enforce,
    diagnoses: breaches,
  }
})
