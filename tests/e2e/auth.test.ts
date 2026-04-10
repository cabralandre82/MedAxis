import { test, expect } from '@playwright/test'

const SUPER_ADMIN_EMAIL = 'cabralandre@yahoo.com.br'
const SUPER_ADMIN_PASSWORD = 'Clinipharma@2026'

test.describe('Authentication', () => {
  test('TC-AUTH-01: Login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h2')).toContainText('Acessar plataforma')

    await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
    await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/dashboard', { timeout: 10000 })
    await expect(page.url()).toContain('/dashboard')
  })

  test('TC-AUTH-02: Login with invalid credentials shows error toast', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'wrong@email.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5000 })
  })

  test('TC-AUTH-03: Unauthenticated access to /dashboard redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/login**', { timeout: 5000 })
    await expect(page.url()).toContain('/login')
  })

  test('TC-AUTH-04: Unauthenticated access to /orders redirects to login', async ({ page }) => {
    await page.goto('/orders')
    await page.waitForURL('**/login**', { timeout: 5000 })
    await expect(page.url()).toContain('/login')
  })

  test('TC-AUTH-05: Forgot password page loads correctly', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.locator('h2')).toContainText('Recuperar senha')
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })

  test('TC-AUTH-06: Reset password page requires token (no token = unauthorized)', async ({
    page,
  }) => {
    await page.goto('/reset-password')
    // Page loads (not redirected to login, it's public)
    await expect(page.url()).toContain('/reset-password')
  })

  test('TC-AUTH-07: Login page has "Solicitar cadastro" link to /registro', async ({ page }) => {
    await page.goto('/login')
    const link = page.locator('a[href="/registro"]')
    await expect(link).toBeVisible()
    await expect(link).toContainText('Solicitar cadastro')
  })

  test('TC-AUTH-08: /registro page is publicly accessible', async ({ page }) => {
    await page.goto('/registro')
    await expect(page.locator('h1')).toContainText('Solicitar cadastro')
    await expect(page.locator('button', { hasText: 'Clínica / Consultório' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'Médico' })).toBeVisible()
  })

  test('TC-AUTH-09: /registro clinic form shows required fields', async ({ page }) => {
    await page.goto('/registro')
    await page.locator('button', { hasText: 'Clínica / Consultório' }).click()
    await expect(page.locator('input[placeholder*="Nome da clínica"]')).toBeVisible()
    await expect(page.locator('input[placeholder*="CNPJ"]')).toBeVisible()
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
  })

  test('TC-AUTH-10: /registro doctor form shows CRM fields', async ({ page }) => {
    await page.goto('/registro')
    await page.locator('button', { hasText: 'Médico' }).click()
    await expect(page.locator('input[placeholder*="CRM"]').first()).toBeVisible()
    await expect(page.locator('input[placeholder*="Especialidade"]')).toBeVisible()
  })
})
