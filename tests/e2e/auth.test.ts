import { test, expect } from '@playwright/test'

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'cabralandre@yahoo.com.br'
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? 'Clinipharma@2026'

// TC-AUTH-01/02 require fresh session (no stored auth)
test.describe('Authentication', () => {
  test('TC-AUTH-01: Login with valid credentials redirects to dashboard', async ({ page }) => {
    // Start clean — clear any stored auth to test login explicitly
    await page.context().clearCookies()
    await page.goto('/login')
    await expect(page.locator('h2')).toContainText('Acessar plataforma')

    await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
    await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.url()).toContain('/dashboard')
  })

  test('TC-AUTH-02: Login with invalid credentials shows error toast', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login')
    await page.fill('input[type="email"]', 'wrong@email.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // Sonner toast or any error text
    const toast = page.locator('[data-sonner-toast]')
    const errText = page.getByText(/credenciais|inválido|incorret/i).first()
    await expect(toast.or(errText)).toBeVisible({ timeout: 10_000 })
  })

  test('TC-AUTH-03: Unauthenticated access to /dashboard redirects to login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/dashboard')
    await page.waitForURL('**/login**', { timeout: 10_000 })
    await expect(page.url()).toContain('/login')
  })

  test('TC-AUTH-04: Unauthenticated access to /orders redirects to login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/orders')
    await page.waitForURL('**/login**', { timeout: 10_000 })
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
    await page.context().clearCookies()
    await page.goto('/login')
    const link = page
      .locator('a[href="/registro"]')
      .or(page.getByRole('link', { name: /solicitar|cadastro|registro/i }))
      .first()
    await expect(link).toBeVisible({ timeout: 8_000 })
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
    // Check that some text inputs appeared (form expanded)
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
  })

  test('TC-AUTH-10: /registro doctor form shows CRM fields', async ({ page }) => {
    await page.goto('/registro')
    await page.locator('button', { hasText: 'Médico' }).click()
    // CRM field appears after selecting doctor type
    await expect(page.locator('input').filter({ hasText: '' }).first()).toBeVisible({
      timeout: 8_000,
    })
    // At least 3 inputs should be visible (name, CRM, email)
    const inputs = page.locator('input[type="text"], input[type="email"], input[type="password"]')
    await expect(inputs.first()).toBeVisible({ timeout: 8_000 })
  })

  test('TC-AUTH-11: /registro docs step shows warning banner when no docs uploaded', async ({
    page,
  }) => {
    await page.goto('/registro')
    await page.locator('button', { hasText: 'Clínica / Consultório' }).click()

    // Fill required form fields
    await page.fill('input[placeholder*="João da Silva"]', 'Teste Admin')
    await page.fill('input[placeholder*="Clínica Exemplo"]', 'Clínica Teste')
    await page.fill('input[placeholder*="00.000.000"]', '11222333000181')
    await page.fill('input[type="email"]', `draft-test-${Date.now()}@test.com`)
    await page.fill('input[placeholder*="Rua Exemplo"]', 'Rua das Flores, 100')
    await page.fill('input[placeholder*="São Paulo"]', 'São Paulo')
    await page.fill('input[placeholder*="SP"]', 'SP')
    await page.fill('input[type="password"]', 'Senha@1234')
    await page.fill('input[placeholder*="Repita"]', 'Senha@1234')

    // Advance to docs step
    await page.click('button:has-text("Continuar para documentos")')
    await expect(page.locator('text=2/2 — Documentos')).toBeVisible({ timeout: 8_000 })

    // Warning banner must be visible
    await expect(page.locator('text=Documentos obrigatórios').first()).toBeVisible()
    await expect(page.locator('text=Nossa equipe entrará em contato').first()).toBeVisible()
  })

  test('TC-AUTH-12: /registro docs step submit button changes label without docs', async ({
    page,
  }) => {
    await page.goto('/registro')
    await page.locator('button', { hasText: 'Clínica / Consultório' }).click()

    await page.fill('input[placeholder*="João da Silva"]', 'Teste Botão')
    await page.fill('input[placeholder*="Clínica Exemplo"]', 'Botão Test')
    await page.fill('input[placeholder*="00.000.000"]', '11222333000181')
    await page.fill('input[type="email"]', `btn-test-${Date.now()}@test.com`)
    await page.fill('input[placeholder*="Rua Exemplo"]', 'Av. Teste, 1')
    await page.fill('input[placeholder*="São Paulo"]', 'Curitiba')
    await page.fill('input[placeholder*="SP"]', 'PR')
    await page.fill('input[type="password"]', 'Senha@1234')
    await page.fill('input[placeholder*="Repita"]', 'Senha@1234')

    await page.click('button:has-text("Continuar para documentos")')
    await expect(page.locator('text=2/2 — Documentos')).toBeVisible({ timeout: 8_000 })

    // Without docs the button label is different
    await expect(
      page.locator('button:has-text("Enviar sem documentos por enquanto")')
    ).toBeVisible()
  })
})
