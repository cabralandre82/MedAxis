/**
 * Status data-source factory + memoization — Wave Hardening II #7.
 *
 * The public `/api/status/summary` endpoint asks `getStatusSummary()`
 * for a freshly-built `StatusSummary`. Behaviour:
 *
 *   1. Pick a backend at runtime:
 *        - Grafana Cloud, when `GRAFANA_CLOUD_*` env vars are present;
 *        - Internal source (cron_runs + server_logs), otherwise.
 *   2. Memoise the last successful summary for `CACHE_TTL_MS` (60s by
 *      default) so repeated page loads don't fan-out to either backend.
 *   3. NEVER throw — on a backend exception we either (a) return the
 *      stale cached summary if it still exists, or (b) build a
 *      synthesized "all unknown" summary tagged `degraded=true`.
 *
 * Memoization is per-process (warm Lambda) which is fine because the
 * endpoint also sets `Cache-Control: s-maxage=60`. Vercel Edge cache
 * fronts the route, so cold-start fan-out is bounded.
 *
 * @module lib/status/data-source
 */

import 'server-only'
import { logger } from '@/lib/logger'
import { GrafanaCloudStatusSource } from './grafana-cloud-source'
import { InternalStatusSource } from './internal-source'
import type { StatusDataSource, StatusSummary } from './types'

const CACHE_TTL_MS = 60 * 1000
const MODULE = { module: 'status/data-source' }

let cached: { summary: StatusSummary; storedAt: number } | null = null

/** Returns the memoised summary when fresh, otherwise rebuilds from
 *  the active backend. NEVER throws. */
export async function getStatusSummary(now: Date = new Date()): Promise<StatusSummary> {
  if (cached && now.getTime() - cached.storedAt < CACHE_TTL_MS) {
    return cached.summary
  }

  const source = pickSource()
  try {
    const summary = await source.build(now)
    cached = { summary, storedAt: now.getTime() }
    return summary
  } catch (err) {
    logger.error('status source build failed', { ...MODULE, source: source.name, error: err })

    // Stale-on-error: serve the previous summary if we still have one.
    if (cached) {
      return {
        ...cached.summary,
        degraded: true,
        degradedReason: `${cached.summary.degradedReason ?? ''} | stale (${formatErr(err)})`.trim(),
      }
    }

    // First-call failure: emit a synthesised degraded summary so the
    // route can still respond 200 with a useful shape.
    return synthesizeDegraded(source.name, err, now)
  }
}

/** Reset the in-process cache. Tests use this; production code does not. */
export function __resetStatusCacheForTests(): void {
  cached = null
}

/** Pick the active source. `force` exists for tests. */
export function pickSource(force?: 'internal' | 'grafana-cloud'): StatusDataSource {
  if (force === 'internal') return new InternalStatusSource()
  if (force === 'grafana-cloud') {
    const gc = GrafanaCloudStatusSource.fromEnv()
    if (!gc) throw new Error('grafana-cloud source forced but env not configured')
    return gc
  }
  const gc = GrafanaCloudStatusSource.fromEnv()
  return gc ?? new InternalStatusSource()
}

function synthesizeDegraded(
  source: StatusSummary['source'],
  err: unknown,
  now: Date
): StatusSummary {
  const iso = now.toISOString()
  const dayMs = 24 * 60 * 60 * 1000
  const window = (days: number) => ({
    fromIso: new Date(now.getTime() - days * dayMs).toISOString(),
    toIso: iso,
  })
  return {
    generatedAt: iso,
    source,
    window: { sevenDays: window(7), thirtyDays: window(30), ninetyDays: window(90) },
    components: [],
    incidents: [],
    degraded: true,
    degradedReason: `coleta indisponível (${formatErr(err)})`,
  }
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message
  try {
    return String(err)
  } catch {
    return 'unknown'
  }
}
