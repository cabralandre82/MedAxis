import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import {
  Metrics,
  metricsText,
  snapshotMetrics,
  incCounter,
  setGauge,
  observeHistogram,
  __resetMetricsForTests,
} from '@/lib/metrics'
import { Bucket } from '@/lib/rate-limit'

/**
 * Wave Hardening II #6 — Drift tests for the metrics catalog.
 *
 * These tests guard the contract between:
 *   - lib/metrics.ts                  (Metrics constants, registry impl)
 *   - lib/rate-limit.ts               (Bucket constants)
 *   - docs/observability/metrics.md   (human catalog)
 *   - monitoring/grafana/*.json       (dashboards)
 *   - monitoring/prometheus/alerts.yml(alert rules)
 *
 * The tests do NOT require a running scraper — they only validate
 * static consistency. Drift here means a PR removed a metric/bucket
 * but forgot to update the dashboard, runbook, or alert.
 */

const ROOT = process.cwd()
const METRICS_DOC = join(ROOT, 'docs/observability/metrics.md')
const ALERTS_FILE = join(ROOT, 'monitoring/prometheus/alerts.yml')
const GRAFANA_DIR = join(ROOT, 'monitoring/grafana')
const RATE_LIMIT_FILE = join(ROOT, 'lib/rate-limit.ts')

function readDir(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return readDir(full)
    return [full]
  })
}

describe('metrics constants — drift with documentation', () => {
  const doc = readFileSync(METRICS_DOC, 'utf8')

  for (const [key, value] of Object.entries(Metrics)) {
    it(`Metrics.${key} ("${value}") is referenced in docs/observability/metrics.md`, () => {
      expect(
        doc.includes(value),
        `Metric "${value}" (${key}) is missing from docs/observability/metrics.md — add it to §3 or remove the constant.`
      ).toBe(true)
    })
  }
})

describe('rate-limit buckets — drift with documentation and code', () => {
  const doc = readFileSync(METRICS_DOC, 'utf8')
  const rateLimitSrc = readFileSync(RATE_LIMIT_FILE, 'utf8')

  for (const [key, value] of Object.entries(Bucket)) {
    it(`Bucket.${key} ("${value}") is documented`, () => {
      expect(
        doc.includes(value),
        `Bucket "${value}" (${key}) missing from docs/observability/metrics.md §3.3.`
      ).toBe(true)
    })

    // The bucket constant should be defined in lib/rate-limit.ts —
    // sanity check the source itself contains the literal too. This
    // catches cases where someone exports a constant without
    // declaring its value alongside.
    it(`Bucket.${key} is defined in lib/rate-limit.ts`, () => {
      expect(rateLimitSrc.includes(`'${value}'`)).toBe(true)
    })
  }
})

describe('alert rules — every referenced metric exists', () => {
  const alerts = readFileSync(ALERTS_FILE, 'utf8')
  const knownMetrics = new Set(Object.values(Metrics))

  // Find tokens that look like Prometheus metrics:
  //   snake_case identifiers immediately followed by `{`, `(`, ` `,
  //   newline, or arithmetic operator, and ending with one of our
  //   sanctioned suffixes.
  const sanctionedSuffixes = ['_total', '_ms', '_seconds', '_bytes', '_count', '_ts', '_state']

  // Allow histogram suffixes (`_count`, `_sum`, `_bucket`) on top
  // of the base name, plus PromQL aggregations.
  const PROMQL_KEYWORDS = new Set([
    'sum',
    'avg',
    'max',
    'min',
    'rate',
    'irate',
    'increase',
    'delta',
    'time',
    'clamp_min',
    'clamp_max',
    'histogram_quantile',
    'absent',
    'absent_over_time',
    'on',
    'by',
    'without',
    'and',
    'or',
    'unless',
    'group_left',
    'group_right',
    'le',
    'ignoring',
    'humanizeDuration',
    'humanizePercentage',
  ])

  // Pull every snake_case-ish identifier from the file
  const tokens = new Set<string>()
  const re = /[a-z][a-z0-9_]*[a-z0-9]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(alerts)) !== null) tokens.add(m[0])

  for (const token of tokens) {
    if (!sanctionedSuffixes.some((s) => token.endsWith(s))) continue
    if (PROMQL_KEYWORDS.has(token)) continue

    // Histogram exposition: `metric_bucket`, `metric_count`, `metric_sum`
    const base = token
      .replace(/_bucket$/, '')
      .replace(/_count$/, '')
      .replace(/_sum$/, '')
    const candidates = [token, base]

    it(`alert references metric "${token}" — must exist in Metrics`, () => {
      const hit = candidates.some((c) => knownMetrics.has(c))
      expect(
        hit,
        `Token "${token}" appears in alerts.yml but neither "${token}" nor its histogram base "${base}" is exported by Metrics. Either add it to lib/metrics.ts or remove from alerts.`
      ).toBe(true)
    })
  }
})

describe('grafana dashboards — every referenced metric exists', () => {
  const knownMetrics = new Set(Object.values(Metrics))
  const dashboards = readDir(GRAFANA_DIR).filter((f) => extname(f) === '.json')

  for (const file of dashboards) {
    it(`${file.replace(ROOT + '/', '')} only references known metrics`, () => {
      const content = readFileSync(file, 'utf8')
      const tokens = new Set<string>()
      // PromQL identifiers in JSON are inside "expr":"..." / "query":"..."
      // — extract via regex.
      const re = /[a-z][a-z0-9_]*[a-z0-9]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) tokens.add(m[0])

      const missing: string[] = []
      const SUFFIXES = ['_total', '_ms', '_seconds', '_bytes', '_count', '_ts', '_state']
      for (const token of tokens) {
        if (!SUFFIXES.some((s) => token.endsWith(s))) continue
        const base = token
          .replace(/_bucket$/, '')
          .replace(/_count$/, '')
          .replace(/_sum$/, '')
        if (!knownMetrics.has(token) && !knownMetrics.has(base)) {
          missing.push(token)
        }
      }

      expect(
        missing,
        `Dashboard ${file} references unknown metrics: ${missing.join(', ')}`
      ).toEqual([])
    })
  }
})

describe('exposition format — metricsText() output is valid Prometheus', () => {
  it('produces parseable lines with label set when relevant', () => {
    __resetMetricsForTests()
    incCounter(Metrics.RATE_LIMIT_HITS_TOTAL, { bucket: 'auth.login', outcome: 'allowed' })
    incCounter(Metrics.RATE_LIMIT_HITS_TOTAL, { bucket: 'auth.login', outcome: 'denied' }, 3)
    setGauge(Metrics.CIRCUIT_BREAKER_STATE, 0, { provider: 'asaas' })
    observeHistogram(Metrics.RATE_LIMIT_CHECK_DURATION_MS, 10, { bucket: 'auth.login' })
    observeHistogram(Metrics.RATE_LIMIT_CHECK_DURATION_MS, 12, { bucket: 'auth.login' })

    const text = metricsText()
    const lines = text.split('\n')

    expect(
      lines.some((l) =>
        l.startsWith('rate_limit_hits_total{bucket="auth.login",outcome="allowed"} 1')
      )
    ).toBe(true)
    expect(
      lines.some((l) =>
        l.startsWith('rate_limit_hits_total{bucket="auth.login",outcome="denied"} 3')
      )
    ).toBe(true)
    expect(lines.some((l) => l.startsWith('circuit_breaker_state{provider="asaas"} 0'))).toBe(true)
    expect(
      lines.some((l) => l.startsWith('rate_limit_check_duration_ms{bucket="auth.login"}_count 2'))
    ).toBe(true)

    // No invalid characters allowed in metric line tails (we
    // explicitly avoid commas in unquoted positions etc.)
    for (const line of lines) {
      if (!line) continue
      // Bare-bones: each line must contain at least one space
      // separating name and value.
      expect(line.includes(' '), `Malformed metric line: "${line}"`).toBe(true)
    }

    __resetMetricsForTests()
  })

  it('produces a snapshot with stable shape', () => {
    __resetMetricsForTests()
    incCounter(Metrics.HTTP_REQUEST_TOTAL, { route: '/api/health', status_class: '2xx' })
    const snap = snapshotMetrics()
    expect(snap.counters.length).toBe(1)
    expect(snap.counters[0]).toMatchObject({
      name: 'http_request_total',
      value: 1,
      labels: { route: '/api/health', status_class: '2xx' },
    })
    __resetMetricsForTests()
  })
})

describe('Bucket / rate-limit guard contract', () => {
  it('all Bucket values are unique', () => {
    const values = Object.values(Bucket)
    expect(new Set(values).size).toBe(values.length)
  })

  it('all Bucket values are dot-separated lowercase identifiers', () => {
    for (const v of Object.values(Bucket)) {
      expect(v, `Bucket value "${v}" must be dot.snake_case`).toMatch(
        /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
      )
    }
  })
})
