/**
 * Load test 1: Health check endpoint — no auth required.
 * Tests platform responsiveness under concurrent requests.
 *
 * Run: BASE_URL=https://clinipharma.com.br k6 run tests/load/health.js
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
  },
}

const BASE_URL = __ENV.BASE_URL || 'https://clinipharma.com.br'

export default function () {
  const res = http.get(`${BASE_URL}/api/health`, {
    headers: { Accept: 'application/json' },
    timeout: '10s',
  })

  const body = res.json()
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
