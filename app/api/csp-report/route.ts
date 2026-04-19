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

interface NormalisedReport {
  directive: string
  blockedUri: string
  blockedHost: string
  documentUri: string
  effectiveDirective?: string
  violatedDirective?: string
  originalPolicy?: string
  disposition?: string
  statusCode?: number
  scriptSample?: string
  sourceFile?: string
  lineNumber?: number
  columnNumber?: number
  /** Source format flag for downstream forensics. */
  format: 'legacy' | 'reporting-api'
}

/**
 * Reduce an absolute URI to its host (or the literal directive
 * keyword like `inline` / `eval`). Browsers commonly report
 * `inline` / `eval` / `wasm-eval` for inline-script violations, in
 * which case the metric label is exactly the keyword. Otherwise we
 * keep only the host so the label cardinality is bounded by the
 * number of distinct origins talking to our app (small).
 */
function hostOf(value: string): string {
  if (!value) return 'unknown'
  if (/^(inline|eval|wasm-eval|data|blob)$/i.test(value)) return value.toLowerCase()
  try {
    return new URL(value).host || 'unknown'
  } catch {
    // Some browsers report e.g. `self` or scheme-only — keep the
    // raw token but truncate to avoid label explosion.
    return value.slice(0, 64)
  }
}

/** Normalise a single legacy `csp-report` payload. */
function fromLegacy(report: Record<string, unknown>): NormalisedReport | null {
  const violatedDirective = String(report['violated-directive'] ?? '')
  const effectiveDirective = String(report['effective-directive'] ?? '')
  const directive = (effectiveDirective || violatedDirective).split(' ')[0] ?? 'unknown'
  if (!directive) return null
  const blockedUri = String(report['blocked-uri'] ?? '')
  return {
    directive,
    blockedUri,
    blockedHost: hostOf(blockedUri),
    documentUri: String(report['document-uri'] ?? ''),
    effectiveDirective: effectiveDirective || undefined,
    violatedDirective: violatedDirective || undefined,
    originalPolicy:
      typeof report['original-policy'] === 'string'
        ? (report['original-policy'] as string).slice(0, 512)
        : undefined,
    disposition: typeof report.disposition === 'string' ? report.disposition : undefined,
    statusCode: typeof report['status-code'] === 'number' ? report['status-code'] : undefined,
    scriptSample:
      typeof report['script-sample'] === 'string'
        ? (report['script-sample'] as string).slice(0, 256)
        : undefined,
    sourceFile: typeof report['source-file'] === 'string' ? report['source-file'] : undefined,
    lineNumber: typeof report['line-number'] === 'number' ? report['line-number'] : undefined,
    columnNumber: typeof report['column-number'] === 'number' ? report['column-number'] : undefined,
    format: 'legacy',
  }
}

/** Normalise a single Reporting-API entry. */
function fromReportingApi(entry: Record<string, unknown>): NormalisedReport | null {
  if (entry.type !== 'csp-violation') return null
  const body = (entry.body as Record<string, unknown>) ?? {}
  const directive =
    String(body.effectiveDirective ?? body.violatedDirective ?? '').split(' ')[0] ?? 'unknown'
  if (!directive) return null
  const blockedUri = String(body.blockedURL ?? body.blockedUri ?? '')
  return {
    directive,
    blockedUri,
    blockedHost: hostOf(blockedUri),
    documentUri: String(body.documentURL ?? body.documentUri ?? ''),
    effectiveDirective:
      typeof body.effectiveDirective === 'string' ? body.effectiveDirective : undefined,
    violatedDirective:
      typeof body.violatedDirective === 'string' ? body.violatedDirective : undefined,
    originalPolicy:
      typeof body.originalPolicy === 'string'
        ? (body.originalPolicy as string).slice(0, 512)
        : undefined,
    disposition: typeof body.disposition === 'string' ? body.disposition : undefined,
    statusCode: typeof body.statusCode === 'number' ? body.statusCode : undefined,
    scriptSample:
      typeof body.sample === 'string' ? (body.sample as string).slice(0, 256) : undefined,
    sourceFile: typeof body.sourceFile === 'string' ? body.sourceFile : undefined,
    lineNumber: typeof body.lineNumber === 'number' ? body.lineNumber : undefined,
    columnNumber: typeof body.columnNumber === 'number' ? body.columnNumber : undefined,
    format: 'reporting-api',
  }
}

/** Parse a raw text body into 0+ normalised reports. Tolerant of
 *  malformed payloads — anything that fails to parse increments the
 *  `csp_report_invalid_total` counter and is dropped silently. */
export function parseReports(rawBody: string): NormalisedReport[] {
  if (!rawBody) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'json_parse' })
    return []
  }

  // Reporting API → array of entries
  if (Array.isArray(parsed)) {
    const out: NormalisedReport[] = []
    for (const entry of parsed) {
      if (entry && typeof entry === 'object') {
        const r = fromReportingApi(entry as Record<string, unknown>)
        if (r) out.push(r)
      }
    }
    if (out.length === 0) incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'empty_array' })
    return out
  }

  // Legacy report-uri → object with single `csp-report` key
  if (parsed && typeof parsed === 'object' && 'csp-report' in (parsed as object)) {
    const inner = (parsed as Record<string, unknown>)['csp-report']
    if (inner && typeof inner === 'object') {
      const r = fromLegacy(inner as Record<string, unknown>)
      return r ? [r] : []
    }
  }

  incCounter(Metrics.CSP_REPORT_INVALID_TOTAL, { reason: 'unknown_shape' })
  return []
}

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

    // logger.warn() is mirrored into `public.server_logs` (90-day
    // retention via RP-09). We deliberately do NOT include the
    // `originalPolicy` in the persisted log — it's verbose and the
    // current policy is recoverable from `lib/security/csp.ts`.
    logger.warn('csp_violation', {
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
    })
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
