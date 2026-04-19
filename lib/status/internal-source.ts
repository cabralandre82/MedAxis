/**
 * Internal status data source — Wave Hardening II #7.
 *
 * Derives a public `StatusSummary` from data we already collect:
 *
 *   1. `cron_runs`   — every Vercel Cron invocation. `status='failed'`
 *                       maps to an outage on the component(s) that
 *                       cron is responsible for (DB, payments, …).
 *   2. `server_logs` — every error/warn the app emits. A spike of
 *                       errors maps to an outage on `app`. A spike on
 *                       routes under `/api/auth/*` also flips `auth`.
 *
 * This source intentionally does NOT call any external service: it is
 * the always-available fallback that runs even when Grafana Cloud
 * credentials are missing (which is exactly the case while we boot
 * the public page in Wave Hardening II).
 *
 * Algorithm (per component):
 *   - bucket the 90-day window into hourly slots,
 *   - mark a slot "bad" when its event count crosses a per-component
 *     threshold (see `COMPONENT_RULES`),
 *   - uptime = good_slots / total_slots,
 *   - incidents = maximal runs of consecutive bad slots, severity
 *     scaled by run length.
 *
 * The thresholds are deliberately generous — we want public incidents
 * to mirror what an operator would actually page on, not every flaky
 * cron retry. Tune via the constants below.
 *
 * @module lib/status/internal-source
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/db/admin'
import {
  type ComponentId,
  type ComponentUptime,
  type Incident,
  type IncidentSeverity,
  type StatusDataSource,
  type StatusSummary,
} from './types'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WINDOW_DAYS = 90

/** Component-level rules. Each rule names:
 *   - which event source feeds it,
 *   - a row-level predicate (executed in JS after the bulk fetch so we
 *     keep the query count down to two per page-load),
 *   - the per-hour count above which a slot is considered "bad",
 *   - the public label / description.
 */
interface ComponentRule {
  id: ComponentId
  label: string
  description: string
  /** Which raw stream classifies this component. */
  source: 'cron_runs' | 'server_logs' | 'both'
  /** Predicate over a `cron_runs` row. */
  matchCronRun?: (row: CronRunRow) => boolean
  /** Predicate over a `server_logs` row. */
  matchServerLog?: (row: ServerLogRow) => boolean
  /** Hourly count above which a slot is "bad". */
  badThresholdPerHour: number
}

interface CronRunRow {
  job_name: string
  status: string
  started_at: string
}

interface ServerLogRow {
  level: string
  route: string | null
  created_at: string
}

const COMPONENT_RULES: readonly ComponentRule[] = [
  {
    id: 'app',
    label: 'Aplicação Web',
    description: 'Front-end Next.js + API REST',
    source: 'server_logs',
    matchServerLog: (r) => r.level === 'error',
    // Production baseline is ~5–15 errors/hour from tail latency and
    // user-cancelled requests. We page above 50 to avoid noise.
    badThresholdPerHour: 50,
  },
  {
    id: 'database',
    label: 'Banco de Dados',
    description: 'Postgres (Supabase) — schema público',
    source: 'cron_runs',
    matchCronRun: (r) => r.status === 'failed',
    // Strictly greater than: 0 ⇒ any single failed cron in an hour
    // is a bad slot, since cron failures almost always indicate a DB
    // or RPC issue.
    badThresholdPerHour: 0,
  },
  {
    id: 'auth',
    label: 'Autenticação',
    description: 'JWT, refresh, MFA, RBAC',
    source: 'server_logs',
    matchServerLog: (r) => r.level === 'error' && (r.route?.startsWith('/api/auth') ?? false),
    badThresholdPerHour: 10,
  },
  {
    id: 'payments',
    label: 'Pagamentos',
    description: 'Asaas (PIX, boleto, cartão) e reconciliação financeira',
    source: 'cron_runs',
    matchCronRun: (r) =>
      r.status === 'failed' &&
      (r.job_name.includes('asaas') ||
        r.job_name.includes('reconcile') ||
        r.job_name.includes('payment')),
    badThresholdPerHour: 0,
  },
  {
    id: 'integrations',
    label: 'Integrações externas',
    description: 'Webhooks Asaas/Clicksign/Inngest, SMS, e-mail, IA',
    source: 'cron_runs',
    matchCronRun: (r) =>
      r.status === 'failed' &&
      (r.job_name.includes('webhook') ||
        r.job_name.includes('inngest') ||
        r.job_name.includes('zenvia') ||
        r.job_name.includes('resend')),
    badThresholdPerHour: 0,
  },
  {
    id: 'cron',
    label: 'Jobs agendados',
    description: 'Crons de retenção, reconciliação, RLS canary, backups',
    source: 'cron_runs',
    matchCronRun: (r) => r.status === 'failed',
    // Strictly greater than: a slot is bad when it has TWO OR MORE
    // failed crons in the same hour — keeps an isolated retry-once-
    // and-recover off the public board.
    badThresholdPerHour: 1,
  },
] as const

const ALL_COMPONENT_IDS = COMPONENT_RULES.map((c) => c.id)

// ── Public source ────────────────────────────────────────────────────────────

export class InternalStatusSource implements StatusDataSource {
  readonly name = 'internal' as const

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly admin: SupabaseClient<any, 'public', any> = createAdminClient()
  ) {}

  async build(now: Date = new Date()): Promise<StatusSummary> {
    const generatedAt = now.toISOString()
    const fromIso90 = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString()

    const [cronRuns, serverLogs] = await Promise.all([
      this.fetchCronRuns(fromIso90),
      this.fetchServerLogs(fromIso90),
    ])

    const components: ComponentUptime[] = COMPONENT_RULES.map((rule) =>
      classifyComponent(rule, cronRuns.rows, serverLogs.rows, now)
    )

    const incidents = collectIncidents(COMPONENT_RULES, cronRuns.rows, serverLogs.rows, now)

    const degraded = cronRuns.degraded || serverLogs.degraded
    const degradedReason =
      [cronRuns.error, serverLogs.error].filter(Boolean).join('; ') || undefined

    return {
      generatedAt,
      source: this.name,
      window: {
        sevenDays: window(now, 7),
        thirtyDays: window(now, 30),
        ninetyDays: window(now, 90),
      },
      components,
      incidents,
      degraded,
      degradedReason,
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async fetchCronRuns(
    fromIso: string
  ): Promise<{ rows: CronRunRow[]; degraded: boolean; error?: string }> {
    try {
      const { data, error } = await this.admin
        .from('cron_runs')
        .select('job_name,status,started_at')
        .gte('started_at', fromIso)
        .order('started_at', { ascending: true })
        .limit(50_000)

      if (error) return { rows: [], degraded: true, error: `cron_runs: ${error.message}` }
      return { rows: (data ?? []) as CronRunRow[], degraded: false }
    } catch (err) {
      return {
        rows: [],
        degraded: true,
        error: `cron_runs: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private async fetchServerLogs(
    fromIso: string
  ): Promise<{ rows: ServerLogRow[]; degraded: boolean; error?: string }> {
    try {
      const { data, error } = await this.admin
        .from('server_logs')
        .select('level,route,created_at')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: true })
        .limit(100_000)

      if (error) return { rows: [], degraded: true, error: `server_logs: ${error.message}` }
      return { rows: (data ?? []) as ServerLogRow[], degraded: false }
    } catch (err) {
      return {
        rows: [],
        degraded: true,
        error: `server_logs: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

// ── Pure classification helpers (exported for tests) ─────────────────────────

export interface BucketedSeries {
  /** Inclusive start of the first bucket (UTC ms). */
  startMs: number
  /** Bucket size in ms. */
  bucketMs: number
  /** Length = number of buckets in the window. Each entry is the count
   *  of matching events that fell into that bucket. */
  counts: number[]
}

/** Build an hourly histogram of matching events for a component, over
 *  a window ending at `now`. */
export function bucketize(
  rule: ComponentRule,
  cronRuns: CronRunRow[],
  serverLogs: ServerLogRow[],
  now: Date,
  windowDays: number = WINDOW_DAYS
): BucketedSeries {
  const totalMs = windowDays * DAY_MS
  const startMs = Math.floor((now.getTime() - totalMs) / HOUR_MS) * HOUR_MS
  const buckets = Math.ceil(totalMs / HOUR_MS)
  const counts = new Array<number>(buckets).fill(0)

  if (rule.source === 'cron_runs' || rule.source === 'both') {
    for (const row of cronRuns) {
      if (rule.matchCronRun && !rule.matchCronRun(row)) continue
      const t = Date.parse(row.started_at)
      if (!Number.isFinite(t)) continue
      const idx = Math.floor((t - startMs) / HOUR_MS)
      if (idx >= 0 && idx < buckets) counts[idx]!++
    }
  }
  if (rule.source === 'server_logs' || rule.source === 'both') {
    for (const row of serverLogs) {
      if (rule.matchServerLog && !rule.matchServerLog(row)) continue
      const t = Date.parse(row.created_at)
      if (!Number.isFinite(t)) continue
      const idx = Math.floor((t - startMs) / HOUR_MS)
      if (idx >= 0 && idx < buckets) counts[idx]!++
    }
  }

  return { startMs, bucketMs: HOUR_MS, counts }
}

/** Convert a bucket series into per-window uptime ratios, where uptime
 *  = (good buckets) / (total buckets). A bucket is "bad" when its
 *  count exceeds `badThresholdPerHour`. */
export function uptimeFromBuckets(
  series: BucketedSeries,
  threshold: number,
  now: Date
): ComponentUptime['uptime'] {
  const compute = (days: number): number | null => {
    const horizonMs = now.getTime() - days * DAY_MS
    let total = 0
    let bad = 0
    for (let i = 0; i < series.counts.length; i++) {
      const bucketStart = series.startMs + i * series.bucketMs
      if (bucketStart < horizonMs) continue
      total++
      if (series.counts[i]! > threshold) bad++
    }
    if (total === 0) return null
    return (total - bad) / total
  }

  return {
    sevenDays: compute(7),
    thirtyDays: compute(30),
    ninetyDays: compute(90),
  }
}

/** Build a `ComponentUptime` record from raw rows. */
export function classifyComponent(
  rule: ComponentRule,
  cronRuns: CronRunRow[],
  serverLogs: ServerLogRow[],
  now: Date
): ComponentUptime {
  const series = bucketize(rule, cronRuns, serverLogs, now)
  const uptime = uptimeFromBuckets(series, rule.badThresholdPerHour, now)

  // Current state: look at the LAST hour bucket only.
  const lastIdx = series.counts.length - 1
  const lastCount = lastIdx >= 0 ? series.counts[lastIdx]! : 0
  // Multiplier is at least 5 absolute events so a threshold of 0 still
  // requires a sizeable burst to be classified as `down` (otherwise a
  // single "any failure ⇒ bad slot" rule would jump straight from
  // operational to down).
  const downThreshold = Math.max(rule.badThresholdPerHour * 5, rule.badThresholdPerHour + 5)
  let state: ComponentUptime['state']
  let detail: string | undefined

  if (uptime.sevenDays === null) {
    state = 'unknown'
  } else if (lastCount > downThreshold) {
    state = 'down'
    detail = `${lastCount} eventos na última hora (limite: ${rule.badThresholdPerHour}).`
  } else if (lastCount > rule.badThresholdPerHour) {
    state = 'degraded'
    detail = `${lastCount} eventos na última hora (limite: ${rule.badThresholdPerHour}).`
  } else {
    state = 'operational'
  }

  return {
    id: rule.id,
    label: rule.label,
    description: rule.description,
    state,
    detail,
    uptime,
  }
}

/** Collect incidents across all components. An incident is a maximal
 *  run of consecutive bad hourly buckets (gap of 1 good bucket closes
 *  the run). Severity scales with duration:
 *    - <  3h : minor
 *    - 3–6h : major
 *    - ≥ 6h : critical
 */
export function collectIncidents(
  rules: readonly ComponentRule[],
  cronRuns: CronRunRow[],
  serverLogs: ServerLogRow[],
  now: Date
): Incident[] {
  const out: Incident[] = []

  for (const rule of rules) {
    const series = bucketize(rule, cronRuns, serverLogs, now)

    let runStart: number | null = null
    let runEnd: number | null = null

    const flush = () => {
      if (runStart === null || runEnd === null) return
      const startedAt = new Date(runStart).toISOString()
      const resolvedAt = new Date(runEnd + HOUR_MS).toISOString()
      const durationHours = (runEnd - runStart) / HOUR_MS + 1
      const severity: IncidentSeverity =
        durationHours >= 6 ? 'critical' : durationHours >= 3 ? 'major' : 'minor'
      out.push({
        id: `internal:${rule.id}:${startedAt}`,
        title: titleFor(rule, durationHours),
        severity,
        status: 'resolved',
        components: [rule.id],
        startedAt,
        resolvedAt,
        summary: `Detectado a partir de ${rule.source}: ${durationHours} hora(s) com contagem acima do limite (${rule.badThresholdPerHour}/h).`,
      })
      runStart = null
      runEnd = null
    }

    for (let i = 0; i < series.counts.length; i++) {
      const bucketStart = series.startMs + i * series.bucketMs
      const bad = series.counts[i]! > rule.badThresholdPerHour
      if (bad) {
        if (runStart === null) runStart = bucketStart
        runEnd = bucketStart
      } else {
        flush()
      }
    }
    // If the run extends to "now", report it as still-active.
    if (runStart !== null && runEnd !== null) {
      const endsNow = runEnd >= now.getTime() - HOUR_MS
      if (endsNow) {
        const startedAt = new Date(runStart).toISOString()
        const durationHours = (runEnd - runStart) / HOUR_MS + 1
        const severity: IncidentSeverity =
          durationHours >= 6 ? 'critical' : durationHours >= 3 ? 'major' : 'minor'
        out.push({
          id: `internal:${rule.id}:${startedAt}`,
          title: titleFor(rule, durationHours),
          severity,
          status: 'investigating',
          components: [rule.id],
          startedAt,
          resolvedAt: null,
          summary: `Em curso. ${durationHours} hora(s) acima do limite (${rule.badThresholdPerHour}/h em ${rule.source}).`,
        })
      } else {
        flush()
      }
    }
  }

  // Newest first.
  out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  return out
}

function titleFor(rule: ComponentRule, durationHours: number): string {
  const dur = durationHours >= 1.5 ? `${Math.round(durationHours)} h` : '~1 h'
  return `Degradação em ${rule.label} (${dur})`
}

function window(now: Date, days: number): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(now.getTime() - days * DAY_MS).toISOString(),
    toIso: now.toISOString(),
  }
}

/** Exported only for the unit-test suite. */
export const __internal = {
  COMPONENT_RULES,
  ALL_COMPONENT_IDS,
}
