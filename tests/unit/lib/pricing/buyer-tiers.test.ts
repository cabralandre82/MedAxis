/**
 * Tests for `lib/pricing/buyer-tiers` — the buyer-safe view of
 * pricing profiles.
 *
 * Pin the following:
 *   1. `formatTierRange` covers all 3 cases — single, range, open
 *      top.
 *   2. `findTierForQuantity` returns the matching tier or `null`,
 *      and supports open-ended top tiers.
 *   3. `getActiveBuyerTiers` reads the SCD-2 row with
 *      `effective_until IS NULL` and returns null gracefully on
 *      every failure mode (no profile, no tiers, RLS error).
 *   4. The buyer-safe SELECT lists ONLY {id, min_quantity,
 *      max_quantity, unit_price_cents}. This is a regression guard:
 *      if someone widens the SELECT to `*`, the buyer would learn
 *      `pharmacy_cost_unit_cents` and `platform_min_unit_cents` —
 *      both confidential.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAdminClient } from '@/lib/db/admin'
import {
  formatTierRange,
  findTierForQuantity,
  getActiveBuyerTiers,
  getMinTierUnitCentsByProductIds,
  type BuyerTierRow,
} from '@/lib/pricing/buyer-tiers'

const T1: BuyerTierRow = { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 }
const T2: BuyerTierRow = { id: 't2', min_quantity: 2, max_quantity: 3, unit_price_cents: 140_000 }
const T3_OPEN: BuyerTierRow = {
  id: 't3',
  min_quantity: 4,
  max_quantity: null,
  unit_price_cents: 120_000,
}

describe('formatTierRange', () => {
  it('formats a single-quantity tier as "N un"', () => {
    expect(formatTierRange(T1)).toBe('1 un')
  })

  it('formats a closed range as "min-max un"', () => {
    expect(formatTierRange(T2)).toBe('2-3 un')
  })

  it('formats an open-top tier as "N+ un"', () => {
    expect(formatTierRange(T3_OPEN)).toBe('4+ un')
  })

  it('formats an open-top tier starting at 1 as "1+ un"', () => {
    expect(
      formatTierRange({ id: 'x', min_quantity: 1, max_quantity: null, unit_price_cents: 100 })
    ).toBe('1+ un')
  })
})

describe('findTierForQuantity', () => {
  const tiers = [T1, T2, T3_OPEN]

  it('returns the tier covering the quantity', () => {
    expect(findTierForQuantity(tiers, 1)?.id).toBe('t1')
    expect(findTierForQuantity(tiers, 2)?.id).toBe('t2')
    expect(findTierForQuantity(tiers, 3)?.id).toBe('t2')
    expect(findTierForQuantity(tiers, 4)?.id).toBe('t3')
  })

  it('uses the open-ended top tier for quantities far above', () => {
    expect(findTierForQuantity(tiers, 100)?.id).toBe('t3')
  })

  it('returns null for quantity below 1', () => {
    expect(findTierForQuantity(tiers, 0)).toBeNull()
    expect(findTierForQuantity(tiers, -1)).toBeNull()
  })

  it('returns null when no tier covers the quantity', () => {
    const closed = [T1, T2] // no open top
    expect(findTierForQuantity(closed, 5)).toBeNull()
  })

  it('returns null on empty tier list', () => {
    expect(findTierForQuantity([], 1)).toBeNull()
  })
})

// ── getActiveBuyerTiers — DB-backed lookup ─────────────────────────────
describe('getActiveBuyerTiers', () => {
  // Captures the `select(<columns>)` call so we can assert on the
  // exact column list — this is what enforces the buyer-safe shape.
  let lastSelectArgs: string[] = []

  beforeEach(() => {
    lastSelectArgs = []
    vi.mocked(createAdminClient).mockReset()
  })

  function setupAdmin(profileResult: unknown, tiersResult: unknown) {
    const tiersBuilder = {
      select: vi.fn((cols: string) => {
        lastSelectArgs.push(cols)
        return tiersBuilder
      }),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue(tiersResult),
    }
    const profilesBuilder = {
      select: vi.fn((cols: string) => {
        lastSelectArgs.push(cols)
        return profilesBuilder
      }),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(profileResult),
    }
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'pricing_profiles') return profilesBuilder
        if (table === 'pricing_profile_tiers') return tiersBuilder
        throw new Error(`unexpected table ${table}`)
      }),
    } as unknown as ReturnType<typeof createAdminClient>)
  }

  it('returns null when there is no active profile', async () => {
    setupAdmin({ data: null, error: null }, { data: [], error: null })
    const out = await getActiveBuyerTiers('prod-1')
    expect(out).toBeNull()
  })

  it('returns null when the profile read errors', async () => {
    setupAdmin({ data: null, error: { code: 'PGRST', message: 'rls' } }, { data: [], error: null })
    const out = await getActiveBuyerTiers('prod-1')
    expect(out).toBeNull()
  })

  it('returns null when there are no tiers (defensive)', async () => {
    setupAdmin(
      { data: { id: 'p1', effective_from: '2026-01-01T00:00:00Z' }, error: null },
      { data: [], error: null }
    )
    const out = await getActiveBuyerTiers('prod-1')
    expect(out).toBeNull()
  })

  it('returns the buyer-safe shape on success', async () => {
    setupAdmin(
      { data: { id: 'p1', effective_from: '2026-01-01T00:00:00Z' }, error: null },
      {
        data: [
          { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 },
          { id: 't2', min_quantity: 2, max_quantity: null, unit_price_cents: 140_000 },
        ],
        error: null,
      }
    )
    const out = await getActiveBuyerTiers('prod-1')
    expect(out).toEqual({
      profile_id: 'p1',
      effective_from: '2026-01-01T00:00:00Z',
      tiers: [
        { id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 },
        { id: 't2', min_quantity: 2, max_quantity: null, unit_price_cents: 140_000 },
      ],
    })
  })

  it('SELECT for tiers does NOT include sensitive columns', async () => {
    // This is a regression guard — if someone widens to `*`, the
    // string asserted here will not match.
    setupAdmin(
      { data: { id: 'p1', effective_from: '2026-01-01' }, error: null },
      {
        data: [{ id: 't1', min_quantity: 1, max_quantity: 1, unit_price_cents: 150_000 }],
        error: null,
      }
    )
    await getActiveBuyerTiers('prod-1')
    // Two select calls: one for profiles (id, effective_from), one for
    // tiers (id, min_quantity, max_quantity, unit_price_cents).
    expect(lastSelectArgs).toContain('id, effective_from')
    expect(lastSelectArgs).toContain('id, min_quantity, max_quantity, unit_price_cents')
    // None of them mention sensitive fields.
    for (const cols of lastSelectArgs) {
      expect(cols).not.toContain('pharmacy_cost')
      expect(cols).not.toContain('platform_min')
      expect(cols).not.toContain('consultant_')
      expect(cols).not.toContain('*')
    }
  })

  it('returns null when the tiers read errors', async () => {
    setupAdmin(
      { data: { id: 'p1', effective_from: '2026-01-01' }, error: null },
      { data: null, error: { code: 'PGRST', message: 'rls' } }
    )
    const out = await getActiveBuyerTiers('prod-1')
    expect(out).toBeNull()
  })
})

// ── getMinTierUnitCentsByProductIds — batched lookup for the catalog grid ──
describe('getMinTierUnitCentsByProductIds', () => {
  let lastSelectArgs: string[] = []

  beforeEach(() => {
    lastSelectArgs = []
    vi.mocked(createAdminClient).mockReset()
  })

  function setupAdminBatch(profilesData: unknown, profilesError: unknown = null) {
    const builder = {
      select: vi.fn((cols: string) => {
        lastSelectArgs.push(cols)
        return builder
      }),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: profilesData, error: profilesError }),
    }
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => builder),
    } as unknown as ReturnType<typeof createAdminClient>)
  }

  it('returns {} for empty input without hitting the DB', async () => {
    const fromSpy = vi.fn()
    vi.mocked(createAdminClient).mockReturnValue({
      from: fromSpy,
    } as unknown as ReturnType<typeof createAdminClient>)
    const out = await getMinTierUnitCentsByProductIds([])
    expect(out).toEqual({})
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('groups by product and returns the MIN unit_price_cents per product', async () => {
    setupAdminBatch([
      {
        product_id: 'prod-A',
        pricing_profile_tiers: [
          { unit_price_cents: 150_000 },
          { unit_price_cents: 130_000 },
          { unit_price_cents: 120_000 },
        ],
      },
      {
        product_id: 'prod-B',
        pricing_profile_tiers: [{ unit_price_cents: 80_000 }, { unit_price_cents: 70_000 }],
      },
    ])
    const out = await getMinTierUnitCentsByProductIds(['prod-A', 'prod-B'])
    expect(out).toEqual({ 'prod-A': 120_000, 'prod-B': 70_000 })
  })

  it('omits products with no active tiers from the result map', async () => {
    setupAdminBatch([
      { product_id: 'prod-A', pricing_profile_tiers: [{ unit_price_cents: 100_000 }] },
      { product_id: 'prod-B', pricing_profile_tiers: [] }, // present but empty
    ])
    const out = await getMinTierUnitCentsByProductIds(['prod-A', 'prod-B', 'prod-C'])
    expect(out).toEqual({ 'prod-A': 100_000 })
    expect(out['prod-B']).toBeUndefined()
    expect(out['prod-C']).toBeUndefined()
  })

  it('returns {} on DB error (graceful — caller falls back to FIXED card)', async () => {
    setupAdminBatch(null, { code: 'PGRST', message: 'rls denied' })
    const out = await getMinTierUnitCentsByProductIds(['prod-A'])
    expect(out).toEqual({})
  })

  it('SELECT does NOT include sensitive columns (regression guard)', async () => {
    setupAdminBatch([
      { product_id: 'prod-A', pricing_profile_tiers: [{ unit_price_cents: 100_000 }] },
    ])
    await getMinTierUnitCentsByProductIds(['prod-A'])
    // The single select call should ask for product_id +
    // pricing_profile_tiers(unit_price_cents) only.
    expect(lastSelectArgs.length).toBe(1)
    const cols = lastSelectArgs[0]
    expect(cols).toContain('product_id')
    expect(cols).toContain('unit_price_cents')
    expect(cols).not.toContain('pharmacy_cost')
    expect(cols).not.toContain('platform_min')
    expect(cols).not.toContain('consultant_')
    expect(cols).not.toContain('*')
  })
})
