// @vitest-environment node
/**
 * Route handler test for `app/api/status/summary/route.ts`.
 *
 * Confirms:
 *   - GET returns 200 with the StatusSummary payload
 *   - Cache-Control header is set so Edge can cache for 60 s
 *   - Even when the data source throws, the route returns 200 with
 *     `degraded:true` (never 5xx — public endpoint).
 *   - HEAD returns 200 with cache headers, no body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { __resetMetricsForTests } from '@/lib/metrics'

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
  GrafanaCloudStatusSource: { fromEnv: () => null },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { GET, HEAD } from '@/app/api/status/summary/route'
import { __resetStatusCacheForTests } from '@/lib/status/data-source'

beforeEach(() => {
  __resetStatusCacheForTests()
  __resetMetricsForTests()
  buildSpy.mockReset()
})

describe('GET /api/status/summary', () => {
  it('returns 200 with the StatusSummary payload and cache headers', async () => {
    buildSpy.mockResolvedValue({
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
    })

    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.source).toBe('internal')
    expect(body.degraded).toBe(false)

    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/s-maxage=60/)
    expect(cc).toMatch(/stale-while-revalidate/)
  })

  it('returns 200 with degraded=true when the source throws', async () => {
    buildSpy.mockRejectedValue(new Error('db unreachable'))

    const res = await GET()
    expect(res.status).toBe(200) // public endpoint never 5xx
    const body = await res.json()
    expect(body.degraded).toBe(true)
    expect(body.degradedReason).toMatch(/db unreachable/)
  })

  it('HEAD returns 200 with cache headers and no body', async () => {
    const res = await HEAD()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=60/)
    const text = await res.text()
    expect(text).toBe('')
  })
})
