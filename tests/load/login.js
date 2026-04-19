/**
 * Load test 2: Authentication via Supabase — no Vercel middleware.
 * Tests Supabase auth throughput with valid credentials.
 *
 * Credentials are NEVER hardcoded — they must be supplied via env vars.
 * This protects production users from accidental brute-force during a
 * local run.
 *
 * Run:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_ANON_KEY=<key> \
 *   LOAD_TEST_PASSWORD=<staging password> \
 *   k6 run tests/load/login.js
 *
 * IMPORTANT: only point this at STAGING. Do not run against production
 * Supabase — repeated identical password attempts will trip rate-limits.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'
import { pick } from './_helpers.js'

const errorRate = new Rate('errors')

export const options = {
  vus: 25,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
  },
  tags: { test_type: 'login' },
}

const SUPABASE_URL = __ENV.SUPABASE_URL
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY
const PASSWORD = __ENV.LOAD_TEST_PASSWORD

const TEST_USERS = [
  'admin@clinipharma.com.br',
  'clinica@clinipharma.com.br',
  'medico@clinipharma.com.br',
  'farmacia@clinipharma.com.br',
]

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !PASSWORD) {
    throw new Error(
      'login.js requires SUPABASE_URL, SUPABASE_ANON_KEY and LOAD_TEST_PASSWORD env vars'
    )
  }
}

export default function () {
  const email = pick(TEST_USERS)

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password: PASSWORD }),
    {
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      timeout: '10s',
    }
  )

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has access_token': (r) => r.json('access_token') !== null,
  })

  errorRate.add(!ok)
  sleep(1)
}

export function handleSummary(data) {
  return {
    stdout: shortSummary(data),
    'tests/load/results/login.json': JSON.stringify(data, null, 2),
  }
}

function shortSummary(data) {
  const m = data.metrics
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'n/a'
  const failRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)
  return `\nLOGIN LOAD TEST SUMMARY\n  HTTP p95: ${p95} ms\n  failure:  ${failRate}%\n`
}
