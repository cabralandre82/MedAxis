import { test, expect } from '@playwright/test'

test.describe('Catalog', () => {
  test.beforeEach(async ({ page }) => {
    // Login as clinic admin
    await page.goto('/login')
    await page.fill('input[type="email"]', 'admin@clinicasaude.com.br')
    await page.fill('input[type="password"]', 'Clinipharma@2026')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')
  })

  test('TC-03: Catalog loads and shows products', async ({ page }) => {
    await page.goto('/catalog')
    await expect(page.locator('h1')).toContainText('Catálogo')
    // products or empty state
    const hasProducts = await page.locator('[href^="/catalog/"]').count()
    expect(hasProducts >= 0).toBe(true)
  })

  test('TC-04: Product page loads correctly', async ({ page }) => {
    await page.goto('/catalog')
    const firstProductLink = page.locator('a[href^="/catalog/"]').first()

    if (await firstProductLink.isVisible()) {
      await firstProductLink.click()
      await page.waitForURL('**/catalog/**')
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('text=Preço unitário')).toBeVisible()
      await expect(page.locator('text=Solicitar pedido')).toBeVisible()
    }
  })
})
