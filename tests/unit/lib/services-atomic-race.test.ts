/**
 * Race-condition tests for the atomic RPC wrappers. These are unit-level
 * simulations of the contract Postgres guarantees inside a SECURITY
 * DEFINER function: when two concurrent callers target the same row,
 * the second UPDATE matches zero rows and the RPC raises a specific
 * `already_*` reason.
 *
 * A proper end-to-end proof requires a live Postgres and is performed
 * manually (or via the staging integration drill documented in the
 * runbook). The tests here guarantee that the WRAPPER layer does the
 * right thing once the RPC surfaces that reason — i.e. returns a
 * deterministic error to the caller instead of silently succeeding.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

import { applyCouponAtomic, confirmPaymentAtomic } from '@/lib/services/atomic.server'

beforeEach(() => {
  mockRpc.mockReset()
})

describe('coupon double-activation simulation', () => {
  it('two concurrent callers: first wins with row, second gets already_activated', async () => {
    // Simulate the DB behaviour: the first call sees `activated_at IS NULL`
    // and the UPDATE matches 1 row; the second call sees the freshly
    // written activated_at and UPDATE matches 0 rows, raising the sentinel.
    let callNumber = 0
    mockRpc.mockImplementation(() => {
      callNumber += 1
      if (callNumber === 1) {
        return Promise.resolve({
          data: {
            id: 'cid',
            code: 'ABC',
            activated_at: '2026-01-01T00:00:00Z',
            clinic_id: 'clin-1',
            doctor_id: null,
            product_id: 'prod-1',
          },
          error: null,
        })
      }
      return Promise.resolve({
        data: null,
        error: { message: 'already_activated (SQLSTATE P0001)' },
      })
    })

    // Launch both calls at the "same time" — order of resolution mirrors
    // how a row-level conflict resolves in Postgres: exactly one winner.
    const [res1, res2] = await Promise.all([
      applyCouponAtomic('ABC', 'user-1'),
      applyCouponAtomic('ABC', 'user-1'),
    ])

    const winners = [res1, res2].filter((r) => r.data)
    const losers = [res1, res2].filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error?.reason).toBe('already_activated')
  })

  it('is still deterministic under N=10 concurrent callers', async () => {
    let callNumber = 0
    mockRpc.mockImplementation(() => {
      callNumber += 1
      if (callNumber === 1) {
        return Promise.resolve({
          data: {
            id: 'cid',
            code: 'X',
            activated_at: 't',
            clinic_id: 'c',
            doctor_id: null,
            product_id: 'p',
          },
          error: null,
        })
      }
      return Promise.resolve({
        data: null,
        error: { message: 'already_activated' },
      })
    })

    const calls = Array.from({ length: 10 }, () => applyCouponAtomic('X', 'u'))
    const results = await Promise.all(calls)
    expect(results.filter((r) => r.data)).toHaveLength(1)
    expect(results.filter((r) => r.error?.reason === 'already_activated')).toHaveLength(9)
  })
})

describe('payment double-confirmation simulation', () => {
  it('first confirm wins, second sees already_processed', async () => {
    let callNumber = 0
    mockRpc.mockImplementation(() => {
      callNumber += 1
      if (callNumber === 1) {
        return Promise.resolve({
          data: {
            payment_id: 'p',
            order_id: 'o',
            pharmacy_transfer: 10,
            platform_commission: 1,
            consultant_commission: null,
            new_lock_version: 2,
          },
          error: null,
        })
      }
      return Promise.resolve({
        data: null,
        error: { message: 'already_processed' },
      })
    })

    const args = {
      paymentMethod: 'PIX' as const,
      confirmedByUserId: 'admin',
    }
    const [a, b] = await Promise.all([
      confirmPaymentAtomic('p', args),
      confirmPaymentAtomic('p', args),
    ])

    const winners = [a, b].filter((r) => r.data)
    const losers = [a, b].filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers[0].error?.reason).toBe('already_processed')
  })

  it('stale_version when expected_lock_version no longer matches', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'stale_version' },
    })
    const res = await confirmPaymentAtomic('p', {
      paymentMethod: 'PIX',
      confirmedByUserId: 'a',
      expectedLockVersion: 1,
    })
    expect(res.error?.reason).toBe('stale_version')
  })
})
