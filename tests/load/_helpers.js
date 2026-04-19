/**
 * Shared helpers for k6 load tests.
 *
 * Avoids duplication of token acquisition, randomized inputs and
 * standard threshold definitions across each scenario script.
 */

import http from 'k6/http'
import { check } from 'k6'

/**
 * Acquire a Supabase access_token via password grant.
 * Use in a setup() function so it runs once per scenario, not per VU.
 *
 * @returns {string} JWT access_token
 */
export function getAuthToken({
  supabaseUrl = __ENV.SUPABASE_URL,
  anonKey = __ENV.SUPABASE_ANON_KEY,
  email = __ENV.LOAD_TEST_EMAIL || 'admin@clinipharma.com.br',
  password = __ENV.LOAD_TEST_PASSWORD,
} = {}) {
  if (!supabaseUrl || !anonKey || !password) {
    throw new Error(
      'getAuthToken requires SUPABASE_URL, SUPABASE_ANON_KEY and LOAD_TEST_PASSWORD env vars'
    )
  }

  const res = http.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      timeout: '10s',
    }
  )

  const ok = check(res, {
    'auth setup: 200': (r) => r.status === 200,
    'auth setup: has token': (r) => !!r.json('access_token'),
  })

  if (!ok) {
    throw new Error(`getAuthToken failed: HTTP ${res.status} — ${res.body?.slice(0, 200)}`)
  }

  return res.json('access_token')
}

/**
 * Random pick from an array.
 */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Random integer in [min, max] inclusive.
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Standard thresholds for a non-mutating GET endpoint that should be fast.
 */
export const FAST_READ_THRESHOLDS = {
  http_req_duration: ['p(95)<500', 'p(99)<1500'],
  http_req_failed: ['rate<0.005'],
  errors: ['rate<0.005'],
}

/**
 * Standard thresholds for a heavier (DB join, aggregation) read.
 */
export const HEAVY_READ_THRESHOLDS = {
  http_req_duration: ['p(95)<1500', 'p(99)<4000'],
  http_req_failed: ['rate<0.01'],
  errors: ['rate<0.01'],
}

/**
 * Standard thresholds for a write-heavy (mutating) endpoint.
 */
export const WRITE_THRESHOLDS = {
  http_req_duration: ['p(95)<2000', 'p(99)<5000'],
  http_req_failed: ['rate<0.02'],
  errors: ['rate<0.02'],
}

/**
 * Pre-build standard auth headers.
 */
export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}
