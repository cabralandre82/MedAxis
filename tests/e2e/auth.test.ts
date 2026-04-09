import { test, expect } from '@playwright/test'

const SUPER_ADMIN_EMAIL = 'superadmin@clinipharma.com.br'
const SUPER_ADMIN_PASSWORD = 'Clinipharma@2026'

test.describe('Authentication', () => {
  test('TC-01: Login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('h2')).toContainText('Acessar plataforma')

    await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
    await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/dashboard', { timeout: 10000 })
    await expect(page.url()).toContain('/dashboard')
  })

  test('TC-02: Login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'wrong@email.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 5000 })
  })

  test('TC-03: Unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/login**', { timeout: 5000 })
    await expect(page.url()).toContain('/login')
  })

  test('TC-04: Forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.locator('h2')).toContainText('Recuperar senha')
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})
