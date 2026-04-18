/**
 * CSRF defence — Wave 5.
 *
 * Threat model. Supabase stores auth state in cookies with `SameSite=Lax`.
 * Modern browsers already refuse to send those cookies on cross-site
 * `POST form` submissions, which stops trivial CSRF. Three residual gaps
 * justify a dedicated layer:
 *
 *   1. `SameSite=Lax` cookies ARE sent on top-level GET navigations. A
 *      state-changing API that wrongly accepts GET could be exploited
 *      by `<img src="https://app/api/foo?delete=true">`.
 *   2. Legacy browsers (Safari < 13 mobile, WebViews) honour `SameSite=None`
 *      on all verbs. We can't rely on cookie semantics alone.
 *   3. Our own Server Actions plus custom JSON APIs execute under the
 *      same cookie and could be triggered from an attacker-controlled
 *      origin if our Origin check ever regresses.
 *
 * Strategy: enforce at the edge (middleware) for any state-changing
 * request hitting `/api/**` that is NOT a webhook (those have their own
 * HMAC/token auth). Two-tier enforcement:
 *
 *   - **Always on:** strict Origin / Referer match. Any same-cookie
 *     mutation must prove it came from our own origin. Cost: O(1) header
 *     compare.
 *   - **Opt-in (`security.csrf_enforce` flag):** double-submit cookie.
 *     We set a `__Host-csrf` cookie (`SameSite=Strict`, `Secure`, `Path=/`)
 *     on GET navigations and require the client to echo it on mutating
 *     requests via the `X-CSRF-Token` header. Verified with
 *     `timingSafeEqual`.
 *
 * When the flag is OFF we already log every Origin-mismatch denial so
 * the observability graph shows where new API clients would break when
 * the flag flips ON.
 *
 * @module lib/security/csrf
 */

import type { NextRequest, NextResponse } from 'next/server'

/** Name of the double-submit cookie in production (HTTPS). The
 *  `__Host-` prefix enforces `Secure`, no `Domain`, and `Path=/` at the
 *  browser layer — any attempt to set it from JS without those is
 *  silently dropped. */
export const CSRF_COOKIE = '__Host-csrf'

/** Name of the double-submit cookie in dev/test (plain HTTP). The
 *  `__Host-` prefix would be rejected by the browser on http://
 *  because it requires Secure. We use a distinct name so a leaked dev
 *  cookie can never be presented as a prod cookie. */
export const CSRF_COOKIE_DEV = 'csrf-token'

/** Name of the mirror header the client must echo. */
export const CSRF_HEADER = 'x-csrf-token'

/** Verbs that require CSRF protection. GET/HEAD/OPTIONS are safe by
 *  construction (they must not mutate state — anything that does is
 *  already a bug we'd want to see). */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Paths that are allowed to skip CSRF — webhooks and Inngest serve,
 *  which authenticate via HMAC / signing-key instead. Tracked centrally
 *  so the middleware only has one source of truth. */
const CSRF_EXEMPT_PREFIXES = [
  '/api/payments/asaas/webhook',
  '/api/contracts/webhook',
  '/api/inngest',
  // Cron routes call from Vercel with CRON_SECRET, no cookie session.
  '/api/cron/',
  // Tracking endpoint is used from email/SMS out-of-band; no cookie.
  '/api/tracking',
  // Public health — GET only anyway, but be explicit.
  '/api/health',
]

export interface CsrfDecision {
  /** `true` when the request is allowed through; `false` when we must refuse. */
  ok: boolean
  /** Machine-readable reason for the denial (used in logs + runbooks). */
  reason?:
    | 'skip_safe_method'
    | 'skip_exempt_path'
    | 'skip_flag_off'
    | 'origin_missing'
    | 'origin_mismatch'
    | 'token_missing'
    | 'token_mismatch'
  /** Human-readable details echoed to the server log. Never exposed to
   *  the client — avoid leaking the expected token value. */
  details?: string
}

function matchesExemptPath(pathname: string): boolean {
  for (const prefix of CSRF_EXEMPT_PREFIXES) {
    if (pathname.startsWith(prefix)) return true
  }
  return false
}

/** Parse an Origin or Referer header into a bare origin string, or null
 *  if malformed. */
function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

/**
 * Ensure `Origin` (or fallback `Referer`) matches the request URL's own
 * origin OR one of the allowlisted extras from `ALLOWED_ORIGINS`
 * (comma-separated env var — lets staging accept requests from a custom
 * preview domain if needed, without weakening prod).
 */
export function isSameOriginRequest(req: NextRequest): CsrfDecision {
  const requestOrigin = new URL(req.url).origin
  const header = req.headers.get('origin') ?? req.headers.get('referer')
  const claimed = parseOrigin(header)

  if (!claimed) {
    return {
      ok: false,
      reason: 'origin_missing',
      details: 'Neither Origin nor Referer header present on a state-changing request.',
    }
  }

  if (claimed === requestOrigin) {
    return { ok: true }
  }

  const extras = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (extras.includes(claimed)) {
    return { ok: true }
  }

  return {
    ok: false,
    reason: 'origin_mismatch',
    details: `Origin "${claimed}" does not match request origin "${requestOrigin}".`,
  }
}

/**
 * Constant-time compare of two same-length strings. Implemented on
 * top of Web Crypto-compatible primitives so the module works in
 * both the Edge (middleware) and Node runtimes without conditional
 * imports.
 *
 * XOR accumulator defeats early-exit on first mismatch.
 */
function constantTimeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  if (a.length === 0) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

function pickCookieName(req: NextRequest): string {
  // Cookie naming follows scheme: prod (HTTPS) uses __Host-csrf which
  // browsers refuse to store without Secure; dev (HTTP) uses the
  // plain-named fallback. The server accepts whichever is present so
  // the frontend can read a stable name via `getCsrfCookie()` below.
  return req.url.startsWith('https://') ? CSRF_COOKIE : CSRF_COOKIE_DEV
}

/**
 * Verify the double-submit pattern: cookie value must equal the
 * `X-CSRF-Token` header. Constant-time compare defends against
 * timing oracles.
 */
export function verifyDoubleSubmit(req: NextRequest): CsrfDecision {
  const cookieName = pickCookieName(req)
  const cookieValue =
    req.cookies.get(cookieName)?.value ??
    req.cookies.get(CSRF_COOKIE)?.value ??
    req.cookies.get(CSRF_COOKIE_DEV)?.value ??
    ''
  const headerValue = req.headers.get(CSRF_HEADER) ?? ''

  if (!cookieValue || !headerValue) {
    return {
      ok: false,
      reason: 'token_missing',
      details: `Missing ${!cookieValue ? 'cookie' : 'header'} for double-submit check.`,
    }
  }

  if (cookieValue.length !== headerValue.length) {
    return { ok: false, reason: 'token_mismatch', details: 'Token length mismatch.' }
  }

  if (!constantTimeEqualString(cookieValue, headerValue)) {
    return { ok: false, reason: 'token_mismatch', details: 'Tokens differ.' }
  }

  return { ok: true }
}

/** Generate a new CSRF token. 32 bytes of entropy (256 bits) → 64 hex chars.
 *  Uses Web Crypto (`crypto.getRandomValues`) so the call works in both
 *  Edge and Node runtimes. */
export function issueCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Ensure the response carries a CSRF cookie. Idempotent: if the request
 * already has one we keep it; otherwise we mint a fresh one and attach
 * it to the response. Called on safe navigations (GET) so the cookie is
 * primed before the first unsafe request arrives.
 *
 * Writes the `__Host-csrf` cookie with:
 *   - `Path=/`          required by the __Host- prefix;
 *   - `Secure`          required by the __Host- prefix;
 *   - `SameSite=Strict` cookie never sent on any cross-site request;
 *   - `HttpOnly=false`  **intentionally**. The whole point of double-
 *                       submit is that the client JS reads the cookie
 *                       and echoes it back via header. HttpOnly would
 *                       defeat that.
 */
export function ensureCsrfCookie(req: NextRequest, res: NextResponse): string {
  const isHttps = req.url.startsWith('https://')
  const cookieName = isHttps ? CSRF_COOKIE : CSRF_COOKIE_DEV
  const existing = req.cookies.get(cookieName)?.value
  if (existing && existing.length === 64) return existing

  const token = issueCsrfToken()
  res.cookies.set(cookieName, token, {
    path: '/',
    secure: isHttps,
    sameSite: 'strict',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 7,
  })
  return token
}

/**
 * Top-level gate used by middleware. The `enforceDoubleSubmit` flag is
 * driven by the `security.csrf_enforce` feature flag at the caller; we
 * accept it as a boolean to keep this module free of DB imports and
 * safe for both edge and Node runtimes.
 */
export function checkCsrf(
  req: NextRequest,
  { enforceDoubleSubmit = false }: { enforceDoubleSubmit?: boolean } = {}
): CsrfDecision {
  if (!UNSAFE_METHODS.has(req.method)) {
    return { ok: true, reason: 'skip_safe_method' }
  }

  const { pathname } = new URL(req.url)
  if (matchesExemptPath(pathname)) {
    return { ok: true, reason: 'skip_exempt_path' }
  }

  // Only guard /api/** at this layer. Server Actions are already gated
  // by Next's built-in Origin check (Next 15+).
  if (!pathname.startsWith('/api/')) {
    return { ok: true, reason: 'skip_exempt_path' }
  }

  const originCheck = isSameOriginRequest(req)
  if (!originCheck.ok) return originCheck

  if (enforceDoubleSubmit) {
    const tokenCheck = verifyDoubleSubmit(req)
    if (!tokenCheck.ok) return tokenCheck
  }

  return { ok: true }
}

/** Test-only. */
export const _internal = {
  CSRF_EXEMPT_PREFIXES,
  UNSAFE_METHODS,
}
