/**
 * Pre-Launch Onda S1 / F1 — Asaas webhook ledger confirmation.
 *
 * Validates the four behaviours `confirmPaymentViaAsaasWebhook` must
 * exhibit so a real Asaas PIX/cartão never silently bypasses the
 * commissions / transfers / consultant_commissions ledger:
 *
 *   1. Happy path — PENDING payment exists, RPC succeeds → action=confirmed
 *   2. All payments already processed — no PENDING exists → action=skipped
 *   3. RPC race against manual path → action=skipped (already_processed)
 *   4. No payment row exists at all → throws WebhookLedgerError
 *
 * The guard against "no payment row" matters because Asaas can fire a
 * webhook for an order whose local `payments` row failed to persist
 * (checkout race / external orphan). Throwing forces Inngest's retry
 * policy and surfaces the alarm — the operator then runs F5 reconcile
 * or confirms manually. We do NOT want the order silently advancing
 * to RELEASED_FOR_EXECUTION without a ledger entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── mocks ────────────────────────────────────────────────────────────────

const mockSelect = vi.fn()
const mockOrder = vi.fn()
const mockEq = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

vi.mock('@/lib/services/atomic.server', () => ({
  confirmPaymentAtomic: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/metrics', () => ({
  incCounter: vi.fn(),
  observeHistogram: vi.fn(),
  Metrics: {
    WEBHOOK_LEDGER_TOTAL: 'webhook_ledger_total',
    WEBHOOK_LEDGER_DURATION_MS: 'webhook_ledger_duration_ms',
  },
}))

import {
  confirmPaymentViaAsaasWebhook,
  WebhookLedgerError,
  mapAsaasBillingTypeToPaymentMethod,
} from '@/lib/payments/confirm-via-webhook'
import { confirmPaymentAtomic } from '@/lib/services/atomic.server'
import { incCounter } from '@/lib/metrics'

// Helper to wire the chained Supabase query builder used by the SUT.
// SUT calls: from('payments').select(...).eq('order_id', x).order('created_at', ...)
function setupPaymentsQuery(
  payments: Array<Record<string, unknown>> | null,
  fetchError?: { message: string }
) {
  mockOrder.mockResolvedValue({
    data: payments,
    error: fetchError ?? null,
  })
  mockEq.mockReturnValue({ order: mockOrder })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

beforeEach(() => {
  mockSelect.mockReset()
  mockOrder.mockReset()
  mockEq.mockReset()
  mockFrom.mockReset()
  vi.mocked(confirmPaymentAtomic).mockReset()
  vi.mocked(incCounter).mockClear()
})

// ── mapAsaasBillingTypeToPaymentMethod ───────────────────────────────────

describe('mapAsaasBillingTypeToPaymentMethod', () => {
  it.each([
    ['PIX', 'PIX'],
    ['CREDIT_CARD', 'CREDIT_CARD'],
    ['DEBIT_CARD', 'DEBIT_CARD'],
    ['BOLETO', 'BOLETO'],
    ['TRANSFER', 'TRANSFER'],
  ])('maps %s to %s', (asaas, internal) => {
    expect(mapAsaasBillingTypeToPaymentMethod(asaas)).toBe(internal)
  })

  it.each([[undefined], [null], [''], ['UNDEFINED'], ['SOMETHING_WEIRD']])(
    'falls back to ASAAS for %s',
    (input) => {
      expect(mapAsaasBillingTypeToPaymentMethod(input as string | undefined | null)).toBe('ASAAS')
    }
  )
})

// ── confirmPaymentViaAsaasWebhook ────────────────────────────────────────

describe('confirmPaymentViaAsaasWebhook', () => {
  const baseInput = {
    orderId: 'order-uuid-abc',
    asaasEvent: 'PAYMENT_CONFIRMED',
    asaasPaymentId: 'pay_asaas_123',
    billingType: 'PIX',
  }

  it('confirms ledger when a PENDING payment exists and RPC succeeds', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-1', status: 'PENDING', lock_version: 0 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      data: {
        payment_id: 'pay-uuid-1',
        order_id: 'order-uuid-abc',
        pharmacy_transfer: 100,
        platform_commission: 80,
        consultant_commission: 5,
        consultant_capped: false,
        new_lock_version: 1,
      },
    })

    const result = await confirmPaymentViaAsaasWebhook(baseInput)

    expect(result).toEqual({
      ok: true,
      action: 'confirmed',
      paymentId: 'pay-uuid-1',
      paymentMethod: 'PIX',
    })
    expect(confirmPaymentAtomic).toHaveBeenCalledWith(
      'pay-uuid-1',
      expect.objectContaining({
        paymentMethod: 'PIX',
        referenceCode: 'pay_asaas_123',
        confirmedByUserId: '00000000-0000-0000-0000-000000000000',
        expectedLockVersion: 0,
      })
    )
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', { outcome: 'confirmed' })
  })

  it('passes lock_version through to the RPC for optimistic locking', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-2', status: 'PENDING', lock_version: 7 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      data: {
        payment_id: 'pay-uuid-2',
        order_id: baseInput.orderId,
        pharmacy_transfer: 0,
        platform_commission: 0,
        consultant_commission: null,
        consultant_capped: false,
        new_lock_version: 8,
      },
    })

    await confirmPaymentViaAsaasWebhook(baseInput)

    expect(confirmPaymentAtomic).toHaveBeenCalledWith(
      'pay-uuid-2',
      expect.objectContaining({ expectedLockVersion: 7 })
    )
  })

  it('skips silently when all payments are already processed (no PENDING)', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-3', status: 'CONFIRMED', lock_version: 2 }])

    const result = await confirmPaymentViaAsaasWebhook(baseInput)

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'all_payments_processed',
    })
    expect(confirmPaymentAtomic).not.toHaveBeenCalled()
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', {
      outcome: 'skipped_all_processed',
    })
  })

  it('skips when the RPC reports already_processed (race against manual path)', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-4', status: 'PENDING', lock_version: 0 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      error: { reason: 'already_processed' },
    })

    const result = await confirmPaymentViaAsaasWebhook(baseInput)

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'rpc_already_processed',
    })
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', {
      outcome: 'skipped_already_processed',
    })
  })

  it('skips when the RPC reports stale_version (concurrent update)', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-5', status: 'PENDING', lock_version: 0 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      error: { reason: 'stale_version' },
    })

    const result = await confirmPaymentViaAsaasWebhook(baseInput)

    expect(result).toEqual({
      ok: true,
      action: 'skipped',
      reason: 'rpc_stale_version',
    })
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', {
      outcome: 'skipped_stale_version',
    })
  })

  it('throws WebhookLedgerError when no payment row exists for the order', async () => {
    setupPaymentsQuery([])

    await expect(confirmPaymentViaAsaasWebhook(baseInput)).rejects.toMatchObject({
      name: 'WebhookLedgerError',
      code: 'no_payment_row',
      orderId: 'order-uuid-abc',
    })
    expect(confirmPaymentAtomic).not.toHaveBeenCalled()
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', { outcome: 'error_no_payment' })
  })

  it('throws WebhookLedgerError when the payments fetch itself errors', async () => {
    setupPaymentsQuery(null, { message: 'connection refused' })

    await expect(confirmPaymentViaAsaasWebhook(baseInput)).rejects.toMatchObject({
      name: 'WebhookLedgerError',
      code: 'fetch_failed',
    })
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', {
      outcome: 'error_fetch_failed',
    })
  })

  it('throws WebhookLedgerError on unexpected RPC failures (not a known race)', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-6', status: 'PENDING', lock_version: 0 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      error: { reason: 'rpc_unavailable' },
    })

    await expect(confirmPaymentViaAsaasWebhook(baseInput)).rejects.toBeInstanceOf(
      WebhookLedgerError
    )
    await expect(confirmPaymentViaAsaasWebhook(baseInput)).rejects.toMatchObject({
      code: 'rpc_failed',
    })
    expect(incCounter).toHaveBeenCalledWith('webhook_ledger_total', { outcome: 'error_rpc_failed' })
  })

  it('uses the most recent (DESC ordered) payment when multiple exist and one is PENDING', async () => {
    // The query orders by created_at DESC. The .find(p => p.status==='PENDING')
    // picks the first PENDING in iteration order — which is the most recent.
    setupPaymentsQuery([
      { id: 'pay-uuid-newest-pending', status: 'PENDING', lock_version: 0 },
      { id: 'pay-uuid-old-confirmed', status: 'CONFIRMED', lock_version: 3 },
    ])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      data: {
        payment_id: 'pay-uuid-newest-pending',
        order_id: baseInput.orderId,
        pharmacy_transfer: 50,
        platform_commission: 30,
        consultant_commission: null,
        consultant_capped: false,
        new_lock_version: 1,
      },
    })

    const result = await confirmPaymentViaAsaasWebhook(baseInput)

    expect(result).toMatchObject({
      action: 'confirmed',
      paymentId: 'pay-uuid-newest-pending',
    })
  })

  it('falls back to ASAAS payment_method when billingType is missing from the event', async () => {
    setupPaymentsQuery([{ id: 'pay-uuid-7', status: 'PENDING', lock_version: 0 }])
    vi.mocked(confirmPaymentAtomic).mockResolvedValue({
      data: {
        payment_id: 'pay-uuid-7',
        order_id: baseInput.orderId,
        pharmacy_transfer: 0,
        platform_commission: 0,
        consultant_commission: null,
        consultant_capped: false,
        new_lock_version: 1,
      },
    })

    const result = await confirmPaymentViaAsaasWebhook({
      ...baseInput,
      billingType: undefined,
    })

    expect(result).toMatchObject({ action: 'confirmed', paymentMethod: 'ASAAS' })
    expect(confirmPaymentAtomic).toHaveBeenCalledWith(
      'pay-uuid-7',
      expect.objectContaining({ paymentMethod: 'ASAAS' })
    )
  })
})
