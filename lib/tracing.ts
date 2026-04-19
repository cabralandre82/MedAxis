/**
 * OpenTelemetry tracing helpers.
 *
 * Use `withSpan()` to wrap any async operation with a named trace span.
 * Spans appear in Vercel's Speed Insights / Observability tab.
 *
 * Example:
 *   const data = await withSpan('db.orders.list', () =>
 *     admin.from('orders').select('*').eq('clinic_id', id)
 *   )
 */

import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { chaosTick } from '@/lib/chaos/injector'

const tracer = trace.getTracer('clinipharma', process.env.npm_package_version ?? '1.0.0')

/**
 * Wraps an async function in an OpenTelemetry span.
 * On error, marks the span as ERROR and re-throws.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      span.setAttributes(attributes)
    }
    try {
      const result = await fn()
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}

/**
 * Convenience wrapper for Supabase DB operations.
 * Adds db.table and db.operation as span attributes.
 */
export async function withDbSpan<T>(
  table: string,
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc',
  fn: () => Promise<T>
): Promise<T> {
  // Wave Hardening II #9 — chaos hook for DB. We restrict injection
  // to **read** operations (`select` and `rpc`) and refuse to fire
  // on writes/deletes even if the operator misconfigures the env.
  // Mutating customer data with a fault-injection harness is a
  // class of accident we want to make structurally impossible.
  if (operation === 'select' || operation === 'rpc') {
    await chaosTick('db', table)
  }
  return withSpan(`db.${table}.${operation}`, fn, {
    'db.system': 'postgresql',
    'db.name': 'supabase',
    'db.sql.table': table,
    'db.operation': operation,
  })
}

/**
 * Convenience wrapper for external HTTP calls.
 */
export async function withHttpSpan<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(`http.${service}.${operation}`, fn, {
    'http.service': service,
    'http.operation': operation,
  })
}
