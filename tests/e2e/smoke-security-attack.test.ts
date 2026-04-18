/**
 * Wave 5 attack-surface smoke tests.
 *
 * These don't require authenticated state — they exercise the security
 * edge: middleware CSRF gate, login's `?next=` open-redirect defence,
 * and the Asaas/Clicksign webhook HMAC guards. They run in CI behind
 * the `smoke` pattern so every PR re-verifies the defences we can't
 * afford to regress silently.
 *
 * Run locally:
 *   npx playwright test smoke-security --project=chromium
 */
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Security: CSRF middleware', () => {
  test('POST to /api/ with no Origin is blocked with 403', async ({ request }) => {
    // Playwright's APIRequestContext does not set Origin by default.
    const res = await request.post('/api/notifications', {
      data: { foo: 'bar' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(403)
    const body = await res.json().catch(() => ({}))
    expect(body.error).toBe('csrf_blocked')
  })

  test('POST to /api/ with mismatched Origin is blocked with 403', async ({ request }) => {
    const res = await request.post('/api/notifications', {
      data: { foo: 'bar' },
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
    })
    expect(res.status()).toBe(403)
    const body = await res.json().catch(() => ({}))
    expect(body.reason).toBe('origin_mismatch')
  })

  test('GET to /api/ is never blocked by CSRF (safe method)', async ({ request }) => {
    const res = await request.get('/api/health')
    expect([200, 204]).toContain(res.status())
  })

  test('POST to /api/payments/asaas/webhook is exempt from CSRF (own auth)', async ({
    request,
  }) => {
    // Exempt path — missing Origin is fine. Request will 401 for wrong
    // access token OR 400 for bad JSON, never 403 csrf_blocked.
    const res = await request.post('/api/payments/asaas/webhook', {
      data: { event: 'noop' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).not.toBe(403)
  })
})

test.describe('Security: open-redirect defence', () => {
  test('/auth/callback?next=//evil.com redirects same-origin only', async ({ page, baseURL }) => {
    // Without a valid token_hash or code, the callback route exits via
    // its final `/unauthorized` redirect. safeNextPath ensures `next`
    // never becomes an external URL along the way — the final landing
    // page must be same-origin even though the query has `//evil.com`.
    const response = await page.goto('/auth/callback?next=%2F%2Fevil.example.com')
    expect(response?.status()).toBeLessThan(500)
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin
    // The browser's final URL after following redirects must be same-origin.
    expect(page.url().startsWith(origin)).toBe(true)
    // And must land on a known same-origin path (either /unauthorized
    // or a path that was safely neutralised).
    const path = new URL(page.url()).pathname
    expect(['/unauthorized', '/dashboard', '/login']).toContain(path)
  })

  test('/login?next=//evil.com renders normally (attack is in the submit target)', async ({
    page,
  }) => {
    // The URL bar still shows the attacker-controlled query — the
    // defence only kicks in at form submit time (LoginForm calls
    // safeNextPath before router.push). We verify the page renders
    // without crashing and no JS error evaluates the raw `next`.
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    const response = await page.goto('/login?next=%2F%2Fevil.example.com%2Fpwned')
    expect(response?.status()).toBeLessThan(500)
    await expect(page.locator('form')).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})

test.describe('Security: webhook HMAC guards', () => {
  test('Clicksign webhook path is NOT blocked by CSRF middleware', async ({ request }) => {
    const res = await request.post('/api/contracts/webhook', {
      data: { event: { name: 'sign' }, document: { key: 'ignored' } },
      headers: {
        'content-type': 'application/json',
        'content-hmac': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
    })
    // The only security guarantee this smoke test asserts: the
    // webhook path bypasses CSRF (it has its own HMAC auth), so we
    // never see a 403 csrf_blocked response here regardless of
    // whether the HMAC is valid. Deeper HMAC semantics are covered
    // in tests/unit/api/contracts-webhook.test.ts and
    // tests/unit/lib/security-hmac.test.ts.
    expect(res.status()).not.toBe(403)
  })

  test('Asaas webhook path is NOT blocked by CSRF middleware', async ({ request }) => {
    const res = await request.post('/api/payments/asaas/webhook', {
      data: { event: 'PAYMENT_CONFIRMED', payment: { id: 'x' } },
      headers: { 'content-type': 'application/json' },
    })
    // Same as above: CSRF exemption verified. Token-compare semantics
    // covered by unit tests.
    expect(res.status()).not.toBe(403)
  })
})
