/**
 * Pure helpers for the `/api/cron/rate-limit-report` route — Wave 10.
 *
 * Why this file exists
 * --------------------
 * Next.js 15.5 forbids route handlers (`route.ts`) from exporting any
 * symbol other than the standard HTTP verbs and the route-config fields
 * (`dynamic`, `runtime`, `maxDuration`, …). The build fails with:
 *
 *   Type error: "classifyReport" is not a valid Route export field.
 *
 * The cron route used to inline `classifyReport()` and the `ReportRow` /
 * `Classification` types so the unit tests could import them directly.
 * Moving them here keeps the helpers pure-and-testable while making the
 * route file conform to Next's stricter contract.
 */

export interface ReportRow {
  ip_hash: string
  distinct_buckets: number
  total_hits: number
  last_seen_at: string
  first_seen_at: string
  buckets: string[]
  sample_user_id: string | null
}

export type Severity = 'info' | 'warning' | 'critical'

export interface Classification {
  severity: Severity
  reason: string
  topOffenders: ReportRow[]
}

/**
 * Turn a raw report into an alerting decision. Factoring this
 * out lets us unit-test the thresholds without mocking the
 * database.
 */
export function classifyReport(rows: ReportRow[]): Classification {
  const distinctIps = rows.length
  const maxHits = rows.reduce((acc, r) => Math.max(acc, r.total_hits), 0)
  const maxBuckets = rows.reduce((acc, r) => Math.max(acc, r.distinct_buckets), 0)

  // Stable ordering for sample — highest total_hits first, then
  // distinct_buckets tie-break, then lexicographic hash so two
  // runs with identical data produce identical PagerDuty payloads.
  const sorted = [...rows].sort((a, b) => {
    if (b.total_hits !== a.total_hits) return b.total_hits - a.total_hits
    if (b.distinct_buckets !== a.distinct_buckets) return b.distinct_buckets - a.distinct_buckets
    return a.ip_hash.localeCompare(b.ip_hash)
  })
  const topOffenders = sorted.slice(0, 10)

  if (distinctIps >= 50 || maxHits > 500 || maxBuckets > 5) {
    return {
      severity: 'critical',
      reason:
        distinctIps >= 50
          ? `${distinctIps} IPs blocked in the last hour (>= 50)`
          : maxBuckets > 5
            ? `single IP hitting ${maxBuckets} distinct buckets (credential stuffing?)`
            : `single IP with ${maxHits} hits in the last hour (> 500)`,
      topOffenders,
    }
  }

  if (distinctIps >= 10 || maxHits > 100) {
    return {
      severity: 'warning',
      reason:
        distinctIps >= 10
          ? `${distinctIps} IPs blocked in the last hour (>= 10)`
          : `single IP with ${maxHits} hits (> 100)`,
      topOffenders,
    }
  }

  return {
    severity: 'info',
    reason: `quiet: ${distinctIps} IPs / ${maxHits} max hits`,
    topOffenders,
  }
}
