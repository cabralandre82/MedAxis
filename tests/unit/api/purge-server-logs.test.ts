// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

const CRON_SECRET = 'cron-test-secret'

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/purge-server-logs', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function makeAdmin({ deleteError = null, deletedCount = 5 } = {}) {
  return {
    from: vi.fn().mockReturnValue({
      delete: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: deleteError ? null : Array(deletedCount).fill({ id: 'x' }),
        error: deleteError ?? null,
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

describe('GET /api/cron/purge-server-logs', () => {
  it('returns 401 when authorization header is missing', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 401 for wrong secret', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const res = await GET(makeRequest('bad-secret'))
    expect(res.status).toBe(401)
  })

  it('returns ok:true with purged count on success', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({ deletedCount: 42 }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.purged).toBe(42)
    expect(body.cutoff).toBeTruthy()
  })

  it('returns ok:true with purged:0 when no old logs', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({ deletedCount: 0 }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect((await res.json()).purged).toBe(0)
  })

  it('returns 500 when DB delete fails', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin({ deleteError: { message: 'connection error' } }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('cutoff is approximately 90 days ago', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdmin() as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const before = Date.now()
    const res = await GET(makeRequest(CRON_SECRET))
    const { cutoff } = await res.json()
    const cutoffMs = new Date(cutoff).getTime()
    const expectedMs = before - 90 * 24 * 60 * 60 * 1000

    // Allow ±5 seconds tolerance
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5000)
  })
})
