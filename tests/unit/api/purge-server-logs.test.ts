// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const CRON_SECRET = 'cron-test-secret'

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/purge-server-logs', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function serverLogsFrom({ deleteError = null as null | { message: string }, deletedCount = 5 }) {
  return (table: string) => {
    if (table === 'server_logs') {
      return {
        delete: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({
          data: deleteError ? null : Array(deletedCount).fill({ id: 'x' }),
          error: deleteError ?? null,
        }),
      }
    }
    return {}
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
    const stub = attachCronGuard({ from: serverLogsFrom({ deletedCount: 42 }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.purged).toBe(42)
    expect(body.result.cutoff).toBeTruthy()
  })

  it('returns ok:true with purged:0 when no old logs', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({ from: serverLogsFrom({ deletedCount: 0 }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect((await res.json()).result.purged).toBe(0)
  })

  it('returns 500 when DB delete fails', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({
      from: serverLogsFrom({ deleteError: { message: 'connection error' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })

  it('cutoff is approximately 90 days ago', async () => {
    const { GET } = await import('@/app/api/cron/purge-server-logs/route')
    const stub = attachCronGuard({ from: serverLogsFrom({}) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const before = Date.now()
    const res = await GET(makeRequest(CRON_SECRET))
    const { result } = await res.json()
    const cutoffMs = new Date(result.cutoff).getTime()
    const expectedMs = before - 90 * 24 * 60 * 60 * 1000

    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(5000)
  })
})
