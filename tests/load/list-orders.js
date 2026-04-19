/**
 * Load test 3: GET /api/orders with pagination — authenticated.
 * Tests the orders listing endpoint under sustained load.
 *
 * Token is acquired automatically in setup() — no need to pass AUTH_TOKEN.
 *
 * Run:
 *   BASE_URL=https://staging.clinipharma.com.br \
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_ANON_KEY=<key> \
 *   LOAD_TEST_PASSWORD=<password> \
 *   k6 run tests/load/list-orders.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { getAuthToken, authHeaders, pick, randInt } from './_helpers.js'

const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.001'],
    errors: ['rate<0.001'],
  },
  tags: { test_type: 'list-orders' },
}

const BASE_URL = __ENV.BASE_URL || 'https://staging.clinipharma.com.br'

export function setup() {
  // Allow override with AUTH_TOKEN if user prefers manual mode.
  if (__ENV.AUTH_TOKEN) {
    return { token: __ENV.AUTH_TOKEN }
  }
  return { token: getAuthToken() }
}

export default function (data) {
  const page = randInt(1, 5)
  const status = pick(['PENDING', 'PROCESSING', 'COMPLETED', ''])
  const qs = status ? `?limit=20&page=${page}&status=${status}` : `?limit=20&page=${page}`

  const res = http.get(`${BASE_URL}/api/orders${qs}`, {
    headers: authHeaders(data.token),
    timeout: '15s',
  })

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has data array': (r) => {
      try {
        const body = r.json()
        return Array.isArray(body?.data) || Array.isArray(body)
      } catch {
        return false
      }
    },
  })

  errorRate.add(!ok)
  sleep(0.5)
}

export function handleSummary(data) {
  return {
    stdout: shortSummary(data),
    'tests/load/results/list-orders.json': JSON.stringify(data, null, 2),
  }
}

function shortSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  const reqs = m.http_reqs?.values?.count ?? 0
  return `\nLIST-ORDERS SUMMARY\n  Requests: ${reqs}\n  HTTP p95: ${p95} ms\n  failure:  ${failRate}%\n`
}
