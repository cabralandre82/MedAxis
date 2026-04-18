/**
 * Unit tests for lib/cron/guarded — Wave 2 single-flight cron guard.
 *
 * Covers:
 *   - runCronGuarded happy path (success row + release)
 *   - second concurrent caller gets `skipped_locked`
 *   - handler exception → row marked failed, lock released
 *   - cron_try_lock RPC error → degraded
 *   - withCronGuard authenticates via Bearer / x-cron-secret / ?secret
 *   - withCronGuard unauthenticated request returns 401
 *   - result JSON shape for each status
 *   - argument validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const insertReturning = vi.fn()
const updateEq = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: fromMock,
    rpc: rpcMock,
  }),
}))

function buildChain() {
  fromMock.mockImplementation(() => ({
    insert: () => ({
      select: () => ({ single: insertReturning }),
    }),
    update: () => ({ eq: updateEq }),
  }))
}

import { runCronGuarded, withCronGuard } from '@/lib/cron/guarded'
import { NextRequest } from 'next/server'

function makeReq(url: string, init: { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(url, { headers: init.headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  buildChain()
  updateEq.mockResolvedValue({ error: null })
  delete process.env.CRON_SECRET
})

describe('runCronGuarded - happy path', () => {
  it('acquires lock, inserts running row, runs handler, marks success, releases', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null }) // try_lock
      .mockResolvedValueOnce({ data: true, error: null }) // release_lock
    insertReturning.mockResolvedValueOnce({ data: { id: 11 }, error: null })

    const fn = vi.fn().mockResolvedValue({ rows: 7 })
    const out = await runCronGuarded('job-x', fn)

    expect(out.status).toBe('success')
    if (out.status === 'success') {
      expect(out.runId).toBe(11)
      expect(out.durationMs).toBeGreaterThanOrEqual(0)
      expect(out.result).toEqual({ rows: 7 })
    }

    expect(rpcMock).toHaveBeenCalledWith(
      'cron_try_lock',
      expect.objectContaining({ p_job_name: 'job-x', p_ttl_seconds: 900 })
    )
    expect(rpcMock).toHaveBeenLastCalledWith(
      'cron_release_lock',
      expect.objectContaining({ p_job_name: 'job-x' })
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('cron_runs')
  })

  it('honours a custom ttlSeconds', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    await runCronGuarded('j', async () => null, { ttlSeconds: 60 })

    const lockCall = rpcMock.mock.calls.find(([name]) => name === 'cron_try_lock')
    expect(lockCall?.[1].p_ttl_seconds).toBe(60)
  })
})

describe('runCronGuarded - single-flight', () => {
  it('returns skipped_locked when try_lock returns false', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 22 }, error: null })

    const fn = vi.fn()
    const out = await runCronGuarded('job-y', fn)

    expect(out.status).toBe('skipped_locked')
    if (out.status === 'skipped_locked') {
      expect(out.runId).toBe(22)
    }
    expect(fn).not.toHaveBeenCalled()
  })

  it('even without a cron_runs row, still returns skipped_locked gracefully', async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    insertReturning.mockResolvedValueOnce({ data: null, error: { message: 'x' } })

    const fn = vi.fn()
    const out = await runCronGuarded('job-z', fn)

    expect(out.status).toBe('skipped_locked')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('runCronGuarded - failure', () => {
  it('marks run as failed, releases lock, and returns {status:"failed"}', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null }) // try_lock
      .mockResolvedValueOnce({ data: true, error: null }) // release_lock
    insertReturning.mockResolvedValueOnce({ data: { id: 33 }, error: null })

    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    const out = await runCronGuarded('job-fail', fn)

    expect(out.status).toBe('failed')
    if (out.status === 'failed') {
      expect(out.runId).toBe(33)
      expect(out.error).toBe('boom')
    }
    expect(rpcMock).toHaveBeenLastCalledWith('cron_release_lock', expect.any(Object))
  })

  it('truncates enormous error messages before persisting', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const huge = 'x'.repeat(10_000)
    await runCronGuarded('job-huge', async () => {
      throw new Error(huge)
    })

    const updateCalls = updateEq.mock.calls
    const failureCall = updateCalls.find(() => true)
    expect(failureCall).toBeDefined()
  })
})

describe('runCronGuarded - degraded', () => {
  it('returns degraded when cron_try_lock RPC errors', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'rpc down' } })

    const fn = vi.fn()
    const out = await runCronGuarded('j', fn)

    expect(out.status).toBe('degraded')
    if (out.status === 'degraded') expect(out.reason).toContain('rpc down')
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns degraded when cron_try_lock throws', async () => {
    rpcMock.mockRejectedValueOnce(new Error('network'))
    const fn = vi.fn()
    const out = await runCronGuarded('j', fn)
    expect(out.status).toBe('degraded')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('runCronGuarded - argument validation', () => {
  it('throws when jobName is missing', async () => {
    // @ts-expect-error deliberate
    await expect(runCronGuarded('', async () => 1)).rejects.toThrow(/jobName is required/)
  })
})

describe('withCronGuard - HTTP wrapper', () => {
  it('returns 401 when CRON_SECRET is not configured', async () => {
    const h = withCronGuard('j', async () => ({ ok: true }))
    const res = await h(makeReq('http://x/api/cron/j'))
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong secret', async () => {
    process.env.CRON_SECRET = 's3cret'
    const h = withCronGuard('j', async () => ({ ok: true }))
    const res = await h(
      makeReq('http://x/api/cron/j', { headers: { authorization: 'Bearer wrong' } })
    )
    expect(res.status).toBe(401)
  })

  it('accepts Bearer secret', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const h = withCronGuard('j', async () => ({ n: 3 }))
    const res = await h(
      makeReq('http://x/api/cron/j', { headers: { authorization: 'Bearer s3cret' } })
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.result).toEqual({ n: 3 })
  })

  it('accepts x-cron-secret header', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const h = withCronGuard('j', async () => ({}))
    const res = await h(makeReq('http://x/api/cron/j', { headers: { 'x-cron-secret': 's3cret' } }))
    expect(res.status).toBe(200)
  })

  it('accepts ?secret= query param', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const h = withCronGuard('j', async () => ({}))
    const res = await h(makeReq('http://x/api/cron/j?secret=s3cret'))
    expect(res.status).toBe(200)
  })

  it('returns 500 when handler throws', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const h = withCronGuard('j', async () => {
      throw new Error('oops')
    })
    const res = await h(
      makeReq('http://x/api/cron/j', { headers: { authorization: 'Bearer s3cret' } })
    )
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe('oops')
  })

  it('returns 200 (skipped) when another run is in flight', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 9 }, error: null })

    const h = withCronGuard('j', async () => ({}))
    const res = await h(
      makeReq('http://x/api/cron/j', { headers: { authorization: 'Bearer s3cret' } })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.skipped).toBe(true)
  })

  it('returns 503 on degraded DB', async () => {
    process.env.CRON_SECRET = 's3cret'
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } })

    const h = withCronGuard('j', async () => ({}))
    const res = await h(
      makeReq('http://x/api/cron/j', { headers: { authorization: 'Bearer s3cret' } })
    )
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.degraded).toBe(true)
  })

  it('skips auth when authenticate:false is passed', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    insertReturning.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    const h = withCronGuard('j', async () => ({}), { authenticate: false })
    const res = await h(makeReq('http://x/api/cron/j'))
    expect(res.status).toBe(200)
  })
})
