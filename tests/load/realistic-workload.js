/**
 * Realistic workload — mixes endpoints in proportions that mirror
 * actual user behavior collected from `vw_top_endpoints` audit view.
 *
 * Distribution (approx., based on Q1/2026 telemetry):
 *   60% — list orders (operators)
 *   20% — health checks (monitoring)
 *   10% — read single order (operators)
 *    5% — list registrations (admins)
 *    5% — export CSV (admins, infrequent but heavy)
 *
 * Run:
 *   BASE_URL=https://staging.clinipharma.com.br \
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_ANON_KEY=<key> \
 *   LOAD_TEST_PASSWORD=<password> \
 *   k6 run tests/load/realistic-workload.js
 */
import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { getAuthToken, authHeaders, pick, randInt } from './_helpers.js'

const errorRate = new Rate('errors')

export const options = {
  scenarios: {
    realistic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '3m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
      tags: { test_type: 'realistic' },
    },
  },
  thresholds: {
    'http_req_duration{group:::list-orders}': ['p(95)<800'],
    'http_req_duration{group:::read-order}': ['p(95)<400'],
    'http_req_duration{group:::list-registrations}': ['p(95)<1200'],
    'http_req_duration{group:::health}': ['p(95)<300'],
    'http_req_duration{group:::export-csv}': ['p(95)<10000'],
    'http_req_failed': ['rate<0.01'],
    'errors': ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'https://staging.clinipharma.com.br'

export function setup() {
  return { token: getAuthToken() }
}

export default function (data) {
  const r = Math.random()

  if (r < 0.6) {
    listOrders(data.token)
  } else if (r < 0.8) {
    healthCheck()
  } else if (r < 0.9) {
    readOrder(data.token)
  } else if (r < 0.95) {
    listRegistrations(data.token)
  } else {
    exportCsv(data.token)
  }

  sleep(randInt(1, 3))
}

function listOrders(token) {
  group('list-orders', () => {
    const status = pick(['PENDING', 'PROCESSING', 'COMPLETED', ''])
    const page = randInt(1, 5)
    const qs = status ? `?limit=20&page=${page}&status=${status}` : `?limit=20&page=${page}`
    const res = http.get(`${BASE_URL}/api/orders${qs}`, {
      headers: authHeaders(token),
      timeout: '15s',
    })
    const ok = check(res, {
      'list-orders 200': (r) => r.status === 200,
    })
    errorRate.add(!ok)
  })
}

function readOrder(token) {
  group('read-order', () => {
    // Use the canonical seed UUID that exists in staging.
    const id = __ENV.LOAD_TEST_ORDER_ID || '00000000-0000-0000-0000-000000000001'
    const res = http.get(`${BASE_URL}/api/orders/${id}`, {
      headers: authHeaders(token),
      timeout: '10s',
    })
    const ok = check(res, {
      'read-order 200 or 404': (r) => [200, 404].includes(r.status),
    })
    errorRate.add(!ok)
  })
}

function listRegistrations(token) {
  group('list-registrations', () => {
    const res = http.get(`${BASE_URL}/api/registrations?limit=20&page=1`, {
      headers: authHeaders(token),
      timeout: '15s',
    })
    const ok = check(res, {
      'list-registrations 200 or 403': (r) => [200, 403].includes(r.status),
    })
    errorRate.add(!ok)
  })
}

function healthCheck() {
  group('health', () => {
    const res = http.get(`${BASE_URL}/api/health`, { timeout: '10s' })
    const ok = check(res, {
      'health 200 or 503': (r) => [200, 503].includes(r.status),
    })
    errorRate.add(!ok)
  })
}

function exportCsv(token) {
  group('export-csv', () => {
    const type = pick(['orders', 'registrations'])
    const res = http.get(`${BASE_URL}/api/export?type=${type}&format=csv`, {
      headers: authHeaders(token),
      timeout: '30s',
    })
    const ok = check(res, {
      'export status not 5xx': (r) => r.status < 500,
    })
    errorRate.add(!ok)
  })
}

export function handleSummary(data) {
  return {
    stdout: shortSummary(data),
    'tests/load/results/realistic.json': JSON.stringify(data, null, 2),
  }
}

function shortSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const p99 = m.http_req_duration?.values?.['p(99)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  const reqs = m.http_reqs?.values?.count ?? 0
  const rps = (m.http_reqs?.values?.rate ?? 0).toFixed(2)
  return `\nREALISTIC WORKLOAD SUMMARY\n  Total requests: ${reqs} (${rps} req/s)\n  p95 / p99:      ${p95} / ${p99} ms\n  failure rate:   ${failRate}%\n`
}
