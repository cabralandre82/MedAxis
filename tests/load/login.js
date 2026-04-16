/**
 * Load test 2: Authentication via Supabase — no Vercel middleware.
 * Tests Supabase auth throughput with valid + invalid credentials.
 *
 * Run:
 *   SUPABASE_URL=https://ghjexiyrqdtqhkolsyaw.supabase.co \
 *   SUPABASE_ANON_KEY=<key> \
 *   k6 run tests/load/login.js
 *
 * Staging defaults pre-configured below.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

export const options = {
  vus: 50,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
  },
}

const SUPABASE_URL =
  __ENV.SUPABASE_URL || 'https://ghjexiyrqdtqhkolsyaw.supabase.co'
const SUPABASE_ANON_KEY =
  __ENV.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoamV4aXlycWR0cWhrb2xzeWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzU2ODEsImV4cCI6MjA5MTk1MTY4MX0.MmxwF0GwZw-K3Dq72d4TT37J39fBk8ePQt-YBLYfxA8'

const TEST_USERS = [
  { email: 'admin@clinipharma.com.br', password: 'Clinipharma@2026' },
  { email: 'clinica@clinipharma.com.br', password: 'Clinipharma@2026' },
  { email: 'medico@clinipharma.com.br', password: 'Clinipharma@2026' },
  { email: 'farmacia@clinipharma.com.br', password: 'Clinipharma@2026' },
]

export default function () {
  const user = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)]

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: user.email, password: user.password }),
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
