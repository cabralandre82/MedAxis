import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rateLimit } from '@/lib/rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('allows requests within the limit', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const r1 = await limiter.check('user-1')
    expect(r1.ok).toBe(true)
    expect(r1.remaining).toBe(4)
  })

  it('tracks remaining count correctly', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 })
    expect((await limiter.check('id2')).remaining).toBe(2)
    expect((await limiter.check('id2')).remaining).toBe(1)
    expect((await limiter.check('id2')).remaining).toBe(0)
  })

  it('blocks requests after limit is reached', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2 })
    await limiter.check('blocked2')
    await limiter.check('blocked2')
    const result = await limiter.check('blocked2')
    expect(result.ok).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets after the window expires', async () => {
    const limiter = rateLimit({ windowMs: 1_000, max: 1 })
    await limiter.check('reset-test2')
    const blocked = await limiter.check('reset-test2')
    expect(blocked.ok).toBe(false)

    vi.advanceTimersByTime(1_001)

    const reset = await limiter.check('reset-test2')
    expect(reset.ok).toBe(true)
    expect(reset.remaining).toBe(0)
  })

  it('uses separate buckets for different identifiers', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })
    const r1 = await limiter.check('user-a2')
    const r2 = await limiter.check('user-b2')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('returns a resetAt timestamp in the future', async () => {
    const limiter = rateLimit({ windowMs: 5_000, max: 10 })
    const result = await limiter.check('ts-test2')
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('handles max=1 correctly — first ok, second blocked', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })
    expect((await limiter.check('one2')).ok).toBe(true)
    expect((await limiter.check('one2')).ok).toBe(false)
  })
})
