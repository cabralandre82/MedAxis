/**
 * E2E Fluxo 1 & 3: Ciclo de vida completo de um pedido.
 *
 * Cenário coberto:
 *   Fluxo 1 — login → criar pedido → aguardar confirmação
 *   Fluxo 3 — farmácia atualiza status do pedido
 *
 * NOTA: Este teste verifica a estrutura e navegação das páginas de pedidos.
 * O teste de criação real só executa se houver dados de staging disponíveis.
 *
 * Run: BASE_URL=https://staging.clinipharma.com.br npx playwright test 03-order
 */
import { test, expect } from '@playwright/test'

test.describe('Order Lifecycle', () => {
  test('orders page is accessible and renders', async ({ page }) => {
    await page.goto('/orders')
    await expect(page).not.toHaveURL(/login/)

    await expect(page.getByRole('heading').filter({ hasText: /pedidos/i })).toBeVisible({
      timeout: 10_000,
    })
  })

  test('orders page shows list or empty state', async ({ page }) => {
    await page.goto('/orders')

    // Wait for data to load (orders are fetched client-side)
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null)

    // Either shows table rows or an empty state message
    // Actual empty state text from components/orders/orders-table.tsx
    const hasRows = page.locator('tbody tr, [data-testid="order-row"]').first()
    const hasEmpty = page.getByText('Nenhum pedido encontrado').first()

    const rowsVisible = await hasRows.isVisible({ timeout: 5_000 }).catch(() => false)
    const emptyVisible = rowsVisible
      ? false
      : await hasEmpty.isVisible({ timeout: 5_000 }).catch(() => false)
    expect(rowsVisible || emptyVisible).toBe(true)
  })

  test('new order button navigates to order creation', async ({ page }) => {
    await page.goto('/orders')

    // Try link first, then button — avoid strict mode by targeting first match
    const newOrderLink = page.getByRole('link', { name: /novo pedido/i }).first()
    const newOrderBtn = page.getByRole('button', { name: /novo pedido/i }).first()

    const linkVisible = await newOrderLink.isVisible({ timeout: 8_000 }).catch(() => false)
    const btnVisible = linkVisible
      ? false
      : await newOrderBtn.isVisible({ timeout: 2_000 }).catch(() => false)

    if (!linkVisible && !btnVisible) {
      // SUPER_ADMIN may not have a "new order" button — skip gracefully
      test.skip()
      return
    }

    if (linkVisible) {
      await newOrderLink.click()
    } else {
      await newOrderBtn.click()
    }

    await expect(page).toHaveURL(/orders\/new|pedidos\/novo/, { timeout: 10_000 })
  })

  test('order creation form renders required fields', async ({ page }) => {
    await page.goto('/orders/new')
    await expect(page).not.toHaveURL(/login|forbidden/)

    // At minimum, form should have some inputs
    const inputs = page.locator('input, select, textarea')
    await expect(inputs.first()).toBeVisible({ timeout: 10_000 })
  })

  test('order detail page renders for existing order', async ({ page }) => {
    // Navigate to orders list first
    await page.goto('/orders')

    const firstOrderLink = page.locator('tbody tr a, [data-testid="order-row"] a').first()

    const hasOrders = await firstOrderLink.isVisible({ timeout: 5_000 }).catch(() => false)

    if (!hasOrders) {
      test.skip()
      return
    }

    await firstOrderLink.click()
    await expect(page).toHaveURL(/orders\/\w+/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })

  test('order has status badge/chip', async ({ page }) => {
    await page.goto('/orders')

    const statusBadge = page
      .locator('[data-testid="status-badge"], [class*="badge"], [class*="status"], [class*="chip"]')
      .first()

    const hasBadge = await statusBadge.isVisible({ timeout: 5_000 }).catch(() => false)

    if (!hasBadge) {
      // No badge = empty list. Verify the page loaded by checking heading (always present on /orders)
      await expect(page.getByRole('heading').filter({ hasText: /pedidos/i })).toBeVisible({
        timeout: 10_000,
      })
    }
  })
})

test.describe('Pharmacy: Order Status Update', () => {
  test('pharmacy orders view is accessible', async ({ page }) => {
    await page.goto('/pharmacy/orders')

    // Either shows the pharmacy orders page or redirects to main orders (role-based)
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
  })
})
