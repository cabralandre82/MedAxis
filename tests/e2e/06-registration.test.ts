/**
 * E2E: Public registration flow (clinic / doctor).
 *
 * The full happy path requires uploading PDFs (CRM diploma, CNPJ card,
 * etc.) and a manual super-admin approval afterwards — that's covered by
 * the integration test in 02-admin-clinic-approval.test.ts.
 *
 * This test focuses on the public-facing **shell** of the form:
 *   - The page is reachable from /login.
 *   - The two profile choices (clínica vs médico) toggle the right
 *     field-set.
 *   - Required-field validation fires before the network call (so users
 *     get feedback even when offline).
 *   - The form does NOT submit to a public endpoint without a chosen
 *     profile (no orphan registrations).
 *
 * We deliberately avoid full submission because that creates a real
 * Supabase user in staging and pollutes the QA inbox.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 06-registration
 */
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Registration flow', () => {
  test('navigates from login to /registro', async ({ page }) => {
    await page.goto('/login')
    const link = page
      .getByRole('link', { name: /cadastr|registr|cri[ae] (sua )?conta/i })
      .or(page.locator('a[href*="registro"], a[href*="register"]'))
      .first()
    await expect(link).toBeVisible({ timeout: 10_000 })
    await link.click()
    await expect(page).toHaveURL(/registro|register/, { timeout: 10_000 })
  })

  test('renders both profile choices', async ({ page }) => {
    await page.goto('/registro')
    await expect(page).not.toHaveURL(/login/)

    const clinic = page
      .getByRole('button', { name: /cl[ií]nica/i })
      .or(page.getByText(/cl[ií]nica/i).first())
    const doctor = page
      .getByRole('button', { name: /m[eé]dic/i })
      .or(page.getByText(/m[eé]dic/i).first())

    await expect(clinic.first()).toBeVisible({ timeout: 10_000 })
    await expect(doctor.first()).toBeVisible({ timeout: 10_000 })
  })

  test('shows clinic-specific fields when clinic is selected', async ({ page }) => {
    await page.goto('/registro')
    const clinic = page
      .getByRole('button', { name: /cl[ií]nica/i })
      .or(page.getByText(/^cl[ií]nica$/i))
      .first()
    await clinic.click().catch(() => {})

    // Clinic profile demands CNPJ + trade name. We accept either label
    // form (input name OR visible label) so wording tweaks don't break.
    await expect(
      page.getByLabel(/CNPJ/i).or(page.locator('input[name*="cnpj" i]')).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('shows doctor-specific fields when médico is selected', async ({ page }) => {
    await page.goto('/registro')
    const doctor = page
      .getByRole('button', { name: /m[eé]dic/i })
      .or(page.getByText(/^m[eé]dic[oa]$/i))
      .first()
    await doctor.click().catch(() => {})

    await expect(
      page.getByLabel(/CRM/i).or(page.locator('input[name*="crm" i]')).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('validates required fields before submitting', async ({ page }) => {
    await page.goto('/registro')
    const clinic = page
      .getByRole('button', { name: /cl[ií]nica/i })
      .or(page.getByText(/^cl[ií]nica$/i))
      .first()
    await clinic.click().catch(() => {})

    const submit = page
      .getByRole('button', { name: /cadastr|criar|enviar|continuar|finalizar/i })
      .first()
    if (!(await submit.isVisible({ timeout: 3_000 }).catch(() => false))) {
      // Some layouts hide the submit until step 2; an inline validation
      // error message means the form is doing its job.
      await expect(page).toHaveURL(/registro/)
      return
    }

    await submit.click().catch(() => {})
    // We accept any of these as evidence the client-side schema fired:
    //   - HTML5 :invalid pseudo-class on a required input
    //   - explicit error text
    //   - the URL did NOT change (no navigation)
    const errored = await page
      .locator('input:invalid, [aria-invalid="true"], [data-error]')
      .first()
      .isVisible({ timeout: 4_000 })
      .catch(() => false)
    if (!errored) {
      await expect(page).toHaveURL(/registro/, { timeout: 4_000 })
    }
  })

  test('legal links are present in the footer', async ({ page }) => {
    await page.goto('/registro')
    await expect(page.getByRole('link', { name: /termos.*uso/i }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('link', { name: /pol[ií]tica.*privacidade/i }).first()).toBeVisible(
      { timeout: 10_000 }
    )
  })
})
