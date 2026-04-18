import 'server-only'
import { headers } from 'next/headers'
import {
  makeRequestContext,
  runWithRequestContext,
  updateRequestContext,
  type RequestContext,
} from './context'
import { parseTraceparent, newTraceId, newSpanId } from '@/lib/trace'

/**
 * Wrap a Next.js Route Handler so every log line it emits — and every log
 * line emitted by services, adapters, or helpers it transitively calls —
 * shares the same `requestId`, populated from the `x-request-id` request
 * header seeded by `middleware.ts`.
 *
 * Optional second argument lets callers attach extra static context, e.g.
 *
 *   export const POST = withRouteContext(async (req, ctx) => { … },
 *     { path: '/api/orders/create', method: 'POST' })
 *
 * Without the wrapper, handlers still log — the logger just mints a fresh
 * per-call requestId, which hurts correlation but isn't fatal.
 *
 * Performance: the wrapper adds a single `headers()` call + one ALS run,
 * both O(1) and already paid for by Next.js in every request.
 */
export function withRouteContext<Args extends unknown[], R>(
  handler: (...args: Args) => R | Promise<R>,
  staticContext?: Partial<RequestContext>
) {
  return async (...args: Args): Promise<R> => {
    let requestId: string | undefined
    let path: string | undefined
    let clientIp: string | undefined
    let traceId: string | undefined
    let spanId: string | undefined
    try {
      const h = await headers()
      requestId = h.get('x-request-id') ?? undefined
      path = h.get('x-invoke-path') ?? staticContext?.path
      // Next's middleware may or may not surface the original path depending
      // on route group. Fall back to referer path as a last resort — the
      // value is informational only, not security-bearing.
      clientIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined

      // Wave 11 — continue the distributed trace started by an
      // upstream proxy (CF Worker, Vercel's built-in OTEL
      // collector, another service's fetchWithTrace call). Failing
      // parse means we mint fresh ids so this handler still
      // anchors its own span — never return without trace ids.
      const parsed = parseTraceparent(h.get('traceparent'))
      if (parsed) {
        traceId = parsed.traceId
        spanId = parsed.spanId
      } else {
        traceId = newTraceId()
        spanId = newSpanId()
      }
    } catch {
      // headers() can throw at import time / in test harness. That's fine —
      // we just carry on without enrichment.
    }

    const ctx = makeRequestContext({
      ...staticContext,
      requestId,
      path,
      clientIp,
      traceId,
      spanId,
    })
    return runWithRequestContext(ctx, () => handler(...args))
  }
}

/**
 * Same shape as `withRouteContext` but specialised for Server Actions:
 * they don't have a `request`-shaped first arg but still flow through
 * `headers()`, so the implementation is identical — kept as a separate
 * export for clarity at call sites.
 */
export const withServerActionContext = withRouteContext

/**
 * Attach the resolved user id to the ambient context after authentication.
 * Call this once you've loaded the user — subsequent log lines will be
 * tagged with `userId`.
 */
export function tagUserId(userId: string): void {
  updateRequestContext({ userId })
}
