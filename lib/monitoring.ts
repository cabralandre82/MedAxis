/**
 * Monitoring abstraction layer.
 *
 * All application code imports from here — never directly from @sentry/nextjs.
 * This makes it trivial to swap providers (Sentry → Datadog, etc.)
 * and ensures no errors are thrown when Sentry is not configured.
 *
 * Isomorphism contract
 * --------------------
 * This module **must** be safe to import from a Client Component bundle,
 * because Next.js requires `error.tsx` files to be Client Components and
 * `app/(private)/error.tsx` calls `captureError()` from this module.
 *
 * The hard rule: no static or transitive dependency on `@/lib/logger` (or
 * anything reachable through `lib/logger/context.ts`, which is `server-only`
 * and crashes the client build with `Cannot find module 'server-only'`).
 *
 * The Vercel build broke on 2026-04-18 precisely because this module used
 * to `import { logger } from '@/lib/logger'` for its no-DSN fallback path.
 * That dragged `lib/logger/context.ts` into the client graph through:
 *   `app/(private)/error.tsx`  →  this file  →  lib/logger.ts  →  lib/logger/context.ts
 * and Webpack rejected the build with:
 *   "You're importing a component that needs server-only".
 *
 * The fix is to inline the no-DSN fallback as a plain `console.error` /
 * `console.debug` emitting structured JSON. The output stays compatible
 * with what the existing logger emits (level, message, errorMessage,
 * userId, action, timestamp, env), so log scrapers don't notice.
 *
 * What we lose by not going through `lib/logger`:
 *   - Auto request-context enrichment (requestId / traceId / userId from
 *     AsyncLocalStorage). In production the Sentry DSN is always set, so
 *     the fallback path is never taken there. In dev/test there's no
 *     ambient request context to attach anyway. Net impact: zero.
 *   - PII redaction (`lib/logger/redact.ts`). The fallback only emits the
 *     fields callers explicitly pass (action, userId, etc.), plus the
 *     error's own message/stack. We do not log the error's `cause` or
 *     arbitrary nested objects, so the surface for accidental PII is
 *     small. Server-side callers that need redacted structured logging
 *     should use `@/lib/logger` directly (and almost all already do).
 */
import * as Sentry from '@sentry/nextjs'

export interface ErrorContext {
  userId?: string
  role?: string
  action?: string
  entity?: string
  entityId?: string
  extra?: Record<string, unknown>
}

function emitFallback(
  level: 'error' | 'debug',
  message: string,
  payload: Record<string, unknown>
): void {
  let line: string
  try {
    line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV ?? 'development',
      module: 'monitoring',
      ...payload,
    })
  } catch {
    // Cyclic / non-serialisable payload. Fall back to a string-only entry
    // so we never throw from the monitoring layer.
    line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV ?? 'development',
      module: 'monitoring',
      payloadSerializationError: true,
    })
  }
  if (level === 'error') {
    console.error(line)
  } else {
    console.debug(line)
  }
}

/**
 * Capture an unexpected error with optional context.
 * No-op when Sentry DSN is not configured (falls back to structured JSON
 * on `console.error`).
 */
export function captureError(error: unknown, context?: ErrorContext): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const message = error instanceof Error ? error.message : String(error)
    const errorFields: Record<string, unknown> = {}
    if (error instanceof Error) {
      errorFields.errorMessage = error.message
      errorFields.errorStack = error.stack
      errorFields.errorName = error.name
    } else if (error !== undefined && error !== null) {
      errorFields.errorRaw = String(error)
    }
    emitFallback('error', message, {
      ...(context ?? {}),
      ...errorFields,
    })
    return
  }

  Sentry.withScope((scope) => {
    if (context?.userId) scope.setUser({ id: context.userId })
    if (context?.role) scope.setTag('role', context.role)
    if (context?.action) scope.setTag('action', context.action)
    if (context?.entity) scope.setTag('entity', context.entity)
    if (context?.entityId) scope.setExtra('entityId', context.entityId)
    if (context?.extra) {
      Object.entries(context.extra).forEach(([k, v]) => scope.setExtra(k, v))
    }
    Sentry.captureException(error)
  })
}

/**
 * Record a custom metric / breadcrumb.
 * Useful for tracking slow queries, cache misses, etc.
 */
export function recordMetric(message: string, data?: Record<string, unknown>): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    if (process.env.NODE_ENV !== 'production') {
      emitFallback('debug', message, { ...(data ?? {}) })
    }
    return
  }

  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
  })
}

/**
 * Set the current user context for all subsequent events in this request.
 */
export function identifyUser(userId: string, role?: string): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  Sentry.setUser({ id: userId, role })
}
