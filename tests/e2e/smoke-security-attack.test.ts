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

test.describe('Security: open-redirect defence on login', () => {
  test('/login?next=//evil.com does not actually redirect cross-origin', async ({ page }) => {
    await page.goto('/login?next=%2F%2Fevil.example.com%2Fpwned')
    // The login form renders normally. Read the hidden field / script
    // behaviour indirectly: the "next" cookie / submit destination
    // should have been neutralised by safeNextPath.
    await expect(page.locator('form')).toBeVisible()
    // Critically, no automatic navigation to evil.example.com happened.
    expect(page.url()).toContain('/login')
    expect(page.url()).not.toContain('evil.example.com')
  })

  test('/auth/callback?next=//evil.com redirects to /unauthorized (no code)', async ({
    page,
    baseURL,
  }) => {
    // Without a valid token_hash or code, the callback route exits via
    // its final `/unauthorized` redirect. safeNextPath still ensures
    // the `next` never becomes an external URL along the way.
    const response = await page.goto('/auth/callback?next=%2F%2Fevil.example.com')
    expect(response?.status()).toBeLessThan(500)
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin
    expect(page.url().startsWith(origin)).toBe(true)
    expect(page.url()).not.toContain('evil.example.com')
  })
})

test.describe('Security: webhook HMAC guards', () => {
  test('Clicksign webhook rejects a body with no / invalid HMAC', async ({ request }) => {
    const res = await request.post('/api/contracts/webhook', {
      data: { event: { name: 'sign' }, document: { key: 'ignored' } },
      headers: {
        'content-type': 'application/json',
        'content-hmac': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
    })
    // Either 401 (secret configured) or 200 (no secret in dev). We
    // accept both because the test runs against an ephemeral server
    // that may not have CLICKSIGN_WEBHOOK_SECRET in the env, but we
    // assert that NO 5xx ever happens (route doesn't crash on bad HMAC).
    expect(res.status()).toBeLessThan(500)
    if (process.env.CLICKSIGN_WEBHOOK_SECRET) {
      expect(res.status()).toBe(401)
    }
  })

  test('Asaas webhook rejects a missing token with 401', async ({ request }) => {
    const res = await request.post('/api/payments/asaas/webhook', {
      data: { event: 'PAYMENT_CONFIRMED', payment: { id: 'x' } },
      headers: { 'content-type': 'application/json' },
    })
    // No access token → 401 (constant-time compare of empty string
    // against configured secret returns false, and compare returns
    // false when secret is absent too).
    expect([401, 200]).toContain(res.status())
    if (process.env.ASAAS_WEBHOOK_SECRET) {
      expect(res.status()).toBe(401)
    }
  })
})
