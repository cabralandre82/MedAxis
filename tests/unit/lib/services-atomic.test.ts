import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── mocks ────────────────────────────────────────────────────────────────

const mockRpc = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
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
    ATOMIC_RPC_TOTAL: 'atomic_rpc_total',
    ATOMIC_RPC_DURATION_MS: 'atomic_rpc_duration_ms',
    ATOMIC_RPC_FALLBACK_TOTAL: 'atomic_rpc_fallback_total',
  },
}))

import {
  applyCouponAtomic,
  confirmPaymentAtomic,
  createOrderAtomic,
  shouldUseAtomicRpc,
  recordAtomicFallback,
  _internal,
} from '@/lib/services/atomic.server'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter, observeHistogram } from '@/lib/metrics'

beforeEach(() => {
  mockRpc.mockReset()
  vi.mocked(isFeatureEnabled).mockReset()
  vi.mocked(incCounter).mockClear()
  vi.mocked(observeHistogram).mockClear()
})

// ── shouldUseAtomicRpc ───────────────────────────────────────────────────

describe('shouldUseAtomicRpc', () => {
  it('returns true when feature flag is enabled for the mapped key', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    await expect(shouldUseAtomicRpc('order', { userId: 'u1' })).resolves.toBe(true)
    expect(isFeatureEnabled).toHaveBeenCalledWith('orders.atomic_rpc', { userId: 'u1' })
  })

  it('maps each flow to the correct flag key', () => {
    expect(_internal.FLAG_BY_FLOW.order).toBe('orders.atomic_rpc')
    expect(_internal.FLAG_BY_FLOW.coupon).toBe('coupons.atomic_rpc')
    expect(_internal.FLAG_BY_FLOW.payment).toBe('payments.atomic_confirm')
  })

  it('falls back to false (legacy path) when flag lookup throws', async () => {
    vi.mocked(isFeatureEnabled).mockRejectedValue(new Error('boom'))
    await expect(shouldUseAtomicRpc('coupon')).resolves.toBe(false)
  })
})

// ── reason extraction ────────────────────────────────────────────────────

describe('mapPostgresError', () => {
  const { mapPostgresError } = _internal

  it.each([
    ['already_activated (SQLSTATE P0001)', 'already_activated'],
    ['RAISE: not_found_or_forbidden', 'not_found_or_forbidden'],
    ['stale_version at line 42', 'stale_version'],
    ['something: already_processed', 'already_processed'],
    ['order_not_found', 'order_not_found'],
    ['empty_items', 'empty_items'],
    ['missing_pharmacy', 'missing_pharmacy'],
    ['invalid_buyer_type', 'invalid_buyer_type'],
    ['connection lost', 'rpc_unavailable'],
    [null, 'rpc_unavailable'],
    ['', 'rpc_unavailable'],
  ])('maps %j → %s', (msg, expected) => {
    expect(mapPostgresError(msg as string | null)).toBe(expected)
  })
})

// ── applyCouponAtomic ────────────────────────────────────────────────────

describe('applyCouponAtomic', () => {
  it('returns the activated coupon when RPC succeeds', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'cid-1',
        code: 'ABC-123',
        activated_at: '2026-01-01T00:00:00Z',
        clinic_id: 'clinic-1',
        doctor_id: null,
        product_id: 'prod-1',
      },
      error: null,
    })

    const res = await applyCouponAtomic('ABC-123', 'user-1')

    expect(res.error).toBeUndefined()
    expect(res.data).toEqual({
      coupon_id: 'cid-1',
      code: 'ABC-123',
      activated_at: '2026-01-01T00:00:00Z',
      clinic_id: 'clinic-1',
      doctor_id: null,
      product_id: 'prod-1',
    })
    expect(mockRpc).toHaveBeenCalledWith('apply_coupon_atomic', {
      p_code: 'ABC-123',
      p_user_id: 'user-1',
    })
    expect(incCounter).toHaveBeenCalledWith(
      'atomic_rpc_total',
      expect.objectContaining({ flow: 'coupon', outcome: 'success' })
    )
    expect(observeHistogram).toHaveBeenCalledWith(
      'atomic_rpc_duration_ms',
      expect.any(Number),
      expect.objectContaining({ flow: 'coupon' })
    )
  })

  it('translates already_activated raise into AtomicError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'already_activated (SQLSTATE P0001)' },
    })

    const res = await applyCouponAtomic('ABC-123', 'user-1')

    expect(res.data).toBeUndefined()
    expect(res.error?.reason).toBe('already_activated')
    expect(incCounter).toHaveBeenCalledWith(
      'atomic_rpc_total',
      expect.objectContaining({ flow: 'coupon', outcome: 'already_activated' })
    )
  })

  it('reports rpc_unavailable when the RPC throws', async () => {
    mockRpc.mockRejectedValue(new Error('ECONNRESET'))
    const res = await applyCouponAtomic('ABC', 'u')
    expect(res.error?.reason).toBe('rpc_unavailable')
    expect(incCounter).toHaveBeenCalledWith(
      'atomic_rpc_total',
      expect.objectContaining({ flow: 'coupon', outcome: 'exception' })
    )
  })
})

// ── confirmPaymentAtomic ─────────────────────────────────────────────────

describe('confirmPaymentAtomic', () => {
  it('serialises arguments and returns the new lock version', async () => {
    mockRpc.mockResolvedValue({
      data: {
        payment_id: 'p-1',
        order_id: 'o-1',
        pharmacy_transfer: 100.5,
        platform_commission: 9.5,
        consultant_commission: null,
        new_lock_version: 2,
      },
      error: null,
    })

    const res = await confirmPaymentAtomic('p-1', {
      paymentMethod: 'PIX',
      referenceCode: 'ref-xyz',
      notes: null,
      confirmedByUserId: 'admin-1',
      expectedLockVersion: 1,
    })

    expect(mockRpc).toHaveBeenCalledWith('confirm_payment_atomic', {
      p_payment_id: 'p-1',
      p_args: {
        payment_method: 'PIX',
        reference_code: 'ref-xyz',
        notes: '',
        confirmed_by_user_id: 'admin-1',
        expected_lock_version: 1,
      },
    })
    expect(res.data?.new_lock_version).toBe(2)
    expect(res.data?.consultant_commission).toBeNull()
  })

  it('propagates already_processed reason on duplicate confirmation', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Pagamento: already_processed' },
    })
    const res = await confirmPaymentAtomic('p-1', {
      paymentMethod: 'PIX',
      confirmedByUserId: 'a',
    })
    expect(res.error?.reason).toBe('already_processed')
  })

  it('distinguishes stale_version from already_processed', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'stale_version' },
    })
    const res = await confirmPaymentAtomic('p-1', {
      paymentMethod: 'PIX',
      confirmedByUserId: 'a',
      expectedLockVersion: 1,
    })
    expect(res.error?.reason).toBe('stale_version')
  })
})

// ── createOrderAtomic ────────────────────────────────────────────────────

describe('createOrderAtomic', () => {
  it('sends normalised JSONB to the RPC and returns order_id/code/total', async () => {
    mockRpc.mockResolvedValue({
      data: {
        order_id: 'o-1',
        order_code: 'CP-2026-000001',
        total_price: 250.75,
      },
      error: null,
    })

    const res = await createOrderAtomic({
      buyerType: 'CLINIC',
      clinicId: 'c-1',
      doctorId: 'd-1',
      deliveryAddressId: null,
      pharmacyId: 'ph-1',
      notes: 'hello',
      createdByUserId: 'u-1',
      estimatedTotal: 250.75,
      items: [
        { product_id: 'p-1', quantity: 2, unit_price: 100, total_price: 200, coupon_id: null },
        { product_id: 'p-2', quantity: 1, unit_price: 50.75, total_price: 50.75, coupon_id: 'cp' },
      ],
    })

    expect(mockRpc).toHaveBeenCalledWith(
      'create_order_atomic',
      expect.objectContaining({
        p_args: expect.objectContaining({
          buyer_type: 'CLINIC',
          clinic_id: 'c-1',
          pharmacy_id: 'ph-1',
          created_by_user_id: 'u-1',
          estimated_total: 250.75,
          items: [
            expect.objectContaining({ product_id: 'p-1', coupon_id: '' }),
            expect.objectContaining({ product_id: 'p-2', coupon_id: 'cp' }),
          ],
        }),
      })
    )
    expect(res.data?.order_code).toBe('CP-2026-000001')
    expect(res.data?.total_price).toBe(250.75)
  })

  it('surfaces empty_items reason', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'empty_items' },
    })
    const res = await createOrderAtomic({
      buyerType: 'CLINIC',
      clinicId: 'c',
      pharmacyId: 'p',
      createdByUserId: 'u',
      estimatedTotal: 0,
      items: [],
    })
    expect(res.error?.reason).toBe('empty_items')
  })
})

// ── recordAtomicFallback ─────────────────────────────────────────────────

describe('recordAtomicFallback', () => {
  it('increments atomic_rpc_fallback_total with flow+reason labels', () => {
    recordAtomicFallback('coupon', 'flag_off')
    expect(incCounter).toHaveBeenCalledWith('atomic_rpc_fallback_total', {
      flow: 'coupon',
      reason: 'flag_off',
    })
  })
})
