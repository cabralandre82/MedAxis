/**
 * Pure helpers for the `/api/cron/backup-freshness` route — Wave 12.
 *
 * Why this file exists
 * --------------------
 * Next.js 15.5 forbids route handlers (`route.ts`) from exporting any
 * symbol other than the standard HTTP verbs and the route-config fields
 * (`dynamic`, `runtime`, `maxDuration`, …). The build fails with:
 *
 *   Type error: "diagnoseFreshness" is not a valid Route export field.
 *
 * The cron route used to inline `diagnoseFreshness()` and the `Diagnosis`
 * type so the unit tests could import them directly. Moving them here
 * keeps the helpers pure-and-testable while making the route file
 * conform to Next's stricter contract.
 *
 * Anything that touches I/O (DB, R2, alerts) stays in the route file.
 */
import { BACKUP_SLA, type BackupFreshnessRow } from '@/lib/backup'

export interface Diagnosis {
  label: string
  kind: BackupFreshnessRow['kind']
  reason: 'missing' | 'stale' | 'last_failed' | 'chain_break'
  ageSeconds: number | null
  lastOutcome?: BackupFreshnessRow['outcome']
  recordedAt?: string
  r2Prefix?: string | null
}

/**
 * Pure classifier — exported for unit tests. Takes the latest
 * row per (kind,label) and returns the set of SLA breaches.
 *
 * We *expect* `weekly` BACKUP and `monthly` RESTORE_DRILL
 * labels; missing labels are treated as a hard breach with
 * reason='missing'. That way a silently-disabled workflow does
 * not look healthy.
 */
export function diagnoseFreshness(
  rows: BackupFreshnessRow[],
  chainBreaks: { kind: BackupFreshnessRow['kind']; firstBreakId: string | null }[]
): Diagnosis[] {
  const out: Diagnosis[] = []
  const byKey = new Map<string, BackupFreshnessRow>()
  for (const r of rows) byKey.set(`${r.kind}:${r.label}`, r)

  const expected: Array<{
    kind: BackupFreshnessRow['kind']
    label: string
    maxAge: number
  }> = [
    { kind: 'BACKUP', label: 'weekly', maxAge: BACKUP_SLA.BACKUP_MAX_AGE_S },
    { kind: 'RESTORE_DRILL', label: 'monthly', maxAge: BACKUP_SLA.RESTORE_DRILL_MAX_AGE_S },
  ]

  for (const e of expected) {
    const row = byKey.get(`${e.kind}:${e.label}`)
    if (!row) {
      out.push({
        label: e.label,
        kind: e.kind,
        reason: 'missing',
        ageSeconds: null,
      })
      continue
    }
    if (row.outcome !== 'ok') {
      out.push({
        label: row.label,
        kind: row.kind,
        reason: 'last_failed',
        ageSeconds: row.age_seconds,
        lastOutcome: row.outcome,
        recordedAt: row.recorded_at,
        r2Prefix: row.r2_prefix,
      })
      continue
    }
    if (row.age_seconds > e.maxAge) {
      out.push({
        label: row.label,
        kind: row.kind,
        reason: 'stale',
        ageSeconds: row.age_seconds,
        lastOutcome: row.outcome,
        recordedAt: row.recorded_at,
        r2Prefix: row.r2_prefix,
      })
    }
  }

  for (const br of chainBreaks) {
    if (br.firstBreakId) {
      out.push({
        label: '*',
        kind: br.kind,
        reason: 'chain_break',
        ageSeconds: null,
      })
    }
  }

  return out
}
