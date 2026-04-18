import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCircuitStates } from '@/lib/circuit-breaker'
import { withDbSpan } from '@/lib/tracing'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter, observeHistogram, snapshotMetrics, metricsText, Metrics } from '@/lib/metrics'
import { safeEqualString } from '@/lib/security/hmac'

/**
 * GET /api/health/deep — full-system introspection.
 *
 * Checks:
 *   - Everything from `/api/health/ready` (env, DB, circuits).
 *   - Cron freshness: every job in `cron_runs` must have a success
 *     within the last 2h (grace for hourly jobs; daily jobs use 25h).
 *   - Webhook backlog: no more than 10 `failed` events in the last
 *     hour per source.
 *   - Metrics snapshot for human operators.
 *
 * This endpoint is EXPENSIVE (3-5 DB queries). It is gated behind:
 *   - `CRON_SECRET` header (operator-only access).
 *   - Feature flag `observability.deep_health` (flipped on-demand
 *     during incidents; default OFF to avoid unauthenticated load).
 *
 * Response supports `?format=prometheus` for text-format metrics.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CRON_JOB_SLA_MS: Record<string, number> = {
  // Hourly jobs
  'rls-verifier': 2 * 60 * 60 * 1000,
  'lock-sweeper': 2 * 60 * 60 * 1000,
  // Daily jobs
  'backup-verify': 25 * 60 * 60 * 1000,
  'offsite-backup': 25 * 60 * 60 * 1000,
  // Weekly jobs
  'restore-drill': 8 * 24 * 60 * 60 * 1000,
}
const DEFAULT_SLA_MS = 2 * 60 * 60 * 1000

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false // deep health never runs without CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerToken = req.headers.get('x-ops-token') ?? ''
  return safeEqualString(bearer, expected) || safeEqualString(headerToken, expected)
}

export async function GET(req: NextRequest) {
  const start = Date.now()
  if (!isAuthorized(req)) {
    incCounter('health_check_total', { endpoint: 'deep', status: 'forbidden' })
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const enabled = await isFeatureEnabled('observability.deep_health').catch(() => false)
  if (!enabled) {
    return NextResponse.json(
      {
        status: 'disabled',
        check: 'deep',
        reason: 'feature_flag_off',
        hint: 'Enable observability.deep_health to run this probe.',
      },
      { status: 200 }
    )
  }

  const checks: Record<string, { ok: boolean; details?: unknown; error?: string }> = {}
  const admin = createAdminClient()

  // ── Env + DB reachability ──────────────────────────────────────────────
  const requiredEnvs = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k])
  checks.env =
    missingEnvs.length === 0
      ? { ok: true }
      : { ok: false, error: `Missing: ${missingEnvs.join(', ')}` }

  try {
    const t0 = Date.now()
    const { error } = await withDbSpan('sla_configs', 'select', async () =>
      admin.from('sla_configs').select('id').limit(1)
    )
    checks.database = {
      ok: !error,
      details: { latencyMs: Date.now() - t0 },
      ...(error ? { error: error.message } : {}),
    }
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // ── Circuit breakers ───────────────────────────────────────────────────
  const circuits = getCircuitStates()
  const openCircuits = Object.entries(circuits).filter(([, v]) => v.state !== 'CLOSED')
  checks.circuits =
    openCircuits.length === 0
      ? { ok: true, details: circuits }
      : {
          ok: false,
          details: circuits,
          error: `Non-closed: ${openCircuits.map(([k, v]) => `${k}=${v.state}`).join(', ')}`,
        }

  // ── Cron freshness ─────────────────────────────────────────────────────
  // For every job that has EVER run, verify it ran successfully within
  // its SLA window. Jobs with no history are considered unknown but ok.
  try {
    const { data: latest, error } = await admin
      .from('cron_runs')
      .select('job_name, started_at, status')
      .order('started_at', { ascending: false })
      .limit(200)
    if (error) {
      checks.cronFreshness = { ok: false, error: error.message }
    } else {
      const lastSuccessByJob = new Map<string, string>()
      for (const row of latest ?? []) {
        if (row.status === 'success' && !lastSuccessByJob.has(row.job_name)) {
          lastSuccessByJob.set(row.job_name, row.started_at)
        }
      }
      const now = Date.now()
      const stale: Array<{ job: string; ageMs: number; slaMs: number }> = []
      for (const [job, ts] of lastSuccessByJob) {
        const ageMs = now - new Date(ts).getTime()
        const slaMs = CRON_JOB_SLA_MS[job] ?? DEFAULT_SLA_MS
        if (ageMs > slaMs) stale.push({ job, ageMs, slaMs })
      }
      checks.cronFreshness =
        stale.length === 0
          ? {
              ok: true,
              details: {
                jobs: Array.from(lastSuccessByJob.entries()).map(([job, ts]) => ({
                  job,
                  lastSuccessAt: ts,
                })),
              },
            }
          : {
              ok: false,
              details: stale,
              error: `${stale.length} job(s) stale: ${stale.map((s) => s.job).join(', ')}`,
            }
    }
  } catch (err) {
    checks.cronFreshness = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // ── Webhook backlog ────────────────────────────────────────────────────
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: failures, error } = await admin
      .from('webhook_events')
      .select('source, status')
      .eq('status', 'failed')
      .gte('received_at', oneHourAgo)
    if (error) {
      checks.webhookBacklog = { ok: false, error: error.message }
    } else {
      const counts = new Map<string, number>()
      for (const row of failures ?? []) {
        counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
      }
      const offenders = Array.from(counts.entries()).filter(([, n]) => n > 10)
      checks.webhookBacklog =
        offenders.length === 0
          ? { ok: true, details: Object.fromEntries(counts) }
          : {
              ok: false,
              details: Object.fromEntries(counts),
              error: `${offenders.length} source(s) > 10 failures/h: ${offenders.map(([s]) => s).join(', ')}`,
            }
    }
  } catch (err) {
    checks.webhookBacklog = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // ── Backup freshness (Wave 12) ─────────────────────────────────────────
  // Cheap: single SELECT against `backup_latest_view`. We intentionally
  // consider this check NON-FATAL (the flag `backup.freshness_enforce`
  // drives the cron's paging level; the deep-health response always
  // tells the truth but only flips `ok=false` when the enforcement
  // flag is ON, mirroring the cron behaviour).
  try {
    const { getBackupFreshness, BACKUP_SLA } = await import('@/lib/backup')
    const freshness = await getBackupFreshness()
    const enforce = await isFeatureEnabled('backup.freshness_enforce', {}).catch(() => false)
    const breaches = freshness.filter((r) => {
      if (r.outcome !== 'ok') return true
      if (r.kind === 'BACKUP' && r.age_seconds > BACKUP_SLA.BACKUP_MAX_AGE_S) return true
      if (r.kind === 'RESTORE_DRILL' && r.age_seconds > BACKUP_SLA.RESTORE_DRILL_MAX_AGE_S)
        return true
      return false
    })
    checks.backupFreshness = {
      ok: breaches.length === 0 || !enforce,
      details: {
        enforce,
        streams: freshness.length,
        breaches: breaches.map((b) => ({
          kind: b.kind,
          label: b.label,
          outcome: b.outcome,
          ageSeconds: b.age_seconds,
        })),
      },
      error: breaches.length > 0 ? `${breaches.length} stream(s) outside SLA` : undefined,
    }
  } catch (err) {
    checks.backupFreshness = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const allOk = Object.values(checks).every((c) => c.ok)
  const totalMs = Date.now() - start
  observeHistogram(Metrics.HEALTH_CHECK_DURATION_MS, totalMs, { endpoint: 'deep' })
  incCounter('health_check_total', { endpoint: 'deep', status: allOk ? 'ok' : 'degraded' })

  // Prometheus exposition for scrapers.
  const format = req.nextUrl.searchParams.get('format')
  if (format === 'prometheus') {
    return new NextResponse(metricsText(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  }

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      check: 'deep',
      version: process.env.npm_package_version ?? '2.4.0',
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalMs,
      checks,
      metrics: snapshotMetrics(),
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
