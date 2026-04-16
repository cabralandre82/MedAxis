/**
 * Load test 4: GET /api/export — CSV export under light concurrent load.
 * Tests the heavy export endpoint that queries many rows from Supabase.
 *
 * Run:
 *   BASE_URL=https://clinipharma.com.br \
 *   AUTH_TOKEN=<supabase-jwt> \
 *   k6 run tests/load/export-csv.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: {
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'https://clinipharma.com.br'
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''

export default function () {
  if (!AUTH_TOKEN) {
    console.error('AUTH_TOKEN is required — see script header for instructions')
    return
  }

  const exportType = ['orders', 'registrations'][Math.floor(Math.random() * 2)]

  const res = http.get(
    `${BASE_URL}/api/export?type=${exportType}&format=csv`,
    {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      timeout: '30s',
    }
  )

  const ok = check(res, {
    'status 200 or 404': (r) => [200, 404].includes(r.status),
    'not 500': (r) => r.status !== 500,
    'response time < 10s': (r) => r.timings.duration < 10000,
  })

  errorRate.add(!ok)
  sleep(5)
}
