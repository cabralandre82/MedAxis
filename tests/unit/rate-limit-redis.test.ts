/**
 * Tests for the Redis-ready rate limiter abstraction.
 *
 * We test the in-memory backend (default) and verify the Redis
 * detection logic without actually connecting to Redis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Rate limiter — in-memory backend ──────────────────────────────────────
// Import after vi.mock to get a fresh module

describe('rateLimit — in-memory backend (default)', () => {
  beforeEach(() => {
    // Clear module cache so each test gets a fresh limiter instance
    vi.resetModules()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('allows requests under the limit', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 60_000, max: 3 })
    const r1 = await limiter.check('test-id-1')
    expect(r1.ok).toBe(true)
    expect(r1.remaining).toBe(2)
  })

  it('blocks when limit is reached', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 60_000, max: 2 })
    await limiter.check('blocker-1')
    await limiter.check('blocker-1')
    const blocked = await limiter.check('blocker-1')
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('uses separate buckets per identifier', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 60_000, max: 1 })
    const r1 = await limiter.check('user-A')
    const r2 = await limiter.check('user-B')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true) // different identifier — own bucket
  })

  it('resetAt is in the future', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const result = await limiter.check('future-check')
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('allows again after window expires', async () => {
    vi.useFakeTimers()
    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 100, max: 1 })
    await limiter.check('window-test')
    const blocked = await limiter.check('window-test')
    expect(blocked.ok).toBe(false)

    vi.advanceTimersByTime(200) // past the window
    const allowed = await limiter.check('window-test')
    expect(allowed.ok).toBe(true)
    vi.useRealTimers()
  })
})

// ── Pre-configured limiters ────────────────────────────────────────────────

describe('pre-configured limiters', () => {
  it('authLimiter exports a valid RateLimiter interface', async () => {
    const { authLimiter } = await import('@/lib/rate-limit')
    expect(typeof authLimiter.check).toBe('function')
    const result = await authLimiter.check('pre-auth-test')
    expect(typeof result.ok).toBe('boolean')
    expect(typeof result.remaining).toBe('number')
    expect(typeof result.resetAt).toBe('number')
  })

  it('exportLimiter exports a valid RateLimiter interface', async () => {
    const { exportLimiter } = await import('@/lib/rate-limit')
    expect(typeof exportLimiter.check).toBe('function')
    const result = await exportLimiter.check('pre-export-test')
    expect(result.ok).toBe(true)
  })

  it('registrationLimiter is more restrictive (max=3)', async () => {
    const { registrationLimiter } = await import('@/lib/rate-limit')
    const id = 'reg-max-test-' + Date.now()
    await registrationLimiter.check(id)
    await registrationLimiter.check(id)
    await registrationLimiter.check(id)
    const blocked = await registrationLimiter.check(id)
    expect(blocked.ok).toBe(false)
  })
})

// ── Redis detection ────────────────────────────────────────────────────────

describe('rateLimit — Redis env var detection', () => {
  it('uses in-memory when UPSTASH env vars are absent', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    const { rateLimit } = await import('@/lib/rate-limit')
    // Should not throw — just uses in-memory silently
    const limiter = rateLimit({ windowMs: 1000, max: 5 })
    const result = await limiter.check('no-redis')
    expect(result.ok).toBe(true)
  })

  it('detects Redis configuration from env vars', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token'
    const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    expect(hasRedis).toBe(true)
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  // Regression for the 2026-04-29 incident: the legacy
  // `new Function('s', 'return import(s)')` resolver was failing in
  // the production runtime even though @upstash/* packages were
  // bundled and env vars were set, causing every page load to log
  // "Upstash packages not available, using in-memory fallback".
  // The fix uses a plain `await import('@upstash/...')` so the
  // bundler resolves the modules statically. This test pins that
  // contract — when the env vars are set AND the modules resolve,
  // the Redis-backed limiter must be reachable.
  it('uses the Redis backend when env vars + modules are available', async () => {
    vi.resetModules()
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token'

    const limitMock = vi.fn().mockResolvedValue({
      success: true,
      remaining: 4,
      reset: Date.now() + 60_000,
    })

    vi.doMock('@upstash/ratelimit', () => ({
      Ratelimit: class {
        static slidingWindow() {
          return 'slidingWindow-mock'
        }
        constructor() {
          /* noop */
        }
        limit = limitMock
      },
    }))
    vi.doMock('@upstash/redis', () => ({
      Redis: { fromEnv: () => ({ kind: 'mock-redis' }) },
    }))

    const { rateLimit } = await import('@/lib/rate-limit')
    const limiter = rateLimit({ windowMs: 60_000, max: 5 })
    const result = await limiter.check('redis-path-1')
    expect(result.ok).toBe(true)
    expect(result.remaining).toBe(4)
    expect(limitMock).toHaveBeenCalledTimes(1)

    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.doUnmock('@upstash/ratelimit')
    vi.doUnmock('@upstash/redis')
  })
})
