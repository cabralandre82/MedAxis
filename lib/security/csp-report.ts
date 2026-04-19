/**
 * Content Security Policy violation report parser.
 *
 * Pure parsing helpers extracted from `app/api/csp-report/route.ts` so
 * they live in a regular module — Next.js route files only allow a
 * fixed set of exported symbols (`runtime`, `dynamic`, HTTP method
 * handlers, etc.) and would reject `parseReports` as an invalid
 * route export at build time.
 *
 * Supports both payload formats the spec is currently transitioning
 * between:
 *   1. Legacy `report-uri` — single object wrapped in `{"csp-report": {...}}`
 *      (Chromium ≤ 95, all current Safari/Firefox).
 *   2. Reporting API — JSON array of `{ type:"csp-violation", body:{...} }`
 *      (Chromium 96+).
 *
 * Tolerant of malformed payloads — anything that fails to parse
 * increments `csp_report_invalid_total` and is dropped silently.
 *
 * @module lib/security/csp-report
 */

import { incCounter, Metrics } from '@/lib/metrics'

export interface NormalisedReport {
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
export function hostOf(value: string): string {
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
