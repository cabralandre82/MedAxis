/**
 * Rate limiter with Redis-ready abstraction.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Backend selection (automatic, zero config change):     │
 * │                                                         │
 * │  UPSTASH_REDIS_REST_URL set  → Upstash Redis (sliding  │
 * │                                window, multi-instance) │
 * │  Not set                     → In-memory (single       │
 * │                                instance, dev/staging)  │
 * └─────────────────────────────────────────────────────────┘
 *
 * To activate Redis: add to Vercel env vars:
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=AXxx...
 * Then: npm install @upstash/ratelimit @upstash/redis
 *
 * Usage:
 *   const result = await authLimiter.check('ip:1.2.3.4')
 *   if (!result.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
}

export interface RateLimiter {
  check(identifier: string): Promise<RateLimitResult>
}

// ── In-memory backend ─────────────────────────────────────────────────────

interface StoreEntry {
  count: number
  resetAt: number
}

const _store = new Map<string, StoreEntry>()

// Cleanup stale entries every 5 minutes (single-instance only)
if (typeof globalThis !== 'undefined' && !('_rlCleanup' in globalThis)) {
  ;(globalThis as Record<string, unknown>)._rlCleanup = setInterval(
    () => {
      const now = Date.now()
      for (const [key, val] of _store.entries()) {
        if (val.resetAt <= now) _store.delete(key)
      }
    },
    5 * 60 * 1000
  )
}

function makeInMemoryLimiter(windowMs: number, max: number): RateLimiter {
  return {
    async check(identifier: string): Promise<RateLimitResult> {
      const now = Date.now()
      const existing = _store.get(identifier)

      if (!existing || existing.resetAt <= now) {
        const resetAt = now + windowMs
        _store.set(identifier, { count: 1, resetAt })
        return { ok: true, remaining: max - 1, resetAt }
      }

      if (existing.count >= max) {
        return { ok: false, remaining: 0, resetAt: existing.resetAt }
      }

      existing.count++
      return { ok: true, remaining: max - existing.count, resetAt: existing.resetAt }
    },
  }
}

// ── Redis backend (lazy-loaded when env vars are present) ─────────────────

/**
 * Builds an Upstash Redis limiter at runtime.
 * Wrapped in a function to avoid import errors when the packages aren't installed.
 */
async function makeRedisLimiter(windowMs: number, max: number): Promise<RateLimiter> {
  try {
    // Dynamic import: only resolves if @upstash/ratelimit and @upstash/redis are installed.
    // If not installed, falls through to the catch block and uses in-memory.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rlMod, redisMod]: [any, any] = await Promise.all([
      // @vite-ignore
      eval("import('@upstash/ratelimit')"),
      // @vite-ignore
      eval("import('@upstash/redis')"),
    ])
    const { Ratelimit } = rlMod
    const { Redis } = redisMod

    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(max, `${Math.ceil(windowMs / 1000)} s`),
      analytics: false,
    })

    return {
      async check(identifier: string): Promise<RateLimitResult> {
        const { success, remaining, reset } = await ratelimit.limit(identifier)
        return { ok: success, remaining, resetAt: Number(reset) }
      },
    }
  } catch {
    // Package not installed or Redis unavailable — fall back to in-memory
    console.warn('[rate-limit] Upstash packages not available, using in-memory fallback')
    return makeInMemoryLimiter(windowMs, max)
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

const _limiterCache = new Map<string, RateLimiter>()

/**
 * Creates (or returns cached) a rate limiter.
 * Automatically uses Redis when UPSTASH_REDIS_REST_URL is set.
 */
export function rateLimit(opts: { windowMs: number; max: number }): RateLimiter {
  const cacheKey = `${opts.windowMs}:${opts.max}`

  if (_limiterCache.has(cacheKey)) {
    return _limiterCache.get(cacheKey)!
  }

  const useRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)

  let limiter: RateLimiter

  if (useRedis) {
    // Create a proxy that lazily initializes the Redis limiter on first call
    let _resolved: RateLimiter | null = null
    let _promise: Promise<RateLimiter> | null = null

    limiter = {
      async check(identifier: string): Promise<RateLimitResult> {
        if (!_resolved) {
          if (!_promise) _promise = makeRedisLimiter(opts.windowMs, opts.max)
          _resolved = await _promise
        }
        return _resolved.check(identifier)
      },
    }
  } else {
    limiter = makeInMemoryLimiter(opts.windowMs, opts.max)
  }

  _limiterCache.set(cacheKey, limiter)
  return limiter
}

// ── Pre-configured limiters ───────────────────────────────────────────────

/** 5 requests / minute — login, forgot-password */
export const authLimiter = rateLimit({ windowMs: 60_000, max: 5 })

/** 3 requests / 10 minutes — registration submission */
export const registrationLimiter = rateLimit({ windowMs: 60_000 * 10, max: 3 })

/** 60 requests / minute — general authenticated API */
export const apiLimiter = rateLimit({ windowMs: 60_000, max: 60 })

/** 10 requests / minute — export (heavy queries) */
export const exportLimiter = rateLimit({ windowMs: 60_000, max: 10 })
