/**
 * In-process metrics registry — Wave 6.
 *
 * Why roll our own instead of pulling `prom-client`? Three reasons:
 *   1. Vercel serverless kills the process after a request returns, so
 *      a proper Prometheus pull-based exporter would show empty-ish
 *      data anyway. We only need short-window (per warm instance)
 *      counters that surface in Sentry breadcrumbs + a JSON snapshot
 *      on the deep health endpoint.
 *   2. `prom-client` is 180KB minified and adds a dependency; we only
 *      need 4 primitives (counter, gauge, histogram, snapshot).
 *   3. Keeping metrics in-memory means any provider swap (Datadog,
 *      Grafana Cloud) is a matter of rewriting `flushTo*()` at the
 *      edge, not refactoring every call site.
 *
 * Metric names follow Prometheus conventions (snake_case, `_total`
 * suffix for counters, `_ms` for durations). Labels are opt-in maps
 * serialised deterministically so two call sites with identical labels
 * share a counter.
 *
 * Edge-safe: no `node:*` imports, no AsyncLocalStorage. This lets
 * `middleware.ts` (Edge runtime) push into the same counter namespace
 * as Node routes — even though they don't share memory at runtime,
 * the API contract is identical and a future metrics backend can
 * normalise both sides.
 *
 * @module lib/metrics
 */

type LabelValues = Record<string, string | number | boolean | null | undefined>

interface CounterSample {
  name: string
  labels: LabelValues
  value: number
  updatedAt: number
}

interface GaugeSample {
  name: string
  labels: LabelValues
  value: number
  updatedAt: number
}

interface HistogramSample {
  name: string
  labels: LabelValues
  count: number
  sum: number
  min: number
  max: number
  /** Approximate p50/p95/p99 via sorted-reservoir sampling. */
  samples: number[]
  updatedAt: number
}

const COUNTERS = new Map<string, CounterSample>()
const GAUGES = new Map<string, GaugeSample>()
const HISTOGRAMS = new Map<string, HistogramSample>()

/** Max samples kept per histogram before we start evicting — keeps
 *  memory bounded on a long-running warm Lambda. */
const HISTOGRAM_MAX_SAMPLES = 200

function key(name: string, labels: LabelValues | undefined): string {
  if (!labels) return name
  const sorted = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort()
  return sorted.length === 0 ? name : `${name}{${sorted.join(',')}}`
}

// ── Counter ──────────────────────────────────────────────────────────────────

/**
 * Increment a monotonic counter. Safe under concurrent serverless
 * invocations because Node is single-threaded within one process —
 * but values reset whenever the instance is recycled, which is fine:
 * we ship snapshots to Sentry/logs before the reset cost matters.
 */
export function incCounter(name: string, labels?: LabelValues, delta = 1): void {
  if (!Number.isFinite(delta) || delta < 0) return
  const k = key(name, labels)
  const existing = COUNTERS.get(k)
  if (existing) {
    existing.value += delta
    existing.updatedAt = Date.now()
    return
  }
  COUNTERS.set(k, { name, labels: labels ?? {}, value: delta, updatedAt: Date.now() })
}

// ── Gauge ────────────────────────────────────────────────────────────────────

/** Set an absolute gauge value. Use for states (circuit breaker open
 *  count, pool size, queue depth). */
export function setGauge(name: string, value: number, labels?: LabelValues): void {
  if (!Number.isFinite(value)) return
  const k = key(name, labels)
  GAUGES.set(k, { name, labels: labels ?? {}, value, updatedAt: Date.now() })
}

// ── Histogram ────────────────────────────────────────────────────────────────

/**
 * Record a single observation (typically a duration in ms).
 * We keep a bounded reservoir of the last N samples so the deep health
 * endpoint can compute approximate quantiles without external storage.
 */
export function observeHistogram(name: string, value: number, labels?: LabelValues): void {
  if (!Number.isFinite(value)) return
  const k = key(name, labels)
  const existing = HISTOGRAMS.get(k)
  if (existing) {
    existing.count += 1
    existing.sum += value
    if (value < existing.min) existing.min = value
    if (value > existing.max) existing.max = value
    existing.samples.push(value)
    if (existing.samples.length > HISTOGRAM_MAX_SAMPLES) {
      // Drop the oldest sample (FIFO ring).
      existing.samples.shift()
    }
    existing.updatedAt = Date.now()
    return
  }
  HISTOGRAMS.set(k, {
    name,
    labels: labels ?? {},
    count: 1,
    sum: value,
    min: value,
    max: value,
    samples: [value],
    updatedAt: Date.now(),
  })
}

// ── Snapshot / exposition ────────────────────────────────────────────────────

export interface MetricsSnapshot {
  counters: Array<{ name: string; labels: LabelValues; value: number; updatedAt: number }>
  gauges: Array<{ name: string; labels: LabelValues; value: number; updatedAt: number }>
  histograms: Array<{
    name: string
    labels: LabelValues
    count: number
    sum: number
    min: number
    max: number
    avg: number
    p50: number
    p95: number
    p99: number
    updatedAt: number
  }>
}

function quantile(sortedSamples: number[], q: number): number {
  if (sortedSamples.length === 0) return 0
  const idx = Math.min(sortedSamples.length - 1, Math.max(0, Math.floor(sortedSamples.length * q)))
  return sortedSamples[idx]
}

export function snapshotMetrics(): MetricsSnapshot {
  const counters = Array.from(COUNTERS.values()).map((c) => ({
    name: c.name,
    labels: c.labels,
    value: c.value,
    updatedAt: c.updatedAt,
  }))
  const gauges = Array.from(GAUGES.values()).map((g) => ({
    name: g.name,
    labels: g.labels,
    value: g.value,
    updatedAt: g.updatedAt,
  }))
  const histograms = Array.from(HISTOGRAMS.values()).map((h) => {
    const sorted = [...h.samples].sort((a, b) => a - b)
    return {
      name: h.name,
      labels: h.labels,
      count: h.count,
      sum: h.sum,
      min: h.min,
      max: h.max,
      avg: h.count === 0 ? 0 : h.sum / h.count,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      updatedAt: h.updatedAt,
    }
  })
  return { counters, gauges, histograms }
}

/** Prometheus exposition format — useful if we ever front this with a
 *  scraper, and for human-readable snapshots in the deep health JSON. */
export function metricsText(): string {
  const lines: string[] = []
  const snap = snapshotMetrics()
  for (const c of snap.counters) {
    lines.push(`${renderKey(c.name, c.labels)} ${c.value}`)
  }
  for (const g of snap.gauges) {
    lines.push(`${renderKey(g.name, g.labels)} ${g.value}`)
  }
  for (const h of snap.histograms) {
    const base = renderKey(h.name, h.labels)
    lines.push(`${base}_count ${h.count}`)
    lines.push(`${base}_sum ${h.sum}`)
    lines.push(`${base}_p50 ${h.p50}`)
    lines.push(`${base}_p95 ${h.p95}`)
    lines.push(`${base}_p99 ${h.p99}`)
  }
  return lines.join('\n')
}

function renderKey(name: string, labels: LabelValues): string {
  const ls = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
  return ls.length > 0 ? `${name}{${ls.join(',')}}` : name
}

// ── Canonical metric names ───────────────────────────────────────────────────

/** Stable names so call sites don't drift. Never rename without also
 *  updating grafana/alert rules that query them. */
export const Metrics = {
  CSRF_BLOCKED_TOTAL: 'csrf_blocked_total',
  // Wave Hardening II #8 — CSP violation reports
  CSP_VIOLATION_TOTAL: 'csp_violation_total',
  CSP_REPORT_INVALID_TOTAL: 'csp_report_invalid_total',
  // Wave Hardening II #9 — chaos engineering injection counters
  CHAOS_INJECTION_TOTAL: 'chaos_injection_total',
  CHAOS_INJECTION_LATENCY_MS: 'chaos_injection_latency_ms',
  RBAC_DENIED_TOTAL: 'rbac_denied_total',
  RBAC_RPC_ERRORS_TOTAL: 'rbac_rpc_errors_total',
  WEBHOOK_CLAIM_TOTAL: 'webhook_claim_total',
  WEBHOOK_DUPLICATE_TOTAL: 'webhook_duplicate_total',
  SMS_STATUS_EVENT_TOTAL: 'sms_status_event_total',
  CRON_RUN_TOTAL: 'cron_run_total',
  CRON_DURATION_MS: 'cron_duration_ms',
  CRON_LAST_SUCCESS_TS: 'cron_last_success_ts',
  CIRCUIT_BREAKER_STATE: 'circuit_breaker_state',
  HEALTH_CHECK_DURATION_MS: 'health_check_duration_ms',
  STATUS_SUMMARY_TOTAL: 'status_summary_total',
  ATOMIC_RPC_TOTAL: 'atomic_rpc_total',
  ATOMIC_RPC_DURATION_MS: 'atomic_rpc_duration_ms',
  ATOMIC_RPC_FALLBACK_TOTAL: 'atomic_rpc_fallback_total',
  ORDERS_CREATED_TOTAL: 'orders_created_total',
  AUDIT_CHAIN_BREAK_TOTAL: 'audit_chain_break_total',
  AUDIT_CHAIN_VERIFY_TOTAL: 'audit_chain_verify_total',
  AUDIT_CHAIN_LAST_VERIFY_TS: 'audit_chain_last_verify_ts',
  MONEY_DRIFT_TOTAL: 'money_drift_total',
  MONEY_RECONCILE_DURATION_MS: 'money_reconcile_duration_ms',
  MONEY_RECONCILE_LAST_RUN_TS: 'money_reconcile_last_run_ts',
  DSAR_OPENED_TOTAL: 'dsar_opened_total',
  DSAR_DUPLICATE_OPEN_TOTAL: 'dsar_duplicate_open_total',
  DSAR_TRANSITION_TOTAL: 'dsar_transition_total',
  DSAR_TRANSITION_ERROR_TOTAL: 'dsar_transition_error_total',
  DSAR_TRANSITION_DURATION_MS: 'dsar_transition_duration_ms',
  DSAR_SLA_BREACH_TOTAL: 'dsar_sla_breach_total',
  DSAR_SLA_WARNING_TOTAL: 'dsar_sla_warning_total',
  DSAR_EXPIRED_TOTAL: 'dsar_expired_total',
  RATE_LIMIT_HITS_TOTAL: 'rate_limit_hits_total',
  RATE_LIMIT_DENIED_TOTAL: 'rate_limit_denied_total',
  RATE_LIMIT_CHECK_DURATION_MS: 'rate_limit_check_duration_ms',
  RATE_LIMIT_SUSPICIOUS_IPS_TOTAL: 'rate_limit_suspicious_ips_total',
  TURNSTILE_VERIFY_TOTAL: 'turnstile_verify_total',
  TURNSTILE_VERIFY_DURATION_MS: 'turnstile_verify_duration_ms',
  HTTP_OUTBOUND_TOTAL: 'http_outbound_total',
  HTTP_OUTBOUND_DURATION_MS: 'http_outbound_duration_ms',
  HTTP_REQUEST_DURATION_MS: 'http_request_duration_ms',
  HTTP_REQUEST_TOTAL: 'http_request_total',
  METRICS_SCRAPE_TOTAL: 'metrics_scrape_total',
  BACKUP_RECORD_TOTAL: 'backup_record_total',
  BACKUP_RECORD_DURATION_MS: 'backup_record_duration_ms',
  BACKUP_LAST_SUCCESS_TS: 'backup_last_success_ts',
  BACKUP_LAST_SIZE_BYTES: 'backup_last_size_bytes',
  BACKUP_AGE_SECONDS: 'backup_age_seconds',
  BACKUP_FRESHNESS_BREACH_TOTAL: 'backup_freshness_breach_total',
  BACKUP_CHAIN_BREAK_TOTAL: 'backup_chain_break_total',
  RESTORE_DRILL_LAST_SUCCESS_TS: 'restore_drill_last_success_ts',
  RESTORE_DRILL_AGE_SECONDS: 'restore_drill_age_seconds',
  // Wave 13 — legal holds
  LEGAL_HOLD_APPLY_TOTAL: 'legal_hold_apply_total',
  LEGAL_HOLD_RELEASE_TOTAL: 'legal_hold_release_total',
  LEGAL_HOLD_ACTIVE_COUNT: 'legal_hold_active_count',
  LEGAL_HOLD_BLOCKED_PURGE_TOTAL: 'legal_hold_blocked_purge_total',
  LEGAL_HOLD_BLOCKED_DSAR_TOTAL: 'legal_hold_blocked_dsar_total',
  LEGAL_HOLD_EXPIRED_TOTAL: 'legal_hold_expired_total',
  // Wave 14 — RLS canary
  RLS_CANARY_RUNS_TOTAL: 'rls_canary_runs_total',
  RLS_CANARY_VIOLATIONS_TOTAL: 'rls_canary_violations_total',
  RLS_CANARY_TABLES_CHECKED: 'rls_canary_tables_checked',
  RLS_CANARY_LAST_SUCCESS_TS: 'rls_canary_last_success_ts',
  RLS_CANARY_LAST_VIOLATION_TS: 'rls_canary_last_violation_ts',
  RLS_CANARY_AGE_SECONDS: 'rls_canary_age_seconds',
  RLS_CANARY_DURATION_MS: 'rls_canary_duration_ms',
  // Wave 15 — secret rotation
  SECRET_ROTATION_RUNS_TOTAL: 'secret_rotation_runs_total',
  SECRET_ROTATION_FAILURES_TOTAL: 'secret_rotation_failures_total',
  SECRET_ROTATION_OVERDUE_COUNT: 'secret_rotation_overdue_count',
  SECRET_ROTATION_NEVER_ROTATED_COUNT: 'secret_rotation_never_rotated_count',
  SECRET_AGE_SECONDS: 'secret_age_seconds',
  SECRET_OLDEST_AGE_SECONDS: 'secret_oldest_age_seconds',
  SECRET_ROTATION_DURATION_MS: 'secret_rotation_duration_ms',
  SECRET_ROTATION_LAST_RUN_TS: 'secret_rotation_last_run_ts',
} as const

// ── Surge detector ───────────────────────────────────────────────────────────

/**
 * Simple rolling-window detector. Tracks timestamps of events keyed by
 * `surgeKey` in memory; when the number of events within `windowMs`
 * exceeds `threshold`, returns `true` and clears the bucket so the
 * caller fires at most one alert per surge episode. On subsequent
 * increments the bucket rebuilds.
 *
 * NOT distributed: each serverless instance has its own bucket, so a
 * genuine surge that gets evenly distributed across 5 warm instances
 * may be missed. This is acceptable for alert-level signalling (Sentry
 * aggregation catches what we miss) but MUST NOT be relied upon for
 * precise rate limiting.
 */
const surgeBuckets = new Map<string, number[]>()

export function detectSurge(surgeKey: string, windowMs: number, threshold: number): boolean {
  if (threshold <= 0 || windowMs <= 0) return false
  const now = Date.now()
  const cutoff = now - windowMs
  const bucket = surgeBuckets.get(surgeKey) ?? []
  // Drop anything outside the window.
  const fresh = bucket.filter((t) => t >= cutoff)
  fresh.push(now)
  if (fresh.length > threshold) {
    surgeBuckets.delete(surgeKey)
    return true
  }
  surgeBuckets.set(surgeKey, fresh)
  return false
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Clear all metrics. Exported for tests only — NEVER call in production. */
export function __resetMetricsForTests(): void {
  COUNTERS.clear()
  GAUGES.clear()
  HISTOGRAMS.clear()
  surgeBuckets.clear()
}

/**
 * Convenience combinator: increment a counter and return the new value
 * for the caller to log alongside its own structured event. Keeps the
 * module free of a `logger` dependency (required so middleware can
 * import from here under Edge runtime).
 */
export function incAndRead(name: string, labels: LabelValues = {}, delta = 1): number {
  incCounter(name, labels, delta)
  return COUNTERS.get(key(name, labels))?.value ?? 0
}
