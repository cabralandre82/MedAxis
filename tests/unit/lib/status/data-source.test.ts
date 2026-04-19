// @vitest-environment node
/**
 * Unit tests for `lib/status/data-source.ts`.
 *
 * Covers the factory + cache wrapper:
 *   - falls back to internal when Grafana env is missing
 *   - selects grafana-cloud when env present
 *   - memoises within TTL window, rebuilds after expiry
 *   - never throws — surfaces a synthesised degraded summary
 *   - serves stale-on-error when an earlier successful summary exists
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const buildSpy = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({}),
}))

vi.mock('@/lib/status/internal-source', () => ({
  InternalStatusSource: class {
    readonly name = 'internal' as const
    async build(now: Date) {
      return buildSpy(now)
    }
  },
}))

vi.mock('@/lib/status/grafana-cloud-source', () => ({
  GrafanaCloudStatusSource: {
    fromEnv: vi.fn(() => null),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { getStatusSummary, pickSource, __resetStatusCacheForTests } from '@/lib/status/data-source'
import type { StatusSummary } from '@/lib/status/types'
import { GrafanaCloudStatusSource } from '@/lib/status/grafana-cloud-source'

const baseSummary = (override: Partial<StatusSummary> = {}): StatusSummary => ({
  generatedAt: '2026-04-18T12:00:00.000Z',
  source: 'internal',
  window: {
    sevenDays: { fromIso: 'a', toIso: 'b' },
    thirtyDays: { fromIso: 'a', toIso: 'b' },
    ninetyDays: { fromIso: 'a', toIso: 'b' },
  },
  components: [],
  incidents: [],
  degraded: false,
  ...override,
})

beforeEach(() => {
  __resetStatusCacheForTests()
  buildSpy.mockReset()
  vi.mocked(GrafanaCloudStatusSource.fromEnv).mockReturnValue(null)
})

afterEach(() => {
  __resetStatusCacheForTests()
})

describe('pickSource', () => {
  it('returns internal source when grafana env is missing', () => {
    const src = pickSource()
    expect(src.name).toBe('internal')
  })

  it('returns grafana source when env supplies it', () => {
    const fakeGrafana = { name: 'grafana-cloud' as const, build: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(GrafanaCloudStatusSource.fromEnv).mockReturnValue(fakeGrafana as any)
    const src = pickSource()
    expect(src.name).toBe('grafana-cloud')
  })
})

describe('getStatusSummary', () => {
  it('returns a fresh summary when cache is empty', async () => {
    buildSpy.mockResolvedValue(baseSummary())
    const out = await getStatusSummary(new Date('2026-04-18T12:00:00.000Z'))
    expect(out.source).toBe('internal')
    expect(buildSpy).toHaveBeenCalledTimes(1)
  })

  it('serves the cached summary within the TTL window', async () => {
    const t0 = new Date('2026-04-18T12:00:00.000Z')
    const t1 = new Date(t0.getTime() + 30_000)
    buildSpy.mockResolvedValue(baseSummary())
    await getStatusSummary(t0)
    await getStatusSummary(t1)
    expect(buildSpy).toHaveBeenCalledTimes(1)
  })

  it('rebuilds after the TTL elapses', async () => {
    const t0 = new Date('2026-04-18T12:00:00.000Z')
    const t1 = new Date(t0.getTime() + 61_000)
    buildSpy.mockResolvedValue(baseSummary())
    await getStatusSummary(t0)
    await getStatusSummary(t1)
    expect(buildSpy).toHaveBeenCalledTimes(2)
  })

  it('synthesises a degraded summary when the first build throws', async () => {
    buildSpy.mockRejectedValue(new Error('db down'))
    const out = await getStatusSummary(new Date('2026-04-18T12:00:00.000Z'))
    expect(out.degraded).toBe(true)
    expect(out.degradedReason).toMatch(/db down/)
    expect(out.components).toEqual([])
    expect(out.incidents).toEqual([])
  })

  it('serves stale-on-error when a previous summary is cached', async () => {
    const t0 = new Date('2026-04-18T12:00:00.000Z')
    const t1 = new Date(t0.getTime() + 90_000) // past TTL → triggers rebuild
    buildSpy.mockResolvedValueOnce(baseSummary({ degraded: false }))
    await getStatusSummary(t0)

    buildSpy.mockRejectedValueOnce(new Error('boom'))
    const stale = await getStatusSummary(t1)

    expect(stale.degraded).toBe(true)
    expect(stale.degradedReason).toMatch(/stale/)
    expect(stale.degradedReason).toMatch(/boom/)
  })
})
