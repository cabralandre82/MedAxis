/**
 * Grafana Cloud Prometheus remote_write push — Pre-Launch Onda S1 / T6.
 *
 * Closes the last pre-launch observability blind spot: dashboards
 * + alerting on metrics, beyond Vercel logs and Sentry errors.
 *
 * ## Why push, not scrape
 *
 * Vercel serverless invocations run in short-lived isolates. The
 * in-memory metrics registry in `lib/metrics.ts` is per-instance and
 * resets when the isolate recycles. A traditional Prometheus scrape
 * (Grafana Cloud → /api/metrics) would hit a random isolate each time
 * and read inconsistent counters — sometimes 0, sometimes 12, sometimes
 * a value from an instance that already died. Useless graphs.
 *
 * Push solves this: a Vercel cron runs every 60s, reads its OWN
 * isolate's snapshot, and ships it to Grafana via remote_write. Each
 * sample is a single point in time tagged with that isolate's region
 * + invocation context. Grafana stores them all and we aggregate at
 * query time. Counters become "rate over 1m windows", which is what
 * we'd want anyway.
 *
 * Cost: 1 cron invocation/min = ~43k invocations/month, well under
 * the Pro tier budget.
 *
 * ## Wire format
 *
 * Prometheus remote_write requires:
 *   - protobuf serialization of the `prometheus.WriteRequest` schema
 *   - snappy compression (the framed variant prometheus uses)
 *   - HTTP POST with Basic auth + Content-Encoding: snappy
 *
 * `prometheus-remote-write` (npm) handles all of this. We pass the
 * Node 20 native `fetch` so we don't pull `node-fetch@2` (the peer
 * dep) into our serverless bundle.
 *
 * ## Failure mode
 *
 * If Grafana rejects (rate limit, auth error, downtime), we log + emit
 * a metric and return — DO NOT throw. The cron stays green and tries
 * again in 60s. Continuous failures show up via the
 * `grafana_push_last_run_ts` staleness alert.
 *
 * If env vars are missing (Development env, fresh fork), we return
 * `skipped_no_env` instead of crashing. Same for empty registry
 * (cold start before any metrics emitted).
 *
 * @module lib/observability/grafana-push
 */

import { pushTimeseries } from 'prometheus-remote-write'
import { snapshotMetrics } from '@/lib/metrics'

/** Stable label that identifies these metrics as Clinipharma's. */
const SERVICE_LABEL = 'clinipharma'

/**
 * Outcome of a push attempt — surfaces in metrics + cron logs so
 * a runbook can distinguish "Grafana down" from "we have no env"
 * from "registry empty" without reading raw bodies.
 */
export type PushOutcome = 'success' | 'skipped_no_env' | 'skipped_empty' | 'error'

export interface PushResult {
  outcome: PushOutcome
  timeseriesCount: number
  durationMs: number
  /** Present on `success` and `error` (HTTP-level errors); absent on skips. */
  httpStatus?: number
  /** Present on `error` only — sanitized for logs. */
  errorMessage?: string
}

interface ResolvedConfig {
  url: string
  username: string
  password: string
}

/** Internal: resolve env vars in one place so tests can mock. */
function resolveConfig(): ResolvedConfig | null {
  const url = process.env.GRAFANA_REMOTE_WRITE_URL
  const username = process.env.GRAFANA_REMOTE_WRITE_USERNAME
  const password = process.env.GRAFANA_REMOTE_WRITE_TOKEN
  if (!url || !username || !password) return null
  return { url, username, password }
}

/** Resolve the env tag (`production` | `preview` | `development`). */
function envLabel(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
}

/** Resolve the Vercel region tag. Useful when isolates run in
 *  multiple regions (Vercel auto-routes). */
function regionLabel(): string {
  return process.env.VERCEL_REGION ?? 'unknown'
}

/** Prometheus label key spec: `[a-zA-Z_:][a-zA-Z0-9_:]*`. Anything
 *  else has to be replaced with `_`. We do this at push-time rather
 *  than emit-time so the in-memory registry can stay flexible. */
function sanitizeLabelKey(key: string): string {
  if (key.length === 0) return '_'
  let safe = key.replace(/[^a-zA-Z0-9_:]/g, '_')
  if (!/^[a-zA-Z_:]/.test(safe)) safe = '_' + safe
  return safe
}

/** Drop nullish, stringify everything else, bound cardinality at 200
 *  chars. Long opaque IDs (UUIDs etc.) survive intact. */
function flattenLabels(
  labels: Record<string, string | number | boolean | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(labels)) {
    if (v === null || v === undefined) continue
    out[sanitizeLabelKey(k)] = String(v).slice(0, 200)
  }
  return out
}

interface RemoteSample {
  value: number
  timestamp?: number
}

interface RemoteTimeseries {
  labels: { __name__: string; [key: string]: string }
  samples: RemoteSample[]
}

/**
 * Convert the in-memory snapshot to Prometheus `Timeseries[]`.
 *
 * - Counters and gauges become single-sample series tagged with the
 *   call-site labels plus our base `{service, env, region}`.
 * - Histograms expand into 5 series each — `_count`, `_sum`, `_p50`,
 *   `_p95`, `_p99`. We do NOT export raw samples (the registry caps
 *   them at 200 anyway, but Grafana would burn cardinality budget
 *   for negligible value vs. the quantiles we already compute).
 *
 * Exported for unit tests; runtime callers use `pushMetricsToGrafana`.
 */
export function snapshotToTimeseries(now: number = Date.now()): RemoteTimeseries[] {
  const snap = snapshotMetrics()
  const baseLabels: Record<string, string> = {
    service: SERVICE_LABEL,
    env: envLabel(),
    region: regionLabel(),
  }
  const out: RemoteTimeseries[] = []

  for (const c of snap.counters) {
    out.push({
      labels: { __name__: c.name, ...baseLabels, ...flattenLabels(c.labels) },
      samples: [{ value: c.value, timestamp: now }],
    })
  }

  for (const g of snap.gauges) {
    out.push({
      labels: { __name__: g.name, ...baseLabels, ...flattenLabels(g.labels) },
      samples: [{ value: g.value, timestamp: now }],
    })
  }

  for (const h of snap.histograms) {
    const histLabels = { ...baseLabels, ...flattenLabels(h.labels) }
    out.push({
      labels: { __name__: `${h.name}_count`, ...histLabels },
      samples: [{ value: h.count, timestamp: now }],
    })
    out.push({
      labels: { __name__: `${h.name}_sum`, ...histLabels },
      samples: [{ value: h.sum, timestamp: now }],
    })
    out.push({
      labels: { __name__: `${h.name}_p50`, ...histLabels },
      samples: [{ value: h.p50, timestamp: now }],
    })
    out.push({
      labels: { __name__: `${h.name}_p95`, ...histLabels },
      samples: [{ value: h.p95, timestamp: now }],
    })
    out.push({
      labels: { __name__: `${h.name}_p99`, ...histLabels },
      samples: [{ value: h.p99, timestamp: now }],
    })
  }

  return out
}

/** Mute the lib's verbose default console — its log lines pollute
 *  Vercel logs at 1/minute cadence. We log structurally ourselves
 *  in the cron handler. */
const SILENT_CONSOLE = {
  log: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
} as unknown as Console

/**
 * Push the in-memory metrics snapshot to Grafana Cloud.
 *
 * Always returns — never throws — so the cron route can stamp metrics
 * and decide log severity from the structured outcome.
 */
export async function pushMetricsToGrafana(): Promise<PushResult> {
  const startedAt = Date.now()
  const config = resolveConfig()

  if (!config) {
    return {
      outcome: 'skipped_no_env',
      timeseriesCount: 0,
      durationMs: 0,
    }
  }

  const timeseries = snapshotToTimeseries(startedAt)
  if (timeseries.length === 0) {
    return {
      outcome: 'skipped_empty',
      timeseriesCount: 0,
      durationMs: Date.now() - startedAt,
    }
  }

  try {
    const result = await pushTimeseries(timeseries, {
      url: config.url,
      auth: {
        username: config.username,
        password: config.password,
      },
      timeout: 10_000,
      // Use Node 20+ native fetch — avoids the node-fetch@2 peer dep
      // entering the serverless bundle.
      fetch: globalThis.fetch as never,
      console: SILENT_CONSOLE,
    })

    if (result.status >= 200 && result.status < 300) {
      return {
        outcome: 'success',
        timeseriesCount: timeseries.length,
        durationMs: Date.now() - startedAt,
        httpStatus: result.status,
      }
    }

    return {
      outcome: 'error',
      timeseriesCount: timeseries.length,
      durationMs: Date.now() - startedAt,
      httpStatus: result.status,
      errorMessage:
        result.errorMessage ?? `HTTP ${result.status} ${result.statusText ?? ''}`.trim(),
    }
  } catch (err) {
    return {
      outcome: 'error',
      timeseriesCount: timeseries.length,
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}
