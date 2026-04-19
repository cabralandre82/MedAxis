/**
 * Smoke load test — sanity check before unleashing real load.
 *
 * 5 VUs for 1 minute touching only public, non-mutating endpoints.
 * Intent: surface broken DNS, certificate, CSP regressions, or
 * obviously broken health endpoints in 60s.
 *
 * Run:
 *   BASE_URL=https://staging.clinipharma.com.br k6 run tests/load/smoke.js
 *
 * Recommended: run before EVERY production deploy.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
  // Tag this run so the eventual JSON output is easy to filter in Grafana.
  tags: { test_type: 'smoke' },
}

const BASE_URL = __ENV.BASE_URL || 'https://staging.clinipharma.com.br'

const ENDPOINTS = [
  { path: '/api/health', expectedStatus: [200, 503] },
  { path: '/api/health/live', expectedStatus: [200] },
  { path: '/api/health/ready', expectedStatus: [200, 503] },
  { path: '/login', expectedStatus: [200] },
  { path: '/privacy', expectedStatus: [200] },
  { path: '/terms', expectedStatus: [200] },
  { path: '/dpo', expectedStatus: [200] },
  { path: '/trust', expectedStatus: [200] },
  { path: '/status', expectedStatus: [200] },
  { path: '/.well-known/security.txt', expectedStatus: [200] },
]

export default function () {
  for (const ep of ENDPOINTS) {
    const res = http.get(`${BASE_URL}${ep.path}`, { timeout: '10s' })
    const ok = check(res, {
      [`${ep.path} returns expected status`]: (r) => ep.expectedStatus.includes(r.status),
      [`${ep.path} responds in <2s`]: (r) => r.timings.duration < 2000,
    })
    errorRate.add(!ok)
  }
  sleep(1)
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
    'tests/load/results/smoke.json': JSON.stringify(data, null, 2),
  }
}

// Inline mini text summary so we don't depend on k6 community libs.
function textSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  const reqs = m.http_reqs?.values?.count ?? 0
  return `\nSMOKE LOAD TEST SUMMARY\n  Total requests: ${reqs}\n  p95 duration:   ${p95} ms\n  failure rate:   ${failRate}%\n`
}
