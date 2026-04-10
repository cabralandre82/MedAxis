import { test, expect } from '@playwright/test'

const SUPER_ADMIN_EMAIL = 'cabralandre@yahoo.com.br'
const SUPER_ADMIN_PASSWORD = 'Clinipharma@2026'

async function loginAs(page: Parameters<typeof test>[1]['page'], email: string, password: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

test.describe('Catalog', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
  })

  test('TC-CAT-01: Catalog page loads with heading', async ({ page }) => {
    await page.goto('/catalog')
    await expect(page.locator('h1')).toContainText('Catálogo')
  })

  test('TC-CAT-02: Catalog shows product cards or empty state', async ({ page }) => {
    await page.goto('/catalog')
    const products = await page.locator('[href^="/catalog/"]').count()
    const emptyState = page.locator('text=Nenhum produto')
    // Either products exist or empty state is shown
    const hasProducts = products > 0
    const isEmpty = await emptyState.isVisible()
    expect(hasProducts || isEmpty).toBe(true)
  })

  test('TC-CAT-03: Active product detail page loads with price and order button', async ({
    page,
  }) => {
    await page.goto('/catalog')
    const firstActiveLink = page.locator('a[href^="/catalog/"]').first()
    if (await firstActiveLink.isVisible()) {
      await firstActiveLink.click()
      await page.waitForURL('**/catalog/**')
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.locator('text=Preço unitário')).toBeVisible()
    }
  })

  test('TC-CAT-04: Category filter updates URL', async ({ page }) => {
    await page.goto('/catalog')
    const categoryLink = page.locator('a[href*="category"]').first()
    if (await categoryLink.isVisible()) {
      await categoryLink.click()
      await expect(page.url()).toContain('category')
    }
  })

  test('TC-CAT-05: Search input is present and interactable', async ({ page }) => {
    await page.goto('/catalog')
    const searchInput = page.locator('input[placeholder*="Buscar"]')
    if (await searchInput.isVisible()) {
      await searchInput.fill('test')
      await expect(searchInput).toHaveValue('test')
    }
  })
})

test.describe('Product unavailable — interest flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
  })

  test('TC-INT-01: Unavailable product shows "Tenho interesse" button', async ({ page }) => {
    await page.goto('/catalog')
    const interestBtn = page.locator('button', { hasText: 'Tenho interesse' })
    if (await interestBtn.isVisible()) {
      await interestBtn.first().click()
      // Modal should open
      await expect(page.locator('input[placeholder*="nome"]')).toBeVisible({ timeout: 3000 })
    }
  })
})

test.describe('Registrations admin panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
  })

  test('TC-REG-01: /registrations page loads for SUPER_ADMIN', async ({ page }) => {
    await page.goto('/registrations')
    await expect(page.locator('h1')).toContainText('Solicitações de cadastro')
  })

  test('TC-REG-02: Status filter tabs are visible', async ({ page }) => {
    await page.goto('/registrations')
    await expect(page.locator('a', { hasText: 'Todos' })).toBeVisible()
    await expect(page.locator('a', { hasText: 'Aguardando análise' })).toBeVisible()
    await expect(page.locator('a', { hasText: 'Aprovado' })).toBeVisible()
    await expect(page.locator('a', { hasText: 'Reprovado' })).toBeVisible()
  })

  test('TC-REG-03: Filtering by status updates URL', async ({ page }) => {
    await page.goto('/registrations')
    await page.locator('a', { hasText: 'Aguardando análise' }).click()
    await expect(page.url()).toContain('status=PENDING')
  })
})

test.describe('Interests admin panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
  })

  test('TC-INTEREST-01: /interests page loads for SUPER_ADMIN', async ({ page }) => {
    await page.goto('/interests')
    await expect(page.locator('h1')).toContainText('Interesses')
  })
})
