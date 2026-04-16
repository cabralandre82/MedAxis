/**
 * Load test 3: GET /api/orders with pagination — authenticated.
 * Tests the orders listing endpoint under sustained load.
 *
 * Run:
 *   BASE_URL=https://clinipharma.com.br \
 *   AUTH_TOKEN=<supabase-jwt> \
 *   k6 run tests/load/list-orders.js
 *
 * Get AUTH_TOKEN:
 *   curl -X POST https://<project>.supabase.co/auth/v1/token?grant_type=password \
 *     -H "apikey: <anon>" -H "Content-Type: application/json" \
 *     -d '{"email":"admin@clinipharma.com.br","password":"Clinipharma@2026"}' \
 *     | jq -r .access_token
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

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
}

const BASE_URL = __ENV.BASE_URL || 'https://clinipharma.com.br'
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''

export default function () {
  if (!AUTH_TOKEN) {
    console.error('AUTH_TOKEN is required — see script header for instructions')
    return
  }

  const page = Math.floor(Math.random() * 5) + 1
  const status = ['PENDING', 'PROCESSING', 'COMPLETED', ''][
    Math.floor(Math.random() * 4)
  ]
  const qs = status ? `?limit=20&page=${page}&status=${status}` : `?limit=20&page=${page}`

  const res = http.get(`${BASE_URL}/api/orders${qs}`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: '15s',
  })

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has data array': (r) => {
      try {
        const body = r.json()
        return Array.isArray(body.data) || Array.isArray(body)
      } catch {
        return false
      }
    },
  })

  errorRate.add(!ok)
  sleep(0.5)
}
