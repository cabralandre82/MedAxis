/**
 * E2E: Forgot password flow.
 *
 * The flow under test is the *user-visible* portion of password recovery:
 *   1. User clicks "esqueci a senha" on /login.
 *   2. Lands on /forgot-password.
 *   3. Submits an email address.
 *   4. Sees a non-enumerating success message (we MUST NOT reveal whether
 *      the email is registered — that's a deliberate security property,
 *      validated below).
 *   5. The /reset-password page is reachable directly (covers the email
 *      link path) and renders without crashing.
 *
 * We do NOT exercise the actual email delivery — that would require an
 * inbox we control. Supabase Auth + the recovery-token issuance is
 * covered by Supabase's own tests; we cover the UI shell.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 05-forgot-password
 */
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Forgot password flow', () => {
  test('navigates from login to forgot-password', async ({ page }) => {
    await page.goto('/login')
    const link = page
      .getByRole('link', { name: /esqueceu|redefinir|recuperar/i })
      .or(page.locator('a[href*="forgot"], a[href*="recover"], a[href*="reset"]'))
      .first()
    await expect(link).toBeVisible({ timeout: 10_000 })
    await link.click()
    await expect(page).toHaveURL(/forgot|recover|reset|password/, { timeout: 10_000 })
  })

  test('forgot-password page renders form', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page).not.toHaveURL(/login/)
    await expect(
      page.getByRole('textbox', { name: /e?-?mail/i }).or(page.locator('input[type="email"]'))
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole('button', { name: /enviar|recuperar|redefinir|continuar/i })
    ).toBeVisible({ timeout: 10_000 })
  })

  test('submitting an unknown email shows a non-enumerating message', async ({ page }) => {
    await page.goto('/forgot-password')

    const emailInput = page
      .getByRole('textbox', { name: /e?-?mail/i })
      .or(page.locator('input[type="email"]'))
      .first()
    await emailInput.fill(`probe-${Date.now()}@example.com`)

    const submit = page
      .getByRole('button', { name: /enviar|recuperar|redefinir|continuar/i })
      .first()
    await submit.click()

    // The response is asynchronous and may render either an inline
    // success message or a redirect. Either way, the page must NOT
    // disclose whether the address exists. We accept any of:
    //   - generic success copy ("se o e-mail estiver cadastrado…")
    //   - URL change to a confirmation route
    //   - the same form re-rendered (idempotent submit)
    await page.waitForLoadState('networkidle').catch(() => {})

    const success = page
      .getByText(/se o e-?mail|verifique sua caixa|enviamos|link de recupera/i)
      .first()
    const stillOnPage = page.url().includes('forgot-password')

    if (await success.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const txt = (await success.textContent()) ?? ''
      expect(
        /n[aã]o (encontramos|existe)|inv[aá]lido|n[aã]o cadastrado/i.test(txt),
        'forgot-password must not enumerate user existence'
      ).toBe(false)
    } else {
      expect(stillOnPage || /confirma|verific|envia/i.test(page.url())).toBe(true)
    }
  })

  test('reset-password page is reachable directly (email-link path)', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page).not.toHaveURL(/^.*\/login(\?|$)/, { timeout: 10_000 })
    await expect(page.locator('body')).toBeVisible()
  })
})
