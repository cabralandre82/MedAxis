/**
 * Load test 1: Health check endpoint — no auth required.
 * Validates the platform stays responsive under concurrent requests.
 *
 * Run: BASE_URL=https://... k6 run tests/load/health.js
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

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

const BASE_URL = __ENV.BASE_URL || 'https://b2b-med-platform-7n3qv5itg-cabralandre-3009s-projects.vercel.app'

export default function () {
  const res = http.get(`${BASE_URL}/api/health`, {
    headers: { Accept: 'application/json' },
    timeout: '10s',
  })

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has supabase status': (r) => r.json('supabase') !== undefined,
    'response time < 800ms': (r) => r.timings.duration < 800,
  })

  errorRate.add(!ok)
  sleep(0.5)
}
