/**
 * Content Security Policy violation report endpoint.
 *
 * Browsers POST here whenever a directive declared in our CSP header
 * is violated. Two payload formats are supported because the spec
 * is in transition:
 *
 *   1. Legacy `report-uri` directive — single JSON object wrapped in
 *      `{"csp-report": {...}}`, content-type `application/csp-report`
 *      (Chromium ≤ 95, all current Safari/Firefox).
 *   2. Modern `Reporting API` (`Report-To` header + `report-to`
 *      directive) — JSON array of `{ type:"csp-violation", body:{...} }`
 *      objects, content-type `application/reports+json` (Chromium 96+).
 *
 * The endpoint is public on purpose (CSP reports are sent without
 * credentials) but is protected against abuse by:
 *
 *   • a per-IP rate limiter (10 reports / 10 s — bursty for a freshly
 *     loaded page is normal, but anything beyond is dropped);
 *   • a 16 KiB body cap (a CSP report is ~500-2000 bytes; anything
 *     larger is almost certainly an attempt to flood `server_logs`);
 *   • bounded label cardinality on the metric (`directive` and
 *     `blocked_host`-truncated-to-host) so a malicious page cannot
 *     blow up Prometheus storage by reporting random URIs.
 *
 * Persistence: violations are written via `logger.warn(...)`, which
 * the Wave 1 logger pipeline already mirrors into `public.server_logs`
 * with a 90-day retention window (RP-09 in `lib/retention/policies.ts`).
 *
 * Always returns 204 — the browser does not act on the response and
 * a 4xx/5xx would just generate console noise on legitimate users.
 *
 * @module app/api/csp-report/route
 */

import { NextRequest, NextResponse } from 'next/server'
import { incCounter, Metrics } from '@/lib/metrics'
import { logger } from '@/lib/logger'
import { extractClientIp, guard, rateLimit } from '@/lib/rate-limit'
import { parseReports } from '@/lib/security/csp-report'

// Edge runtime would be ideal (lower cold-start) but the logger
// pipeline writes through `createAdminClient`, which uses Node-only
// modules. Run on Node — cold-start cost is negligible because this
// route is hit asynchronously by the browser after the main request
// completes.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ~16 KiB body cap. A typical CSP report is < 2 KiB; this leaves
 *  generous headroom for unusual cases (e.g. very long source files
 *  in `script-sample`) while preventing log-flood DoS. */
const MAX_BODY_BYTES = 16 * 1024

/** Bucket name surfaced in `rate_limit_violations.bucket`. */
const RL_BUCKET = 'security.csp_report'

/** 10 reports per 10 seconds per IP. Generous enough that a single
 *  page load with multiple violations does not get throttled, but
 *  tight enough that a sustained flood (1000+ /min) gets dropped. */
const cspReportLimiter = rateLimit({ windowMs: 10_000, max: 10 })

// Parser, types and supporting helpers live in
// `lib/security/csp-report.ts` because Next.js route files only allow
// a fixed set of exported symbols (`runtime`, `dynamic`, HTTP method
// handlers); exporting `parseReports` here would fail the build.

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate-limit BEFORE reading the body — a hostile client could
  // POST 16 KiB chunks repeatedly to chew up CPU otherwise.
  const denied = await guard(req, cspReportLimiter, RL_BUCKET)
  if (denied) {
    // Still return 204 so the browser stops retrying. We don't want
    // legitimate users to see console errors caused by their own
    // bursty traffic.
    return new NextResponse(null, { status: 204 })
  }

  // Body cap. Reading via `req.text()` because both `application/csp-report`
  // and `application/reports+json` are technically JSON but Next.js's
  // `req.json()` would 415 on the former content-type.
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'body_too_large' })
    return new NextResponse(null, { status: 204 })
  }

  let raw = ''
  try {
    raw = await req.text()
  } catch {
    incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'body_read_error' })
    return new NextResponse(null, { status: 204 })
  }
  if (raw.length > MAX_BODY_BYTES) {
    incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'body_too_large_post_read' })
    return new NextResponse(null, { status: 204 })
  }

  const reports = parseReports(raw)
  const ip = extractClientIp(req)
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 256)

  for (const r of reports) {
    incCounter(Metrics.CSP_VIOLATION_TOTAL, {
      directive: r.directive,
      blocked_host: r.blockedHost,
      disposition: r.disposition ?? 'enforce',
    })

    // Classify whether this violation is actionable on our end.
    //
    // Two violations dominate the noise floor and are NOT caused by
    // app code:
    //
    //   1. `style-src-elem 'inline'` from /_next/static/chunks/*.js —
    //      Next.js's CSS streaming injects unnonced <style> blocks
    //      into the streamed HTML; even with `'unsafe-inline'` in
    //      the directive, CSP3 ignores it whenever `'nonce-XXX'` is
    //      also present (the nonce promotes the policy to strict).
    //   2. `script-src 'eval'` from the same chunk path — third-party
    //      libs bundled by Next use `new Function()` / `eval` as part
    //      of their normal operation (sourcemap decoders, JSON
    //      schema compilers, etc).
    //
    // Both are well-documented limitations of Next.js + nonce CSP
    // and would require a bundler-level fix that is out of scope
    // for the runtime. We keep the metric counters firing so the
    // dashboards still show the rate, but log the line at INFO so
    // the operator's "warn/error" feed is not drowned in noise that
    // demands no action. Anything *outside* of /_next/static/chunks
    // (e.g. an inline style we shipped, an external script that
    // showed up in dev-tools) still warns — that one IS our bug.
    const fromVendorChunk = (r.sourceFile ?? '').includes('/_next/static/chunks/')
    const isKnownVendorNoise =
      fromVendorChunk &&
      ((r.directive === 'style-src-elem' && r.blockedHost === 'inline') ||
        (r.directive === 'script-src' && r.blockedHost === 'eval'))

    const payload = {
      module: 'security.csp',
      action: 'csp_violation',
      directive: r.directive,
      effective_directive: r.effectiveDirective,
      violated_directive: r.violatedDirective,
      blocked_uri: r.blockedUri,
      blocked_host: r.blockedHost,
      document_uri: r.documentUri,
      source_file: r.sourceFile,
      line: r.lineNumber,
      column: r.columnNumber,
      script_sample: r.scriptSample,
      disposition: r.disposition,
      status_code: r.statusCode,
      format: r.format,
      // ip is stored as-is in the local log line (the logger redactor
      // does not touch it because it isn't a known PII pattern), but
      // any downstream archive that ages out keeps the per-policy
      // retention window.
      reporter_ip: ip,
      user_agent: userAgent,
      noise_class: isKnownVendorNoise ? 'next_vendor_bundle' : undefined,
    }

    if (isKnownVendorNoise) {
      logger.info('csp_violation', payload)
    } else {
      logger.warn('csp_violation', payload)
    }
  }

  return new NextResponse(null, { status: 204 })
}

// Some browsers preflight CSP report POSTs with OPTIONS. Reply 204
// to keep the browser quiet.
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
