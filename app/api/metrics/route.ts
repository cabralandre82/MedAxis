import { NextRequest, NextResponse } from 'next/server'
import { metricsText, snapshotMetrics, incCounter, Metrics } from '@/lib/metrics'
import { safeEqualString } from '@/lib/security/hmac'
import { logger } from '@/lib/logger'

/**
 * GET /api/metrics — Prometheus-format scrape endpoint (Wave 11).
 *
 * Exposes the in-memory metrics registry (counters, gauges,
 * histograms) in the OpenMetrics/Prometheus text format so a
 * Grafana Agent / Vector / Cloudflare Logpush / Datadog bridge
 * can pull them every 30s and power the dashboards shipped in
 * `monitoring/grafana/`.
 *
 * ## Authentication
 *
 * Protected by the `METRICS_SECRET` env var, presented either as:
 *   - `Authorization: Bearer <secret>`
 *   - `?token=<secret>` query param (scrapers that cannot set
 *     headers — Cloudflare cron mode)
 *
 * If `METRICS_SECRET` is unset in development the endpoint is
 * open (emits a warning) so `curl localhost:3000/api/metrics`
 * works. In Vercel (`VERCEL_ENV=production` or `preview`) the
 * secret is REQUIRED or the endpoint returns 500. This prevents
 * accidentally shipping an open metrics surface — the snapshot
 * contains cardinality-bounded labels but still leaks request
 * volume, error rates, and feature-flag adoption.
 *
 * ## Output formats
 *
 *   - default (no query) → `text/plain; version=0.0.4` Prometheus
 *   - `?format=json` → structured snapshot (for the deep health
 *     page + ad-hoc debugging)
 *
 * ## Cardinality budget
 *
 *   We keep metric labels bounded at the emit site — routes,
 *   feature flags, severities — so the exposition stays cheap.
 *   A full scrape is typically < 50 KB and < 5 ms to render.
 *
 * ## Not exposed here
 *
 *   - Per-user counters (PII). Those live only in the database
 *     with RLS.
 *   - Raw histogram samples. We already export p50/p95/p99 via
 *     `metricsText()`, and the unbounded sample buffer would
 *     inflate scrape cost without helping the dashboard.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PRODLIKE_ENVS = new Set(['production', 'preview'])

function requireSecret(): { ok: true; secret: string } | { ok: false; reason: string } {
  const secret = process.env.METRICS_SECRET
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'

  if (secret) return { ok: true, secret }

  if (PRODLIKE_ENVS.has(env)) {
    return {
      ok: false,
      reason: 'METRICS_SECRET not configured in prod-like environment',
    }
  }

  // Local dev: allow but warn once so operators don't forget.
  logger.warn('[metrics] METRICS_SECRET unset — endpoint is OPEN. Safe only for localhost.', {
    module: 'metrics-endpoint',
    env,
  })
  return { ok: true, secret: '' }
}

function extractToken(req: NextRequest): string {
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  const url = new URL(req.url)
  return url.searchParams.get('token') ?? ''
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireSecret()
  if (!gate.ok) {
    logger.error('[metrics] refusing to serve: no secret', {
      module: 'metrics-endpoint',
      reason: gate.reason,
    })
    return NextResponse.json(
      { error: 'metrics_not_configured', reason: gate.reason },
      { status: 500 }
    )
  }

  if (gate.secret) {
    const provided = extractToken(req)
    if (!provided || !safeEqualString(provided, gate.secret)) {
      incCounter(Metrics.METRICS_SCRAPE_TOTAL, { outcome: 'unauthorized' })
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const format = new URL(req.url).searchParams.get('format')
  if (format === 'json') {
    incCounter(Metrics.METRICS_SCRAPE_TOTAL, { outcome: 'ok', format: 'json' })
    return NextResponse.json(snapshotMetrics(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  incCounter(Metrics.METRICS_SCRAPE_TOTAL, { outcome: 'ok', format: 'prometheus' })
  return new NextResponse(metricsText(), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
