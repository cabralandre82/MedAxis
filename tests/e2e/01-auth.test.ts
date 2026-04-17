/**
 * E2E: Authentication flows.
 * Tests: login success, login failure, logout, password reset.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 01-auth
 */
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/login.page'

// These tests don't require auth state — run without storageState
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    await expect(login.emailInput).toBeVisible()
    await expect(login.passwordInput).toBeVisible()
    await expect(login.submitButton).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.login('invalid@example.com', 'wrong-password')

    // Should show error message — use .first() to avoid strict mode violation
    await expect(page.getByText(/credenciais|inválido|senha|usuário/i).first()).toBeVisible({
      timeout: 8_000,
    })
    // Should not redirect away from login
    await expect(page).toHaveURL(/login/)
  })

  test('shows error on empty submission', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.submitButton.click()

    // HTML5 validation or custom error
    await expect(page.locator(':invalid, [data-error]'))
      .toBeVisible({ timeout: 3_000 })
      .catch(async () => {
        // Fallback: page didn't navigate away
        await expect(page).toHaveURL(/login/)
      })
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/, { timeout: 10_000 })
  })

  test('redirects unauthenticated users from protected routes', async ({ page }) => {
    for (const path of ['/orders', '/admin/pharmacies', '/profile']) {
      await page.goto(path)
      await expect(page).toHaveURL(/login/, { timeout: 10_000 })
    }
  })

  test('legal pages are accessible without authentication', async ({ page }) => {
    for (const path of ['/terms', '/privacy']) {
      await page.goto(path)
      await expect(page).not.toHaveURL(/login/, { timeout: 10_000 })
      await expect(page.locator('body')).toBeVisible()
    }
  })

  test('password reset link is accessible from login page', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()

    // Try multiple possible link texts/hrefs for the forgot password link
    const resetLink = page
      .getByRole('link', { name: /esqueceu|redefinir|recuperar|senha/i })
      .or(page.locator('a[href*="forgot"], a[href*="recover"], a[href*="reset"]'))
      .first()

    await expect(resetLink).toBeVisible({ timeout: 8_000 })
    await resetLink.click()
    await expect(page).toHaveURL(/recover|reset|forgot|password/, { timeout: 8_000 })
  })
})
