/**
 * Rate limiter with Redis-ready abstraction + persistent violation ledger.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Backend selection (automatic, zero config change):     │
 * │                                                         │
 * │  UPSTASH_REDIS_REST_URL set  → Upstash Redis (sliding   │
 * │                                window, multi-instance)  │
 * │  Not set                     → In-memory (single        │
 * │                                instance, dev/staging)   │
 * └─────────────────────────────────────────────────────────┘
 *
 * To activate Redis in production: set these on Vercel
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=AXxx...
 * Then: `npm install @upstash/ratelimit @upstash/redis`
 *
 * Wave 10 adds three responsibilities on top of the Wave 5
 * primitives:
 *
 *   1. Every 429 now writes a row to `public.rate_limit_violations`
 *      via the SECURITY DEFINER RPC `rate_limit_record`. The IP is
 *      SHA-256 hashed with `RATE_LIMIT_IP_SALT` so the table is
 *      LGPD-safe and can be retained for 30 days of forensics
 *      without being subject to data-subject access requests.
 *
 *   2. A `guard()` convenience returns a ready-made 429
 *      `NextResponse` with `Retry-After` + `X-RateLimit-*`
 *      headers, so route authors don't have to reimplement the
 *      HTTP contract every time.
 *
 *   3. Structured metric emissions — `rate_limit_hits_total` and
 *      `rate_limit_denied_total` with a `bucket` label — so
 *      Wave 6's Prometheus exposition and Wave 10's cron report
 *      can tell "who's being spammed" from a single query.
 *
 * The existing pre-configured limiters (`authLimiter`,
 * `apiLimiter`, `registrationLimiter`, `exportLimiter`) keep
 * their old API. They now transparently benefit from
 * persistence+metrics because the work happens inside
 * `rateLimit()`.
 *
 * Usage:
 *
 *     const denied = await guard(req, authLimiter, 'auth.forgot')
 *     if (denied) return denied
 *
 * Or the manual form (if you need custom error shape):
 *
 *     const result = await authLimiter.check('ip:1.2.3.4')
 *     if (!result.ok) return NextResponse.json(..., { status: 429 })
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram } from '@/lib/metrics'
import { Metrics } from '@/lib/metrics'

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
  /** Total window in ms, used to compute X-RateLimit-Reset headers. */
  windowMs: number
  /** Max hits allowed in the window, used for X-RateLimit-Limit. */
  limit: number
}

export interface RateLimiter {
  check(identifier: string): Promise<RateLimitResult>
  /** Opaque metadata so guard() can render consistent headers. */
  readonly windowMs: number
  readonly limit: number
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
    windowMs,
    limit: max,
    async check(identifier: string): Promise<RateLimitResult> {
      const now = Date.now()
      const existing = _store.get(identifier)

      if (!existing || existing.resetAt <= now) {
        const resetAt = now + windowMs
        _store.set(identifier, { count: 1, resetAt })
        return { ok: true, remaining: max - 1, resetAt, windowMs, limit: max }
      }

      if (existing.count >= max) {
        return { ok: false, remaining: 0, resetAt: existing.resetAt, windowMs, limit: max }
      }

      existing.count++
      return {
        ok: true,
        remaining: max - existing.count,
        resetAt: existing.resetAt,
        windowMs,
        limit: max,
      }
    },
  }
}

// ── Redis backend (lazy-loaded when env vars are present) ─────────────────

/**
 * Builds an Upstash Redis limiter at runtime. Wrapped in a
 * function + a dynamic import so the whole thing compiles even
 * when `@upstash/*` is not installed (local dev, CI, staging).
 *
 * We use `// @ts-expect-error` rather than `eval("import(...)")`
 * because TS is fine with the "module possibly missing" shape
 * and webpack/turbopack can tree-shake correctly.
 */
async function makeRedisLimiter(windowMs: number, max: number): Promise<RateLimiter> {
  try {
    // The packages now live in package.json (production dep, not
    // optional). Use plain `await import()` so the bundler can
    // resolve them statically — the historical `new Function('s',
    // 'return import(s)')` workaround was failing in Vercel's
    // production runtime ("Upstash packages not available, using
    // in-memory fallback" warn on every request after deploy
    // 2026-04-29) because the dynamic resolver could not find the
    // module path at runtime even when the package was bundled.
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import('@upstash/ratelimit'),
      import('@upstash/redis'),
    ])

    const ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(max, `${Math.ceil(windowMs / 1000)} s`),
      analytics: false,
    })

    return {
      windowMs,
      limit: max,
      async check(identifier: string): Promise<RateLimitResult> {
        const { success, remaining, reset } = await ratelimit.limit(identifier)
        return { ok: success, remaining, resetAt: Number(reset), windowMs, limit: max }
      },
    }
  } catch (err) {
    // Now that the packages are first-class deps, hitting this branch
    // is a genuine misconfiguration (bundler stripped them, env vars
    // pointing at an unreachable Redis, etc). Surface the underlying
    // error in the log line — silent fallback was masking the cause.
    logger.warn('Upstash limiter init failed — falling back to in-memory', {
      module: 'rate-limit',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : undefined,
    })
    return makeInMemoryLimiter(windowMs, max)
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

const _limiterCache = new Map<string, RateLimiter>()

/**
 * Creates (or returns cached) a rate limiter. Automatically uses
 * Redis when `UPSTASH_REDIS_REST_URL` is set.
 */
export function rateLimit(opts: { windowMs: number; max: number }): RateLimiter {
  const cacheKey = `${opts.windowMs}:${opts.max}`

  if (_limiterCache.has(cacheKey)) {
    return _limiterCache.get(cacheKey)!
  }

  const useRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)

  let limiter: RateLimiter

  if (useRedis) {
    let _resolved: RateLimiter | null = null
    let _promise: Promise<RateLimiter> | null = null

    limiter = {
      windowMs: opts.windowMs,
      limit: opts.max,
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

/** 3 requests / hour — LGPD data-subject forms (deletion, rectification). */
export const lgpdFormLimiter = rateLimit({ windowMs: 60_000 * 60, max: 3 })

/** 5 requests / hour — LGPD data export (heavy PII query + HMAC sign). */
export const lgpdExportLimiter = rateLimit({ windowMs: 60_000 * 60, max: 5 })

// ── IP hashing (LGPD-safe persistence) ────────────────────────────────────

/**
 * Extract the client IP from a Next request, trusting
 * `x-forwarded-for` (Vercel terminates TLS and sets this header;
 * the Edge runtime strips spoofed values).
 *
 * Returns `'unknown'` rather than null because we want to *still*
 * rate-limit anonymous sources — binning every "unknown" caller
 * into a single bucket is strictly safer than letting them in.
 */
export function extractClientIp(req: NextRequest | Request): string {
  const headers = (req as Request).headers
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

/**
 * SHA-256(ip || salt) — hex-encoded, lowercase, 64 chars.
 *
 * The salt must come from `RATE_LIMIT_IP_SALT` env var; if
 * missing we use a sentinel string (so dev still works) and warn
 * loudly so the ops team notices in staging. A short/missing
 * salt just reduces the attacker's cost-of-preimage; the table
 * is still not a CPF/email honeypot.
 */
export function hashIp(ip: string): string {
  const salt =
    process.env.RATE_LIMIT_IP_SALT ??
    (() => {
      // Emit only once per process. logger.warn is cheap and the
      // global flag prevents flooding.
      const g = globalThis as Record<string, unknown>
      if (!g.__rate_limit_salt_warned) {
        g.__rate_limit_salt_warned = true
        logger.warn('RATE_LIMIT_IP_SALT not set — IP hashes are predictable', {
          module: 'rate-limit',
        })
      }
      return 'clinipharma-default-rate-limit-salt-set-me'
    })()
  return createHash('sha256').update(`${ip}::${salt}`).digest('hex')
}

// ── Persistence ───────────────────────────────────────────────────────────

/**
 * Best-effort insert into `public.rate_limit_violations` via the
 * `rate_limit_record` RPC. Failures are logged and swallowed —
 * the ledger is an observability tool, not a critical path.
 *
 * Kept out of the hot path by not awaiting inside `guard()`; the
 * caller decides whether to `void` the promise. In practice the
 * Supabase RTT in-region is ~5-10 ms so awaiting is fine too.
 */
export async function recordViolation(args: {
  bucket: string
  ipHash: string
  userId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/db/admin')
    const admin = createAdminClient()
    const { error } = await admin.rpc('rate_limit_record', {
      p_bucket: args.bucket,
      p_ip_hash: args.ipHash,
      p_user_id: args.userId ?? null,
      p_metadata: args.metadata ?? {},
    })
    if (error) {
      logger.warn('rate_limit_record RPC failed', {
        module: 'rate-limit',
        bucket: args.bucket,
        error: error.message,
      })
    }
  } catch (err) {
    // Don't block response on observability plumbing.
    logger.warn('rate_limit_record import/call threw', {
      module: 'rate-limit',
      bucket: args.bucket,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── HTTP guard ────────────────────────────────────────────────────────────

/**
 * Standard headers applied to every rate-limited response so
 * clients can implement exponential backoff without guessing.
 * Spec: draft-ietf-httpapi-ratelimit-headers.
 */
function buildHeaders(result: RateLimitResult): HeadersInit {
  const now = Date.now()
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - now) / 1000))
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.ok ? {} : { 'Retry-After': String(retryAfterSec) }),
  }
}

export interface GuardOptions {
  /**
   * Stable bucket name logged into `rate_limit_violations`.
   * Must match a `Bucket.*` constant below so cron reports can
   * group consistently.
   */
  bucket: string
  /**
   * Identifier override. Default: `"{bucket}:{ip}"`. Pass a
   * user-scoped key (e.g. `"lgpd.export:user:${uid}"`) when the
   * limit should be per-account rather than per-IP — crucial
   * for authenticated flows where a shared NAT gateway could
   * otherwise DoS one tenant with another tenant's traffic.
   */
  identifier?: string
  /** Attached to the violation row's `metadata_json` for forensics. */
  userId?: string | null
  /** Custom JSON body. Defaults to RFC 7807 problem+json shape. */
  body?: Record<string, unknown>
}

/**
 * Returns a 429 NextResponse if the request would be rejected,
 * or `null` to continue. Also:
 *   • emits `rate_limit_hits_total{bucket,outcome}` counter
 *   • emits `rate_limit_check_duration_ms{bucket}` histogram
 *   • persists a violation row on deny via `recordViolation()`.
 *
 * The function never throws. If the limiter itself errors we
 * "fail open" (allow the request) rather than risk masking a
 * legitimate outage as a 429 storm.
 */
export async function guard(
  req: NextRequest | Request,
  limiter: RateLimiter,
  optsOrBucket: GuardOptions | string
): Promise<NextResponse | null> {
  const opts: GuardOptions =
    typeof optsOrBucket === 'string' ? { bucket: optsOrBucket } : optsOrBucket

  const ip = extractClientIp(req)
  const identifier = opts.identifier ?? `${opts.bucket}:${ip}`

  const t0 = Date.now()
  let result: RateLimitResult
  try {
    result = await limiter.check(identifier)
  } catch (err) {
    logger.warn('rate-limit check threw; failing open', {
      module: 'rate-limit',
      bucket: opts.bucket,
      error: err instanceof Error ? err.message : String(err),
    })
    incCounter(Metrics.RATE_LIMIT_HITS_TOTAL, { bucket: opts.bucket, outcome: 'error' })
    return null
  } finally {
    observeHistogram(Metrics.RATE_LIMIT_CHECK_DURATION_MS, Date.now() - t0, {
      bucket: opts.bucket,
    })
  }

  incCounter(Metrics.RATE_LIMIT_HITS_TOTAL, {
    bucket: opts.bucket,
    outcome: result.ok ? 'allowed' : 'denied',
  })

  if (result.ok) return null

  // Persist and alert asynchronously. We `void` the promise
  // rather than awaiting — the ledger is P2 observability data,
  // not part of the response contract.
  void recordViolation({
    bucket: opts.bucket,
    ipHash: hashIp(ip),
    userId: opts.userId ?? null,
    metadata: {
      ua:
        typeof (req as Request).headers?.get === 'function'
          ? ((req as Request).headers.get('user-agent')?.slice(0, 200) ?? null)
          : null,
      path:
        typeof (req as NextRequest).nextUrl?.pathname === 'string'
          ? (req as NextRequest).nextUrl.pathname
          : null,
    },
  })
  incCounter(Metrics.RATE_LIMIT_DENIED_TOTAL, { bucket: opts.bucket })

  const body = opts.body ?? {
    type: 'about:blank',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Você fez muitas tentativas. Aguarde e tente novamente.',
    bucket: opts.bucket,
  }

  return NextResponse.json(body, {
    status: 429,
    headers: buildHeaders(result),
  })
}

// ── Bucket constants ──────────────────────────────────────────────────────

/**
 * Canonical bucket names. Call sites MUST use these instead of
 * raw strings so the cron `/api/cron/rate-limit-report` and the
 * Grafana dashboards keep working.
 */
export const Bucket = {
  AUTH_FORGOT: 'auth.forgot_password',
  AUTH_LOGIN: 'auth.login',
  AUTH_SIGNUP: 'auth.signup',
  REGISTER_SUBMIT: 'register.submit',
  REGISTER_DRAFT: 'register.draft',
  LGPD_DELETION: 'lgpd.deletion_request',
  LGPD_EXPORT: 'lgpd.export',
  LGPD_RECTIFICATION: 'lgpd.rectification',
  COUPON_ACTIVATE: 'coupon.activate',
  ORDER_PRESCRIPTION: 'order.prescription_upload',
  DOCUMENT_UPLOAD: 'document.upload',
  EXPORT_GENERIC: 'export.generic',
} as const

export type BucketKey = (typeof Bucket)[keyof typeof Bucket]
