/**
 * Public status summary endpoint — Wave Hardening II #7.
 *
 * GET /api/status/summary
 *   → 200 { ...StatusSummary }
 *
 * Behaviour:
 *   - Always 200; failures degrade into a `degraded:true` payload so
 *     the public page never surfaces a 5xx to anonymous visitors.
 *   - `Cache-Control: public, s-maxage=60, stale-while-revalidate=120`
 *     so the Vercel Edge cache absorbs the bulk of traffic. Combined
 *     with the in-process memo in `lib/status/data-source.ts`, our
 *     real fan-out to Grafana Cloud / DB stays <= 1 per minute per
 *     edge region.
 *   - Public, unauthenticated. No PII is ever in the response.
 *   - HEAD returns headers only (used by some uptime probes).
 *
 * @module app/api/status/summary/route
 */

import { NextResponse } from 'next/server'
import { getStatusSummary } from '@/lib/status/data-source'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_HEADER = 'public, s-maxage=60, stale-while-revalidate=120'

export async function GET(): Promise<NextResponse> {
  const t0 = Date.now()
  const summary = await getStatusSummary()
  const durationMs = Date.now() - t0

  observeHistogram(Metrics.HEALTH_CHECK_DURATION_MS, durationMs, { endpoint: 'status-summary' })
  incCounter(Metrics.STATUS_SUMMARY_TOTAL, {
    source: summary.source,
    degraded: String(summary.degraded),
  })

  return NextResponse.json(summary, {
    status: 200,
    headers: {
      'Cache-Control': CACHE_HEADER,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export async function HEAD(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': CACHE_HEADER,
    },
  })
}
