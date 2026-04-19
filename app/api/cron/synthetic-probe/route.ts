/**
 * GET /api/cron/synthetic-probe — Wave Hardening III.
 *
 * Self-pinging external probe that complements the in-process metrics.
 *
 * Why: `/api/health/live` is reachable INSIDE the function. If the function
 * cannot start (cold-start failure, route panic, edge config drift) we
 * never even hit our own metrics. An EXTERNAL ping — even one that runs
 * from a *different* Vercel function on the same project — will at least
 * produce a `cron_runs` row that says "we tried to hit ourselves and got
 * 502", which the public status page already understands.
 *
 * The probe targets every public health surface so a regression on any
 * single endpoint surfaces independently:
 *
 *   • /api/health/live       — most basic "process alive" check
 *   • /api/health/ready      — DB + envs reachable
 *   • /api/status/summary    — public status pipeline
 *
 * For each target we record HTTP status + latency. The result lands in
 * `cron_runs` (via `withCronGuard`) AND on the metrics histogram, so the
 * existing internal status data source picks it up automatically (a
 * failed synthetic-probe row contributes to `app` component badness).
 *
 * Schedule: every 5 minutes (vercel.json). At 12 req/h × 3 endpoints we
 * stay well below Vercel's free invocation budget while giving the
 * uptime numerator the granularity it needs for a sub-99.9% SLO.
 *
 * Note: this is NOT a substitute for true third-party uptime
 * (UptimeRobot/BetterStack). It is the low-cost first line that catches
 * everything except a full Vercel project outage. The promotion path
 * (external probe) is documented in docs/observability/synthetic-monitoring.md.
 */

import { NextResponse } from 'next/server'
import { withCronGuard } from '@/lib/cron/guarded'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const TARGETS = [
  { path: '/api/health/live', expect: 200, label: 'live' },
  { path: '/api/health/ready', expect: 200, label: 'ready' },
  { path: '/api/status/summary', expect: 200, label: 'status-summary' },
] as const

interface ProbeResult {
  path: string
  status: number
  ok: boolean
  latencyMs: number
  error?: string
}

async function probe(baseUrl: string, target: (typeof TARGETS)[number]): Promise<ProbeResult> {
  const url = `${baseUrl}${target.path}`
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'clinipharma-synthetic-probe/1.0' },
      cache: 'no-store',
    })
    clearTimeout(timeout)
    const latencyMs = Date.now() - t0
    const ok = res.status === target.expect
    observeHistogram(Metrics.HEALTH_CHECK_DURATION_MS, latencyMs, {
      endpoint: `synthetic-${target.label}`,
    })
    incCounter('synthetic_probe_total', {
      target: target.label,
      status: ok ? 'ok' : 'fail',
    })
    return { path: target.path, status: res.status, ok, latencyMs }
  } catch (err) {
    const latencyMs = Date.now() - t0
    incCounter('synthetic_probe_total', { target: target.label, status: 'error' })
    return {
      path: target.path,
      status: 0,
      ok: false,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function resolveBaseUrl(): string {
  // Priority order (matches the rest of the platform):
  //   1. Explicit override (set in Vercel for split-region drills).
  //   2. Vercel-provided URL on production deployments.
  //   3. Fallback to localhost — useful when the probe runs in dev.
  if (process.env.SYNTHETIC_PROBE_BASE_URL) return process.env.SYNTHETIC_PROBE_BASE_URL
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export const GET = withCronGuard('synthetic-probe', async () => {
  const baseUrl = resolveBaseUrl()
  const results: ProbeResult[] = []
  for (const target of TARGETS) {
    results.push(await probe(baseUrl, target))
  }
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    logger.warn('[cron/synthetic-probe] one or more targets failed', {
      module: 'cron/synthetic-probe',
      baseUrl,
      failed: failed.map((r) => ({ path: r.path, status: r.status, error: r.error })),
    })
    // We INTENTIONALLY return non-throwing JSON: withCronGuard logs the
    // result body to cron_runs.result so the public status page can see
    // partial failures without forcing the whole job to error.
    return NextResponse.json(
      { ok: false, baseUrl, results, failed: failed.length },
      { status: 200 }
    )
  }
  return NextResponse.json({ ok: true, baseUrl, results, failed: 0 }, { status: 200 })
})
