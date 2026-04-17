/**
 * Unit tests for lib/features — feature flag evaluator.
 *
 * Covers:
 *   - Pure evaluator (evaluateFlag) with every targeting dimension
 *   - stableHash determinism and collision behaviour
 *   - Cache TTL and invalidation
 *   - Fail-closed on DB error / missing row
 *   - A/B variant distribution and stability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn()
const selectChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle,
}
const fromMock = vi.fn().mockReturnValue(selectChain)

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

import {
  evaluateFlag,
  isFeatureEnabled,
  getFeatureVariant,
  invalidateFeatureFlagCache,
  stableHash,
  _internal,
} from '@/lib/features'

function baseRow(overrides: Partial<Parameters<typeof evaluateFlag>[0] & object> = {}) {
  return {
    key: 'demo.flag',
    enabled: true,
    rollout_percent: 0,
    target_roles: [],
    target_user_ids: [],
    target_clinic_ids: [],
    target_pharmacy_ids: [],
    variants: null,
    ...overrides,
  } as NonNullable<Parameters<typeof evaluateFlag>[0]>
}

beforeEach(() => {
  maybeSingle.mockReset()
  fromMock.mockClear()
  invalidateFeatureFlagCache()
})

describe('stableHash', () => {
  it('returns the same value for the same input', () => {
    expect(stableHash('hello')).toBe(stableHash('hello'))
  })

  it('produces different values for different inputs', () => {
    expect(stableHash('a')).not.toBe(stableHash('b'))
  })

  it('returns non-negative 32-bit integers', () => {
    const h = stableHash('user-123:demo.flag')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
    expect(Number.isInteger(h)).toBe(true)
  })
})

describe('evaluateFlag — pure evaluator', () => {
  it('returns false when the row is null', () => {
    expect(evaluateFlag(null)).toBe(false)
  })

  it('returns false when the kill-switch is off', () => {
    expect(evaluateFlag(baseRow({ enabled: false, rollout_percent: 100 }))).toBe(false)
  })

  it('targets by explicit userId', () => {
    const row = baseRow({ target_user_ids: ['u-1', 'u-2'] })
    expect(evaluateFlag(row, { userId: 'u-1' })).toBe(true)
    expect(evaluateFlag(row, { userId: 'u-99' })).toBe(false)
  })

  it('targets by explicit clinicId', () => {
    const row = baseRow({ target_clinic_ids: ['c-1'] })
    expect(evaluateFlag(row, { clinicId: 'c-1' })).toBe(true)
    expect(evaluateFlag(row, { clinicId: 'c-2' })).toBe(false)
  })

  it('targets by explicit pharmacyId', () => {
    const row = baseRow({ target_pharmacy_ids: ['p-1'] })
    expect(evaluateFlag(row, { pharmacyId: 'p-1' })).toBe(true)
    expect(evaluateFlag(row, { pharmacyId: 'p-2' })).toBe(false)
  })

  it('denies when role allow-list is set and role does not match', () => {
    const row = baseRow({ target_roles: ['SUPER_ADMIN'], rollout_percent: 100 })
    expect(evaluateFlag(row, { role: 'CLINIC_ADMIN' })).toBe(false)
    expect(evaluateFlag(row, { role: 'SUPER_ADMIN' })).toBe(true)
  })

  it('ignores role allow-list when it is empty', () => {
    const row = baseRow({ target_roles: [], rollout_percent: 100 })
    expect(evaluateFlag(row, { role: 'ANY_ROLE' })).toBe(true)
  })

  it('honours rollout_percent=0 by returning false', () => {
    expect(evaluateFlag(baseRow({ rollout_percent: 0 }), { userId: 'anyone' })).toBe(false)
  })

  it('honours rollout_percent=100 by returning true', () => {
    expect(evaluateFlag(baseRow({ rollout_percent: 100 }), { userId: 'anyone' })).toBe(true)
  })

  it('gives stable verdicts across calls for the same subject', () => {
    const row = baseRow({ rollout_percent: 50 })
    const first = evaluateFlag(row, { userId: 'user-stable' })
    for (let i = 0; i < 10; i++) {
      expect(evaluateFlag(row, { userId: 'user-stable' })).toBe(first)
    }
  })

  it('falls back to key-only hash when no subject is provided', () => {
    const row = baseRow({ rollout_percent: 50 })
    const a = evaluateFlag(row)
    const b = evaluateFlag(row)
    expect(a).toBe(b)
  })

  it('approximates the requested rollout over many subjects', () => {
    const row = baseRow({ rollout_percent: 30 })
    let hits = 0
    const total = 10_000
    for (let i = 0; i < total; i++) {
      if (evaluateFlag(row, { userId: `user-${i}` })) hits++
    }
    const pct = (hits / total) * 100
    // Allow 3 percentage points of slack for a 32-bit hash over 10k subjects.
    expect(pct).toBeGreaterThan(27)
    expect(pct).toBeLessThan(33)
  })

  it('prefers subjectId override over userId for hashing', () => {
    const row = baseRow({ rollout_percent: 50 })
    const withUser = evaluateFlag(row, { userId: 'user-a' })
    // Find a subjectId that flips the verdict — this proves the override is used.
    let flipped = false
    for (let i = 0; i < 50 && !flipped; i++) {
      const v = evaluateFlag(row, { userId: 'user-a', subjectId: `s-${i}` })
      if (v !== withUser) flipped = true
    }
    expect(flipped).toBe(true)
  })
})

describe('isFeatureEnabled — DB-backed', () => {
  it('returns false when the flag row is missing', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(isFeatureEnabled('does.not.exist')).resolves.toBe(false)
  })

  it('returns false when the DB query errors (fail-closed)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('network down') })
    await expect(isFeatureEnabled('rbac.fine_grained')).resolves.toBe(false)
  })

  it('returns false when createAdminClient throws (fail-closed)', async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error('admin boom')
    })
    await expect(isFeatureEnabled('rbac.fine_grained')).resolves.toBe(false)
  })

  it('returns true when the flag targets the current user', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'rbac.fine_grained',
        enabled: true,
        rollout_percent: 0,
        target_roles: [],
        target_user_ids: ['u-1'],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: null,
      },
      error: null,
    })
    await expect(isFeatureEnabled('rbac.fine_grained', { userId: 'u-1' })).resolves.toBe(true)
    await expect(isFeatureEnabled('rbac.fine_grained', { userId: 'u-other' })).resolves.toBe(false)
  })

  it('caches flag lookups for the configured TTL', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'orders.atomic_rpc',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: null,
      },
      error: null,
    })

    await isFeatureEnabled('orders.atomic_rpc', { userId: 'u-1' })
    await isFeatureEnabled('orders.atomic_rpc', { userId: 'u-1' })
    await isFeatureEnabled('orders.atomic_rpc', { userId: 'u-1' })

    // Only one DB round-trip despite three calls
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('invalidateFeatureFlagCache forces a reload', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'observability.deep_health',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: null,
      },
      error: null,
    })

    await isFeatureEnabled('observability.deep_health')
    invalidateFeatureFlagCache('observability.deep_health')
    await isFeatureEnabled('observability.deep_health')

    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('invalidateFeatureFlagCache() with no key clears everything', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'a',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: null,
      },
      error: null,
    })

    await isFeatureEnabled('a')
    expect(_internal.cache.size).toBeGreaterThan(0)
    invalidateFeatureFlagCache()
    expect(_internal.cache.size).toBe(0)
  })
})

describe('getFeatureVariant', () => {
  it('returns null when the flag is disabled', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'ab.test',
        enabled: false,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: { control: 50, treatment: 50 },
      },
      error: null,
    })
    await expect(getFeatureVariant('ab.test', { userId: 'u' })).resolves.toBeNull()
  })

  it('returns null when the flag has no variants', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'plain.flag',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: null,
      },
      error: null,
    })
    await expect(getFeatureVariant('plain.flag', { userId: 'u' })).resolves.toBeNull()
  })

  it('picks a deterministic variant per subject', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'ab.test',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: { control: 50, treatment: 50 },
      },
      error: null,
    })

    const first = await getFeatureVariant('ab.test', { userId: 'subject-123' })
    expect(first).toMatch(/^(control|treatment)$/)

    // Same subject → same variant on subsequent calls
    for (let i = 0; i < 5; i++) {
      const again = await getFeatureVariant('ab.test', { userId: 'subject-123' })
      expect(again).toBe(first)
    }
  })

  it('distributes variants roughly according to weights', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        key: 'ab.test.dist',
        enabled: true,
        rollout_percent: 100,
        target_roles: [],
        target_user_ids: [],
        target_clinic_ids: [],
        target_pharmacy_ids: [],
        variants: { a: 80, b: 20 },
      },
      error: null,
    })

    const counts = { a: 0, b: 0 } as Record<string, number>
    const total = 5000
    for (let i = 0; i < total; i++) {
      invalidateFeatureFlagCache('ab.test.dist')
      const v = await getFeatureVariant('ab.test.dist', { userId: `u-${i}` })
      if (v === 'a' || v === 'b') counts[v]++
    }

    const pctA = (counts.a / total) * 100
    // 80/20 split — allow ±4 pp slack.
    expect(pctA).toBeGreaterThan(76)
    expect(pctA).toBeLessThan(84)
  })
})
