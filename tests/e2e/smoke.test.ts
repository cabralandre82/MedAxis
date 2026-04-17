/**
 * E2E Smoke Tests — run on every deploy (fast, broad).
 * Checks that the application loads without crashes on key routes.
 * Designed to run on both Desktop Chrome and Mobile Chrome projects.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test smoke
 */
import { test, expect } from '@playwright/test'

const AUTHENTICATED_ROUTES = ['/dashboard', '/orders', '/profile']

const PUBLIC_ROUTES = ['/login', '/terms', '/privacy']

test.describe('Smoke: public routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const route of PUBLIC_ROUTES) {
    test(`${route} loads without error`, async ({ page }) => {
      const errors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      page.on('pageerror', (err) => errors.push(err.message))

      await page.goto(route)
      await expect(page.locator('body')).toBeVisible({ timeout: 15_000 })

      // No React crashes (Next.js error overlay)
      await expect(page.locator('#nextjs-portal, [data-nextjs-dialog]')).not.toBeVisible()

      // Filter out known 3rd-party noise (Vercel Live feedback on preview, browser extensions)
      const criticalErrors = errors.filter(
        (e) =>
          !e.includes('chrome-extension') &&
          !e.includes('favicon') &&
          !e.includes('vercel.live') && // Vercel Live feedback toolbar (preview only)
          !e.includes('vercel-scripts') &&
          !e.includes('_next-live') &&
          !e.includes('Content Security Policy') // CSP blocks from Vercel injected preview scripts
      )
      expect(criticalErrors).toHaveLength(0)
    })
  }
})

test.describe('Smoke: authenticated routes', () => {
  for (const route of AUTHENTICATED_ROUTES) {
    test(`${route} loads without crash`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))

      await page.goto(route)

      // Either loads the route or redirects to login (no crash)
      await expect(page.locator('body')).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('#nextjs-portal, [data-nextjs-dialog]')).not.toBeVisible()

      const criticalErrors = errors.filter(
        (e) =>
          !e.includes('chrome-extension') && !e.includes('favicon') && !e.includes('ResizeObserver')
      )
      expect(criticalErrors).toHaveLength(0)
    })
  }

  test('no console errors on dashboard', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle', { timeout: 15_000 })

    const meaningful = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('chrome-extension') &&
        !e.includes('gtm') &&
        !e.includes('analytics') &&
        !e.includes('vercel.live') && // Vercel Live feedback toolbar (preview only)
        !e.includes('_next-live') &&
        !e.includes('vercel-scripts') &&
        !e.includes('Content Security Policy') // CSP blocks from Vercel injected preview scripts
    )
    expect(meaningful).toHaveLength(0)
  })
})

test.describe('Smoke: API health', () => {
  test('health endpoint responds 200', async ({ request }) => {
    const response = await request.get('/api/health')
    // Accept 200 or 204 (some health endpoints return no content)
    expect([200, 204]).toContain(response.status())
  })

  test('API returns JSON with correct Content-Type', async ({ request }) => {
    const response = await request.get('/api/health')
    const contentType = response.headers()['content-type'] ?? ''
    expect(contentType).toContain('application/json')
  })
})
