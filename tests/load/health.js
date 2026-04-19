/**
 * Load test 1: Health check endpoint — no auth required.
 * Tests platform responsiveness under concurrent requests.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br k6 run tests/load/health.js
 *
 * Recommended target: a Vercel preview deployment, NOT production.
 * Run from the same region (gru1) as the deployment for realistic latency.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const errorRate = new Rate('errors')
const dbLatency = new Trend('db_latency_ms')

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.001'],
    errors: ['rate<0.001'],
    db_latency_ms: ['p(95)<500', 'p(99)<1500'],
  },
  tags: { test_type: 'health' },
}

const BASE_URL = __ENV.BASE_URL || 'https://staging.clinipharma.com.br'

export default function () {
  const res = http.get(`${BASE_URL}/api/health`, {
    headers: { Accept: 'application/json' },
    timeout: '10s',
  })

  let body = null
  try {
    body = res.json()
  } catch {
    // body may not be JSON if the endpoint is degraded
  }

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'database ok': () => body && body.checks && body.checks.database && body.checks.database.ok === true,
    'env ok': () => body && body.checks && body.checks.env && body.checks.env.ok === true,
    'response time < 800ms': (r) => r.timings.duration < 800,
  })

  if (body && body.checks && body.checks.database) {
    dbLatency.add(body.checks.database.latencyMs || 0)
  }

  errorRate.add(!ok)
  sleep(0.5)
}

export function handleSummary(data) {
  return {
    stdout: defaultSummary(data),
    'tests/load/results/health.json': JSON.stringify(data, null, 2),
  }
}

function defaultSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const dbP95 = m.db_latency_ms?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  return `\nHEALTH LOAD TEST SUMMARY\n  HTTP p95: ${p95} ms\n  DB p95:   ${dbP95} ms\n  failure:  ${failRate}%\n`
}
