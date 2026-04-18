import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Per-request context shared across the async call tree.
 *
 * Populated at the edge (middleware) and automatically consumed by `logger`
 * so that every line emitted from any Server Action, Route Handler, Inngest
 * function, or cron job gets tagged with:
 *
 *   - `requestId`   — uuid generated in middleware, echoed via `X-Request-ID`
 *   - `traceId`     — OTEL trace id if an active span exists
 *   - `spanId`      — OTEL active span id
 *   - `userId`      — authenticated Supabase user id (when known)
 *   - `path`        — request pathname (without query string — that can carry PII)
 *   - `method`      — HTTP verb
 *   - `clientIp`    — best-effort remote IP (x-forwarded-for) for rate-limiting logs
 *
 * The key decision is to use Node's AsyncLocalStorage instead of threading
 * `logger.child({…})` through every call site. This is what structured
 * loggers like pino/winston do behind the scenes, and it matches how
 * Next.js itself propagates request data in Server Components.
 *
 * Important constraints:
 *
 *  - AsyncLocalStorage is a Node-only API, so this module is `server-only`.
 *    Tests that import it through logger.ts must stub `server-only` (see
 *    tests/__mocks__/server-only.ts).
 *
 *  - The store is `undefined` when code runs outside a request scope (e.g.
 *    a background job that didn't opt in with `withRequestContext`). Callers
 *    must treat `getRequestContext()` as optional.
 *
 *  - Edge runtime (middleware) does NOT run under Node async hooks; we
 *    export both `runWithRequestContext` (for Route Handlers / server
 *    actions using the Node runtime) and `extractRequestContext` (for the
 *    middleware, which stashes the id on the response header and passes it
 *    along to downstream Node handlers via `x-request-id` request header).
 *
 *  - The `server-only` guard above is load-bearing: it prevents the file
 *    (and its `node:async_hooks` / `node:crypto` imports) from leaking into
 *    a Client Component bundle. The only known reachable client path was
 *    `app/(private)/error.tsx` → `lib/monitoring.ts` → `lib/logger.ts` →
 *    here, which broke the Vercel build on 2026-04-18. The fix lives in
 *    `lib/monitoring.ts`: it now produces its no-DSN fallback output
 *    inline (structured JSON to console) without importing `lib/logger`,
 *    keeping this module's server-only contract intact.
 */

export interface RequestContext {
  requestId: string
  traceId?: string
  spanId?: string
  userId?: string
  path?: string
  method?: string
  clientIp?: string
  /** Unix ms when the request started — used to compute total durationMs on exit. */
  startedAt: number
}

const storage = new AsyncLocalStorage<RequestContext>()

/**
 * Read the active request context, if any. Returns `undefined` outside
 * a request scope (e.g. at module import time, in background workers that
 * forgot to wrap themselves, or inside Vitest tests without setup).
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/**
 * Run `fn` within the given request context. All asynchronous work spawned
 * inside (Promise chains, awaited calls, setTimeouts) inherits the context
 * automatically via Node async hooks.
 *
 * Intended entry points:
 *   - `middleware.ts` for every HTTP request
 *   - `withCronContext()` for Vercel cron handlers
 *   - `withWebhookContext()` for third-party webhook handlers (Asaas, Clicksign)
 *   - `withInngestContext()` for Inngest step functions
 *
 * @example
 *   return runWithRequestContext({ requestId, path, method, startedAt: Date.now() }, async () => {
 *     return handler(req)
 *   })
 */
export function runWithRequestContext<R>(
  ctx: RequestContext,
  fn: () => R | Promise<R>
): Promise<R> {
  return Promise.resolve().then(() => storage.run(ctx, fn))
}

/**
 * Mutate the current request context. Useful to attach the `userId` once
 * the Supabase session has been loaded, or to stamp the `traceId` after
 * the first OTEL span opens. No-op outside a request scope (defensive).
 */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore()
  if (!store) return
  Object.assign(store, patch)
}

/**
 * Convenience factory that produces a fresh base context with the stamp
 * and a freshly-generated requestId. Prefer this over hand-rolling a
 * context literal at every call site.
 */
export function makeRequestContext(partial?: Partial<RequestContext>): RequestContext {
  return {
    // `crypto.randomUUID()` is available on globalThis in Node 19+ and in the
    // Edge runtime, but Node 18 (still our LTS test baseline) only exposes it
    // via `node:crypto`. Importing from there keeps the function usable in
    // every runtime we ship to.
    requestId: partial?.requestId ?? randomUUID(),
    startedAt: partial?.startedAt ?? Date.now(),
    ...partial,
  }
}

/**
 * Wrap a cron handler so every log line it emits carries a stable request
 * identifier for that run. Inngest and Asaas webhook helpers below follow
 * the same shape.
 *
 * @example
 *   export const POST = withCronContext('revalidate-pharmacies', async () => {
 *     logger.info('started') // automatically tagged with requestId + path
 *     …
 *   })
 */
export function withCronContext<Args extends unknown[], R>(
  jobName: string,
  fn: (...args: Args) => R | Promise<R>
) {
  return (...args: Args): Promise<R> => {
    const ctx = makeRequestContext({ path: `/cron/${jobName}`, method: 'CRON' })
    return runWithRequestContext(ctx, () => fn(...args))
  }
}

/**
 * Identical semantics to `withCronContext`, but reserved for third-party
 * webhook handlers so logs and metrics can distinguish cron traffic from
 * webhook traffic at the context level.
 */
export function withWebhookContext<Args extends unknown[], R>(
  source: string,
  fn: (...args: Args) => R | Promise<R>
) {
  return (...args: Args): Promise<R> => {
    const ctx = makeRequestContext({ path: `/webhook/${source}`, method: 'WEBHOOK' })
    return runWithRequestContext(ctx, () => fn(...args))
  }
}

/**
 * Internals reserved for tests. Do not use in application code.
 */
export const __internals = { storage }
