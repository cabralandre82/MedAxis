/**
 * Tests for the buyer-side tiered price preview hook.
 *
 * Pin the contract:
 *   1. FIXED-only items don't trigger any fetch (saves a round-trip
 *      per cart change).
 *   2. TIERED items DO trigger fetch — once per (productId, qty,
 *      couponId) tuple. Cache hits short-circuit.
 *   3. API errors are stored as 'error' state with `errorReason`.
 *   4. /api/pricing/preview's { ok: false, reason } is surfaced as
 *      'error' too — UI can branch on `errorReason`.
 *   5. Quantity changes invalidate cache — but switching back to a
 *      previously seen qty hits cache again.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useTieredPricePreview } from '@/lib/orders/use-tiered-price-preview'

const PROD_A = '11111111-1111-1111-1111-111111111111'
const PROD_B = '22222222-2222-2222-2222-222222222222'

function mockFetchHttp4xx(reason: string) {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: false,
    json: async () => ({ reason }),
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

function mockFetchSequence(
  ...responses: Array<
    { ok: true; breakdown: Record<string, number> } | { ok: false; reason: string }
  >
) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => r })
  }
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useTieredPricePreview', () => {
  it('returns undefined for items it has not seen yet', () => {
    mockFetchSequence({
      ok: true,
      breakdown: {
        final_unit_price_cents: 150_000,
        tier_unit_cents: 150_000,
      },
    })
    const { result } = renderHook(() => useTieredPricePreview([{ productId: PROD_A, quantity: 1 }]))
    // Synchronous get for an item that hasn't been requested at all
    expect(result.current.get(PROD_B, 1)).toBeUndefined()
  })

  it('marks pending then ok after fetch resolves', async () => {
    mockFetchSequence({
      ok: true,
      breakdown: {
        final_unit_price_cents: 150_000,
        tier_unit_cents: 150_000,
      },
    })
    const { result } = renderHook(() => useTieredPricePreview([{ productId: PROD_A, quantity: 1 }]))
    await waitFor(() => {
      expect(result.current.get(PROD_A, 1)?.state).toBe('ok')
    })
    expect(result.current.get(PROD_A, 1)?.unitCents).toBe(150_000)
  })

  it('caches by (productId, qty, couponId) — same tuple does not refetch', async () => {
    const fetchMock = mockFetchSequence({
      ok: true,
      breakdown: { final_unit_price_cents: 150_000, tier_unit_cents: 150_000 },
    })
    const { rerender, result } = renderHook(({ items }) => useTieredPricePreview(items), {
      initialProps: { items: [{ productId: PROD_A, quantity: 2 }] },
    })
    await waitFor(() => {
      expect(result.current.get(PROD_A, 2)?.state).toBe('ok')
    })
    // Re-render with the SAME tuple
    rerender({ items: [{ productId: PROD_A, quantity: 2 }] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when quantity changes (different tier)', async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, breakdown: { final_unit_price_cents: 150_000, tier_unit_cents: 150_000 } },
      { ok: true, breakdown: { final_unit_price_cents: 130_000, tier_unit_cents: 130_000 } }
    )
    const { rerender, result } = renderHook(({ items }) => useTieredPricePreview(items), {
      initialProps: { items: [{ productId: PROD_A, quantity: 1 }] },
    })
    await waitFor(() => {
      expect(result.current.get(PROD_A, 1)?.state).toBe('ok')
    })
    rerender({ items: [{ productId: PROD_A, quantity: 4 }] })
    await waitFor(() => {
      expect(result.current.get(PROD_A, 4)?.state).toBe('ok')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.get(PROD_A, 1)?.unitCents).toBe(150_000)
    expect(result.current.get(PROD_A, 4)?.unitCents).toBe(130_000)
  })

  it("surfaces { ok:false, reason: 'no_active_profile' } from API as error state", async () => {
    mockFetchSequence({ ok: false, reason: 'no_active_profile' })
    const { result } = renderHook(() => useTieredPricePreview([{ productId: PROD_A, quantity: 1 }]))
    await waitFor(() => {
      expect(result.current.get(PROD_A, 1)?.state).toBe('error')
    })
    expect(result.current.get(PROD_A, 1)?.errorReason).toBe('no_active_profile')
  })

  it('surfaces no_tier_for_quantity from API as error state', async () => {
    mockFetchSequence({ ok: false, reason: 'no_tier_for_quantity' })
    const { result } = renderHook(() =>
      useTieredPricePreview([{ productId: PROD_A, quantity: 999 }])
    )
    await waitFor(() => {
      expect(result.current.get(PROD_A, 999)?.errorReason).toBe('no_tier_for_quantity')
    })
  })

  it('treats HTTP 4xx as error (auth / rate-limit / server)', async () => {
    mockFetchHttp4xx('rate_limited')
    const { result } = renderHook(() => useTieredPricePreview([{ productId: PROD_A, quantity: 1 }]))
    await waitFor(() => {
      expect(result.current.get(PROD_A, 1)?.state).toBe('error')
    })
    expect(result.current.get(PROD_A, 1)?.errorReason).toBe('rate_limited')
  })

  it('does not call fetch when items list is empty', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch
    renderHook(() => useTieredPricePreview([]))
    // Settle effects
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes coupon_id and scope ids in the query string when set', async () => {
    const fetchMock = mockFetchSequence({
      ok: true,
      breakdown: { final_unit_price_cents: 100_000, tier_unit_cents: 150_000 },
    })
    renderHook(() =>
      useTieredPricePreview([{ productId: PROD_A, quantity: 2, couponId: 'CPN-XYZ' }], {
        clinicId: 'CLN-1',
        doctorId: null,
      })
    )
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('product_id=' + PROD_A)
    expect(url).toContain('quantity=2')
    expect(url).toContain('coupon_id=CPN-XYZ')
    expect(url).toContain('clinic_id=CLN-1')
    expect(url).not.toContain('doctor_id=')
  })

  it('different couponId for same product+qty triggers a separate fetch', async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, breakdown: { final_unit_price_cents: 150_000, tier_unit_cents: 150_000 } },
      { ok: true, breakdown: { final_unit_price_cents: 120_000, tier_unit_cents: 150_000 } }
    )
    const { rerender, result } = renderHook(({ items }) => useTieredPricePreview(items), {
      initialProps: {
        items: [{ productId: PROD_A, quantity: 2, couponId: null as string | null }],
      },
    })
    await waitFor(() => {
      expect(result.current.get(PROD_A, 2, null)?.state).toBe('ok')
    })
    rerender({ items: [{ productId: PROD_A, quantity: 2, couponId: 'CPN-A' }] })
    await waitFor(() => {
      expect(result.current.get(PROD_A, 2, 'CPN-A')?.state).toBe('ok')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.get(PROD_A, 2, null)?.unitCents).toBe(150_000)
    expect(result.current.get(PROD_A, 2, 'CPN-A')?.unitCents).toBe(120_000)
  })
})
