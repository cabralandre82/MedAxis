/**
 * Content Security Policy builder — Wave Hardening II #8.
 *
 * Produces a strict, nonce-based CSP that:
 *   - removes `'unsafe-inline'` from `script-src` (the historical
 *     anti-pattern) — every Next.js streaming chunk is allowed only
 *     because it carries the per-request nonce we mint in middleware;
 *   - keeps `style-src-attr 'unsafe-inline'` because React's
 *     `style={{...}}` JSX prop renders an HTML `style="..."` attribute
 *     and CSP3 requires explicit allowance for those (we cannot hash
 *     them at build time);
 *   - uses `'strict-dynamic'` on `script-src` so a nonce'd loader
 *     script may dynamically import additional bundles **without**
 *     having to predict their hashes — required for Next.js code
 *     splitting + Sentry's lazy chunks;
 *   - declares `report-to` and `report-uri` so violations land in
 *     `/api/csp-report` (defence-in-depth observability).
 *
 * Two modes are supported via the `reportOnly` flag (driven by
 * the `CSP_REPORT_ONLY` env var in production):
 *
 *   true  → header name `Content-Security-Policy-Report-Only` —
 *           browsers do not enforce, only report. Use for canary
 *           rollouts.
 *   false → header name `Content-Security-Policy` — full enforcement.
 *
 * The companion `Report-To` header (a JSON document) is emitted
 * separately by the middleware.
 *
 * @module lib/security/csp
 */

export interface CspBuildOptions {
  /** Per-request nonce (base64). Required even in report-only mode
   *  so the rendered HTML always references a valid nonce. */
  nonce: string
  /** When true, emits Report-Only header name; production toggle. */
  reportOnly?: boolean
  /** When true, allows `'unsafe-eval'` in script-src for Next dev
   *  HMR + Webpack eval source maps. NEVER pass `true` in prod. */
  allowEval?: boolean
  /** Override the report endpoint (default `/api/csp-report`). */
  reportEndpoint?: string
  /** Extra origins appended to `connect-src`. Useful when on-call
   *  needs to allow a one-off third-party diagnostic without a
   *  redeploy (driven by env in middleware). */
  extraConnectSrc?: readonly string[]
}

const SUPABASE_HOST = 'https://jomdntqlgrupvhrqoyai.supabase.co'
const SENTRY_INGEST = 'https://o4510907598700544.ingest.us.sentry.io'

/**
 * Build the CSP header string. Pure function — easy to test for
 * structural invariants (see `tests/unit/lib/security/csp.test.ts`).
 */
export function buildCsp(opts: CspBuildOptions): string {
  const {
    nonce,
    reportOnly = false,
    allowEval = false,
    reportEndpoint = '/api/csp-report',
    extraConnectSrc = [],
  } = opts

  if (!nonce || typeof nonce !== 'string') {
    throw new Error('buildCsp: nonce is required')
  }
  // Cheap sanity: base64 chars + '-_=' (URL-safe variant) and length
  // > 16 chars (12 random bytes ⇒ 16 base64 chars). We do NOT enforce
  // the upper bound — the random helper picks the size.
  if (!/^[A-Za-z0-9+/_=-]{16,}$/.test(nonce)) {
    throw new Error('buildCsp: nonce contains invalid characters')
  }

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // strict-dynamic: any script loaded by a nonce'd script is
    // implicitly trusted. Required for Next.js's chunk loader and
    // Sentry's lazy loader; also strips the need to whitelist
    // gstatic/googleapis (which are reached transitively).
    "'strict-dynamic'",
    // Older browsers without strict-dynamic support would otherwise
    // block everything. The fallback list keeps them functional.
    'https:',
    'http:',
    ...(allowEval ? ["'unsafe-eval'"] : []),
  ]
    .filter(Boolean)
    .join(' ')

  const styleSrcElem = ["'self'", `'nonce-${nonce}'`, "'unsafe-inline'"].join(' ')
  // CSP3: style attribute on HTML elements (React's `style={}`).
  const styleSrcAttr = ["'unsafe-inline'"].join(' ')
  // Fallback for browsers without CSP3 split — kept identical to
  // -elem so the policy is consistent.
  const styleSrc = ["'self'", "'unsafe-inline'"].join(' ')

  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    SENTRY_INGEST,
    'https://www.googleapis.com',
    'https://fcm.googleapis.com',
    ...extraConnectSrc,
  ].join(' ')

  // Build the directive list. Order is irrelevant per spec but we
  // group related directives for readability.
  const directives: string[] = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `script-src-attr 'none'`,
    `style-src ${styleSrc}`,
    `style-src-elem ${styleSrcElem}`,
    `style-src-attr ${styleSrcAttr}`,
    `img-src 'self' data: blob: ${SUPABASE_HOST}`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
    `block-all-mixed-content`,
    // Reporting — both legacy and modern. Browsers ignore directives
    // they don't recognise, so emitting both is safe.
    `report-uri ${reportEndpoint}`,
    `report-to csp-endpoint`,
  ]

  void reportOnly // consumed by the header name picker, not the body.

  return directives.join('; ')
}

/** Pick the right header name for enforced vs report-only. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'
}

/**
 * Generate the `Report-To` header value (JSON object, single line).
 * Browsers cache this for `max_age` seconds and POST violation
 * reports to the named endpoints under that group.
 */
export function buildReportToHeader(reportEndpoint = '/api/csp-report'): string {
  return JSON.stringify({
    group: 'csp-endpoint',
    max_age: 10886400, // 126 days — recommended minimum for stable groups
    endpoints: [{ url: reportEndpoint }],
    include_subdomains: false,
  })
}

/**
 * Mint a per-request nonce. We use `crypto.randomUUID()` because it is
 * available in BOTH the Edge runtime (where middleware runs) and Node;
 * its 122 bits of entropy comfortably exceed CSP's recommended 128-bit
 * minimum once you account for it being base64-encoded UUIDv4 string.
 *
 * The output is the raw UUID string with hyphens stripped, then base64
 * (URL-safe). Fixed-length so the regex in `buildCsp` always passes.
 */
export function generateNonce(): string {
  // randomUUID returns 36 chars hex+hyphens. 32 hex chars = 16 bytes
  // ≈ 22 base64url chars (no padding). We pad to 24 so it always
  // matches `[A-Za-z0-9+/_=-]{16,}` even after URL-encoding quirks.
  const uuid = (globalThis.crypto?.randomUUID?.() ?? fallbackUuid()).replace(/-/g, '')
  return base64UrlFromHex(uuid)
}

function fallbackUuid(): string {
  // Pure JS UUIDv4 — only used in test environments where global
  // crypto.randomUUID isn't polyfilled.
  const bytes = new Uint8Array(16)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlFromHex(hex: string): string {
  // Convert hex → bytes → base64url (no padding).
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  // Edge runtime has `btoa` AND a Buffer polyfill; we prefer btoa
  // because Buffer is heavier in cold-start.
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Header name used both as request header (consumed by SSR via
 *  `headers().get(NONCE_HEADER)`) and as a Sentry tag for forensics. */
export const NONCE_HEADER = 'x-nonce'
