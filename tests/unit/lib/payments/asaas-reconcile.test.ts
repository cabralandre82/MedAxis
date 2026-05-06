/**
 * Pre-Launch Onda S1 / F5 — Asaas reconcile cron.
 *
 * Validates the seven behaviours `reconcileAsaasPayments` must
 * exhibit so a missed webhook never silently leaves a paid order
 * stuck in `AWAITING_PAYMENT`:
 *
 *   1. classifyAsaasStatus — every documented Asaas status maps
 *      to the right reconcile bucket (no surprise lost charges).
 *   2. Empty queue — early return without calling the gateway.
 *   3. Asaas says CONFIRMED → reconciled, ledger advanced via the
 *      F1 helper (we mock its outcome).
 *   4. Asaas says PENDING → silent skip, no advance.
 *   5. Asaas says OVERDUE/CANCELLED → gateway_lost, no advance.
 *   6. Asaas getPayment throws → error_gateway_unavailable, loop
 *      keeps going for siblings.
 *   7. confirmPaymentViaAsaasWebhook throws → error_local_advance.
 *      A WebhookLedgerError surface gets surfaced verbatim.
 *
 * The reconcile path explicitly REUSES the F1 helper. We mock
 * `confirmPaymentViaAsaasWebhook` rather than re-testing its own
 * idempotency — that contract is covered by
 * `confirm-via-webhook.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── mocks ────────────────────────────────────────────────────────────────

const mockLimit = vi.fn()
const mockOrder = vi.fn()
const mockGte = vi.fn()
const mockNot = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

vi.mock('@/lib/asaas', () => ({
  getPayment: vi.fn(),
}))

vi.mock('@/lib/payments/confirm-via-webhook', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/confirm-via-webhook')>(
    '@/lib/payments/confirm-via-webhook'
  )
  return {
    ...actual,
    confirmPaymentViaAsaasWebhook: vi.fn(),
  }
})

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
  setGauge: vi.fn(),
  Metrics: {
    ASAAS_RECONCILE_TOTAL: 'asaas_reconcile_total',
    ASAAS_RECONCILE_RECOVERED_TOTAL: 'asaas_reconcile_recovered_total',
    ASAAS_RECONCILE_DURATION_MS: 'asaas_reconcile_duration_ms',
    ASAAS_RECONCILE_LAST_RUN_TS: 'asaas_reconcile_last_run_ts',
  },
}))

import { reconcileAsaasPayments, classifyAsaasStatus } from '@/lib/payments/asaas-reconcile'
import { getPayment } from '@/lib/asaas'
import {
  confirmPaymentViaAsaasWebhook,
  WebhookLedgerError,
} from '@/lib/payments/confirm-via-webhook'
import { incCounter } from '@/lib/metrics'

interface PaymentRow {
  id: string
  order_id: string
  asaas_payment_id: string | null
  created_at: string
}

// Wire the chained Supabase query builder for the payments table.
// SUT chain:
//   from('payments')
//     .select(cols)
//     .eq('status', 'PENDING')
//     .not('asaas_payment_id', 'is', null)
//     .gte('created_at', cutoff)
//     .order('created_at', { ascending: true })
//     .limit(limit)
function setupPaymentsQuery(rows: PaymentRow[] | null, fetchError?: { message: string }) {
  mockLimit.mockResolvedValue({ data: rows, error: fetchError ?? null })
  mockOrder.mockReturnValue({ limit: mockLimit })
  mockGte.mockReturnValue({ order: mockOrder })
  mockNot.mockReturnValue({ gte: mockGte })
  mockEq.mockReturnValue({ not: mockNot })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

beforeEach(() => {
  mockLimit.mockReset()
  mockOrder.mockReset()
  mockGte.mockReset()
  mockNot.mockReset()
  mockEq.mockReset()
  mockSelect.mockReset()
  mockFrom.mockReset()
  vi.mocked(getPayment).mockReset()
  vi.mocked(confirmPaymentViaAsaasWebhook).mockReset()
  vi.mocked(incCounter).mockClear()
})

// ── classifyAsaasStatus ──────────────────────────────────────────────────

describe('classifyAsaasStatus', () => {
  it.each([
    ['CONFIRMED', 'confirmed_in_gateway'],
    ['RECEIVED', 'confirmed_in_gateway'],
    ['RECEIVED_IN_CASH', 'confirmed_in_gateway'],
  ])('classifies %s as confirmed_in_gateway', (status, klass) => {
    expect(classifyAsaasStatus(status)).toBe(klass)
  })

  it.each([
    ['PENDING', 'still_pending'],
    ['AWAITING_RISK_ANALYSIS', 'still_pending'],
    ['APPROVED_BY_RISK_ANALYSIS', 'still_pending'],
    ['AUTHORIZED', 'still_pending'],
  ])('classifies %s as still_pending', (status, klass) => {
    expect(classifyAsaasStatus(status)).toBe(klass)
  })

  it.each([
    ['OVERDUE', 'gateway_lost'],
    ['CANCELLED', 'gateway_lost'],
    ['AWAITING_CANCELLATION', 'gateway_lost'],
    ['REFUNDED', 'gateway_lost'],
    ['REFUND_REQUESTED', 'gateway_lost'],
    ['REFUND_IN_PROGRESS', 'gateway_lost'],
    ['CHARGEBACK_REQUESTED', 'gateway_lost'],
    ['CHARGEBACK_DISPUTE', 'gateway_lost'],
    ['AWAITING_CHARGEBACK_REVERSAL', 'gateway_lost'],
  ])('classifies %s as gateway_lost', (status, klass) => {
    expect(classifyAsaasStatus(status)).toBe(klass)
  })

  it('returns unknown for novel statuses', () => {
    expect(classifyAsaasStatus('SOMETHING_NEW_FROM_ASAAS')).toBe('unknown')
  })
})

// ── reconcileAsaasPayments ───────────────────────────────────────────────

describe('reconcileAsaasPayments — empty queue', () => {
  it('returns zero counts and skips the gateway when no PENDING rows', async () => {
    setupPaymentsQuery([])
    const out = await reconcileAsaasPayments()

    expect(out).toEqual({
      scanned: 0,
      reconciled: 0,
      gatewayPending: 0,
      gatewayLost: 0,
      errors: 0,
      items: [],
    })
    expect(getPayment).not.toHaveBeenCalled()
    expect(confirmPaymentViaAsaasWebhook).not.toHaveBeenCalled()
  })

  it('throws when the underlying query fails', async () => {
    setupPaymentsQuery(null, { message: 'connection refused' })
    await expect(reconcileAsaasPayments()).rejects.toThrow(/payments fetch failed/)
  })
})

describe('reconcileAsaasPayments — happy paths', () => {
  it('reconciles when Asaas returns CONFIRMED', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'CONFIRMED',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
      billingType: 'PIX',
    })
    vi.mocked(confirmPaymentViaAsaasWebhook).mockResolvedValue({
      action: 'confirmed',
      paymentId: 'pay-1',
    })

    const out = await reconcileAsaasPayments()

    expect(out.scanned).toBe(1)
    expect(out.reconciled).toBe(1)
    expect(out.gatewayPending).toBe(0)
    expect(out.gatewayLost).toBe(0)
    expect(out.errors).toBe(0)
    expect(out.items[0]).toMatchObject({
      paymentId: 'pay-1',
      outcome: 'reconciled',
      asaasStatus: 'CONFIRMED',
    })
    expect(confirmPaymentViaAsaasWebhook).toHaveBeenCalledWith({
      orderId: 'ord-1',
      asaasEvent: 'PAYMENT_RECONCILED',
      asaasPaymentId: 'asaas-1',
      billingType: 'PIX',
    })
  })

  it('also reconciles when Asaas returns RECEIVED', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'RECEIVED',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })
    vi.mocked(confirmPaymentViaAsaasWebhook).mockResolvedValue({
      action: 'confirmed',
      paymentId: 'pay-1',
    })

    const out = await reconcileAsaasPayments()

    expect(out.reconciled).toBe(1)
  })

  it('still_pending when Asaas says PENDING — no advance', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'PENDING',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })

    const out = await reconcileAsaasPayments()

    expect(out.gatewayPending).toBe(1)
    expect(out.reconciled).toBe(0)
    expect(confirmPaymentViaAsaasWebhook).not.toHaveBeenCalled()
  })

  it('gateway_lost when Asaas says OVERDUE — no advance', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'OVERDUE',
      invoiceUrl: 'https://x',
      dueDate: '2026-04-30',
      value: 100,
    })

    const out = await reconcileAsaasPayments()

    expect(out.gatewayLost).toBe(1)
    expect(out.reconciled).toBe(0)
    expect(confirmPaymentViaAsaasWebhook).not.toHaveBeenCalled()
  })
})

describe('reconcileAsaasPayments — error handling', () => {
  it('counts gateway error and continues to next payment', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
      {
        id: 'pay-2',
        order_id: 'ord-2',
        asaas_payment_id: 'asaas-2',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({
      id: 'asaas-2',
      status: 'CONFIRMED',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })
    vi.mocked(confirmPaymentViaAsaasWebhook).mockResolvedValue({
      action: 'confirmed',
      paymentId: 'pay-2',
    })

    const out = await reconcileAsaasPayments()

    expect(out.scanned).toBe(2)
    expect(out.errors).toBe(1)
    expect(out.reconciled).toBe(1)
    expect(out.items[0].outcome).toBe('error_gateway_unavailable')
    expect(out.items[1].outcome).toBe('reconciled')
  })

  it('counts error_local_advance when confirm-via-webhook throws', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'CONFIRMED',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })
    vi.mocked(confirmPaymentViaAsaasWebhook).mockRejectedValue(
      new WebhookLedgerError('error_rpc_failed', 'rpc returned -1')
    )

    const out = await reconcileAsaasPayments()

    expect(out.errors).toBe(1)
    expect(out.reconciled).toBe(0)
    expect(out.items[0].outcome).toBe('error_local_advance')
    expect(out.items[0].detail).toContain('error_rpc_failed')
  })

  it('treats unknown Asaas status as still_pending (conservative)', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'BRAND_NEW_STATUS_FROM_ASAAS',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })

    const out = await reconcileAsaasPayments()

    expect(out.gatewayPending).toBe(1)
    expect(out.gatewayLost).toBe(0)
    expect(confirmPaymentViaAsaasWebhook).not.toHaveBeenCalled()
  })

  it('skips payments where confirm-via-webhook returns action=skipped', async () => {
    setupPaymentsQuery([
      {
        id: 'pay-1',
        order_id: 'ord-1',
        asaas_payment_id: 'asaas-1',
        created_at: new Date().toISOString(),
      },
    ])
    vi.mocked(getPayment).mockResolvedValue({
      id: 'asaas-1',
      status: 'CONFIRMED',
      invoiceUrl: 'https://x',
      dueDate: '2026-05-10',
      value: 100,
    })
    vi.mocked(confirmPaymentViaAsaasWebhook).mockResolvedValue({
      action: 'skipped',
      reason: 'no_pending_payment',
    })

    const out = await reconcileAsaasPayments()

    expect(out.reconciled).toBe(0)
    expect(out.gatewayPending).toBe(1)
    expect(out.items[0].detail).toContain('no_pending_payment')
  })
})
