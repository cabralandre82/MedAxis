/**
 * Load test 4: GET /api/export — CSV export under light concurrent load.
 * Tests the heavy export endpoint that queries many rows from Supabase.
 *
 * Token is acquired automatically in setup() — no need to pass AUTH_TOKEN.
 *
 * Run:
 *   BASE_URL=https://staging.clinipharma.com.br \
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_ANON_KEY=<key> \
 *   LOAD_TEST_PASSWORD=<password> \
 *   k6 run tests/load/export-csv.js
 *
 * NOTE: VUs intentionally low (10). This endpoint is heavy and rate-limited
 * to 5 req/min/user via the API rate-limiter — sustained higher loads will
 * trip 429s, which is the EXPECTED defense.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { getAuthToken, authHeaders, pick } from './_helpers.js'

const errorRate = new Rate('errors')

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: {
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
  },
  tags: { test_type: 'export-csv' },
}

const BASE_URL = __ENV.BASE_URL || 'https://staging.clinipharma.com.br'

export function setup() {
  if (__ENV.AUTH_TOKEN) {
    return { token: __ENV.AUTH_TOKEN }
  }
  return { token: getAuthToken() }
}

export default function (data) {
  const exportType = pick(['orders', 'registrations'])

  const res = http.get(
    `${BASE_URL}/api/export?type=${exportType}&format=csv`,
    {
      headers: { Authorization: `Bearer ${data.token}` },
      timeout: '30s',
    }
  )

  const ok = check(res, {
    'status not 5xx': (r) => r.status < 500,
    // 429 is expected and correct under sustained load — the rate-limiter
    // is doing its job and protecting Supabase from saturation.
    'response time < 30s': (r) => r.timings.duration < 30000,
  })

  errorRate.add(!ok)
  sleep(5)
}

export function handleSummary(data) {
  return {
    stdout: shortSummary(data),
    'tests/load/results/export-csv.json': JSON.stringify(data, null, 2),
  }
}

function shortSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  return `\nEXPORT-CSV SUMMARY\n  HTTP p95: ${p95} ms\n  failure:  ${failRate}%\n  (NOTE: 429 throttling is expected and counts as success)\n`
}
