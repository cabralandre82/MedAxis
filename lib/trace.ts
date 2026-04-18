/**
 * W3C trace-context helpers — Wave 11.
 *
 * Three goals, one module:
 *
 *   1. Parse & mint `traceparent` / `tracestate` headers so every
 *      log line, metric emission, and outbound HTTP call carries
 *      a stable trace id that Sentry, Vercel OTEL and Grafana
 *      can join on. Spec: <https://www.w3.org/TR/trace-context/>.
 *
 *   2. Expose `fetchWithTrace()` — a drop-in `fetch` replacement
 *      that automatically:
 *        - reads the current request context (ALS)
 *        - emits a child span id
 *        - injects `traceparent` + `x-request-id` into the
 *          outbound request
 *        - records the call duration into the
 *          `http_outbound_duration_ms{host,method,status}`
 *          histogram
 *      so Asaas / Clicksign / Resend / Zenvia webhooks become
 *      distributed-trace-able without per-call boilerplate.
 *
 *   3. Provide `updateTraceFromHeaders()` which reads a
 *      `traceparent` header from an inbound request and stamps
 *      it onto the active ALS context, so logs generated *after*
 *      the middleware already ran still pick up upstream ids.
 *
 * The module is server-only because ALS + `node:crypto` are Node
 * APIs. The helpers degrade gracefully in tests (no ALS ctx →
 * spans still have valid randomly-generated ids, just without
 * parent linkage).
 *
 * ### traceparent format
 *
 *     00-<32-hex trace_id>-<16-hex span_id>-<2-hex flags>
 *
 * Example:
 *
 *     00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *
 * Flags bitfield: `0x01` = "sampled" (forward to Sentry / OTEL).
 *
 * @module lib/trace
 */

import 'server-only'
import { randomBytes } from 'node:crypto'
import { getRequestContext, updateRequestContext } from '@/lib/logger/context'
import { Metrics, incCounter, observeHistogram } from '@/lib/metrics'
import { logger } from '@/lib/logger'

// ── W3C parse / emit ─────────────────────────────────────────────────────

/**
 * A parsed `traceparent` header. The combination of `traceId +
 * spanId + flags` is what Sentry calls a "propagation context".
 */
export interface TraceParent {
  /** 32 lowercase hex chars. All-zeros is reserved as invalid. */
  traceId: string
  /** 16 lowercase hex chars. The id of the *parent* span (ours is a child). */
  spanId: string
  /** Sampled flag — `0x01` means downstream collectors should keep the trace. */
  sampled: boolean
}

const TRACE_ID_ZERO = '0'.repeat(32)
const SPAN_ID_ZERO = '0'.repeat(16)
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

/**
 * Parse a `traceparent` header. Returns `null` when the header is
 * missing, malformed, or uses the reserved all-zero ids. This is
 * intentionally strict: an attacker supplying a bogus value would
 * otherwise poison our log search by fabricating fake trace ids.
 */
export function parseTraceparent(raw: string | null | undefined): TraceParent | null {
  if (!raw || typeof raw !== 'string') return null
  const m = TRACEPARENT_RE.exec(raw.trim())
  if (!m) return null
  const traceId = m[1].toLowerCase()
  const spanId = m[2].toLowerCase()
  const flags = parseInt(m[3], 16)
  if (traceId === TRACE_ID_ZERO || spanId === SPAN_ID_ZERO) return null
  if (!Number.isFinite(flags)) return null
  return { traceId, spanId, sampled: (flags & 0x01) === 0x01 }
}

/**
 * Serialise a parsed traceparent back into the W3C header format.
 */
export function formatTraceparent(tp: TraceParent): string {
  const flags = tp.sampled ? '01' : '00'
  return `00-${tp.traceId}-${tp.spanId}-${flags}`
}

/** Hex digits, lowercase. */
function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/** Fresh random trace id (128-bit). */
export function newTraceId(): string {
  return hex(16)
}

/** Fresh random span id (64-bit). */
export function newSpanId(): string {
  return hex(8)
}

/**
 * Mint a fresh `traceparent` for the current request, or continue
 * the inbound one if the middleware already stamped it. The
 * returned object also carries a freshly-generated span id so the
 * caller can emit it on its child fetch.
 *
 * Sampling: we respect whatever the upstream said; if we're the
 * root of the trace, we mark the request as sampled so Sentry
 * gets the full chain (rate-limit is handled by
 * `tracesSampleRate` in sentry.*.config.ts).
 */
export function currentTraceParent(): TraceParent {
  const ctx = getRequestContext()
  if (ctx?.traceId) {
    return {
      traceId: ctx.traceId,
      // ctx.spanId is the *current* span — a child outbound call
      // uses a fresh span id and sets `parent` to ctx.spanId.
      spanId: ctx.spanId ?? newSpanId(),
      sampled: true,
    }
  }
  return { traceId: newTraceId(), spanId: newSpanId(), sampled: true }
}

/**
 * Stamp the active ALS context with trace + span ids (first call
 * mints fresh ids when inbound `traceparent` is absent). Noop
 * outside a request scope so tests and module-load code don't
 * throw.
 *
 * Call from the first Node-runtime handler of each request, not
 * from the Edge middleware — the middleware runs in a different
 * runtime where AsyncLocalStorage isn't available.
 */
export function updateTraceFromHeaders(
  headers: Headers | Record<string, string | undefined>
): TraceParent {
  const getter =
    headers instanceof Headers
      ? (n: string) => headers.get(n)
      : (n: string) => headers[n] ?? headers[n.toLowerCase()] ?? null

  const inbound = parseTraceparent(getter('traceparent'))

  const tp: TraceParent = inbound ?? {
    traceId: newTraceId(),
    spanId: newSpanId(),
    sampled: true,
  }

  updateRequestContext({ traceId: tp.traceId, spanId: tp.spanId })
  return tp
}

// ── Outbound fetch with trace injection ─────────────────────────────────

export interface FetchWithTraceOptions extends RequestInit {
  /**
   * Human-readable label for metrics. Defaults to the URL's
   * hostname. Use this when the real hostname is a load balancer
   * but you want to separate "asaas" from "clicksign".
   */
  serviceName?: string
  /**
   * If set, errors of category `4xx` and `5xx` are logged at
   * `warn` / `error`. Default true. Turn OFF for health probes
   * where failures are expected.
   */
  logFailures?: boolean
  /**
   * Timeout in ms — uses AbortController. Default 10_000.
   * Passing an explicit `signal` overrides this.
   */
  timeoutMs?: number
}

function hostOf(url: string | URL): string {
  try {
    return new URL(typeof url === 'string' ? url : url.toString()).host
  } catch {
    return 'unknown'
  }
}

/**
 * Drop-in `fetch` wrapper that propagates the W3C trace context
 * and records Prometheus-ish metrics. Usage:
 *
 *     const res = await fetchWithTrace('https://api.asaas.com/v3/payments', {
 *       method: 'POST',
 *       body: JSON.stringify(payload),
 *       serviceName: 'asaas',
 *     })
 *
 * Behavioural contract:
 *   - Injects `traceparent` (required) and `x-request-id`
 *     (when an ALS ctx exists) into outbound headers without
 *     overwriting explicit values passed by the caller.
 *   - Emits a child span id each call, but keeps the parent's
 *     trace id so Grafana's trace view can walk the chain.
 *   - Records `http_outbound_duration_ms{service,method,status}`.
 *   - Increments `http_outbound_total{service,method,outcome}`
 *     where outcome ∈ {ok, error_4xx, error_5xx, error_network,
 *     error_timeout}.
 *   - Never swallows errors — the caller gets the same surface
 *     contract as plain `fetch`.
 */
export async function fetchWithTrace(
  input: RequestInfo | URL,
  init: FetchWithTraceOptions = {}
): Promise<Response> {
  const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url
  const method = (init.method ?? 'GET').toUpperCase()
  const service = init.serviceName ?? hostOf(url)
  const logFailures = init.logFailures ?? true
  const timeoutMs = init.timeoutMs ?? 10_000

  const ctx = getRequestContext()
  const parent = currentTraceParent()
  // Child span: same trace, new span id. This makes our outbound
  // call look like a sub-operation of the inbound request in
  // distributed-trace views.
  const childSpan: TraceParent = {
    traceId: parent.traceId,
    spanId: newSpanId(),
    sampled: parent.sampled,
  }

  const outgoingHeaders = new Headers(init.headers)
  if (!outgoingHeaders.has('traceparent')) {
    outgoingHeaders.set('traceparent', formatTraceparent(childSpan))
  }
  if (!outgoingHeaders.has('x-request-id') && ctx?.requestId) {
    outgoingHeaders.set('x-request-id', ctx.requestId)
  }

  // Timeout via AbortController. If the caller supplied its own
  // `signal`, chain them so either source can cancel.
  const controller = new AbortController()
  const chainSignal = init.signal as AbortSignal | undefined
  if (chainSignal) {
    if (chainSignal.aborted) controller.abort(chainSignal.reason)
    else
      chainSignal.addEventListener('abort', () => controller.abort(chainSignal.reason), {
        once: true,
      })
  }
  const timer = setTimeout(() => controller.abort(new Error('fetch timeout')), timeoutMs)

  const startedAt = Date.now()
  try {
    const response = await fetch(input, {
      ...init,
      headers: outgoingHeaders,
      signal: controller.signal,
    })
    const elapsed = Date.now() - startedAt
    const status = response.status
    const bucket = status >= 500 ? 'error_5xx' : status >= 400 ? 'error_4xx' : 'ok'

    incCounter(Metrics.HTTP_OUTBOUND_TOTAL, { service, method, outcome: bucket })
    observeHistogram(Metrics.HTTP_OUTBOUND_DURATION_MS, elapsed, {
      service,
      method,
      status: String(status),
    })

    if (logFailures && status >= 400) {
      logger[status >= 500 ? 'error' : 'warn'](`outbound ${method} ${service} ${status}`, {
        module: 'trace',
        service,
        method,
        status,
        url,
        durationMs: elapsed,
        childSpanId: childSpan.spanId,
        traceId: childSpan.traceId,
      })
    }

    return response
  } catch (err) {
    const elapsed = Date.now() - startedAt
    const isTimeout =
      (err as { name?: string } | undefined)?.name === 'AbortError' ||
      /timeout/i.test(String((err as Error | undefined)?.message ?? ''))
    const outcome = isTimeout ? 'error_timeout' : 'error_network'
    incCounter(Metrics.HTTP_OUTBOUND_TOTAL, { service, method, outcome })
    observeHistogram(Metrics.HTTP_OUTBOUND_DURATION_MS, elapsed, {
      service,
      method,
      status: outcome,
    })
    if (logFailures) {
      logger.error(`outbound ${method} ${service} ${outcome}`, {
        module: 'trace',
        service,
        method,
        url,
        durationMs: elapsed,
        childSpanId: childSpan.spanId,
        traceId: childSpan.traceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── Sentry scope enrichment ──────────────────────────────────────────────

/**
 * When Sentry is present, stamp the active trace + request id on
 * the scope so every captured error carries them as tags. This
 * is independent of `@sentry/nextjs`'s built-in tracing: the
 * built-in tracer only kicks in on routes wrapped by the SDK,
 * but our code (Inngest, cron, custom handlers) often runs
 * outside that surface.
 *
 * Best-effort — the import is dynamic so test environments that
 * don't install `@sentry/nextjs` don't blow up on module load.
 */
export async function enrichSentryScope(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  const ctx = getRequestContext()
  if (!ctx) return
  try {
    const Sentry = await import('@sentry/nextjs')
    // Sentry v8 replaced `configureScope(cb)` with the direct
    // `getCurrentScope()` accessor. Keep calls narrowly scoped
    // so a future SDK bump only touches this block.
    const scope = Sentry.getCurrentScope()
    if (ctx.requestId) scope.setTag('request_id', ctx.requestId)
    if (ctx.traceId) scope.setTag('trace_id', ctx.traceId)
    if (ctx.spanId) scope.setTag('span_id', ctx.spanId)
    if (ctx.path) scope.setTag('path', ctx.path)
    if (ctx.method) scope.setTag('method', ctx.method)
    if (ctx.userId) scope.setUser({ id: ctx.userId })
  } catch {
    // Swallow — observability enrichment is best-effort.
  }
}
