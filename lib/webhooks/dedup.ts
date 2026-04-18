/**
 * Webhook idempotency — Wave 2.
 *
 * Every inbound webhook (Asaas, Clicksign, Inngest, ...) must claim an
 * idempotency slot in `public.webhook_events` before running its business
 * logic. A second delivery with the same (source, idempotency_key) is
 * refused at the DB layer via the UNIQUE index, so replays caused by
 * network hiccups, DNS flaps, or malicious re-posts cannot double-spend
 * side effects.
 *
 * Usage in a Route Handler (see app/api/payments/asaas/webhook/route.ts):
 *
 *   const claim = await claimWebhookEvent({
 *     source: 'asaas',
 *     eventType,
 *     idempotencyKey: asaasIdempotencyKey(body),
 *     payload: rawBody,
 *   })
 *
 *   if (claim.status === 'duplicate') {
 *     // 200 so the sender stops retrying; side effects already ran.
 *     return NextResponse.json({ ok: true, duplicate: true, eventId: claim.eventId })
 *   }
 *
 *   try {
 *     await handleAsaas(body)
 *     await completeWebhookEvent(claim.eventId, { status: 'processed', httpStatus: 200 })
 *   } catch (err) {
 *     await completeWebhookEvent(claim.eventId, {
 *       status: 'failed',
 *       httpStatus: 500,
 *       error: err instanceof Error ? err.message : String(err),
 *     })
 *     throw err
 *   }
 *
 * The helper never throws on the happy path — if the DB is unreachable,
 * the caller receives `{ status: 'degraded' }` and is expected to decide
 * (fail-open vs fail-closed). For Asaas / Clicksign we fail-open (proceed
 * without dedup) and rely on the source's own delivery guarantees; the
 * failure is logged at error level so ops sees the degradation.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { getRequestContext } from '@/lib/logger/context'

export type WebhookSource = 'asaas' | 'clicksign' | 'inngest' | (string & {})

export interface ClaimArgs {
  source: WebhookSource
  eventType?: string | null
  idempotencyKey: string
  /** Raw body or already-parsed payload. Hashed for forensics; never stored verbatim. */
  payload?: string | Buffer | object | null
  /** Explicit request correlation id. Defaults to getRequestContext().requestId. */
  requestId?: string
}

export type ClaimResult =
  | { status: 'claimed'; eventId: number }
  | { status: 'duplicate'; eventId: number; firstSeenAt: string; previousStatus: string }
  | { status: 'degraded'; reason: string }

export interface CompleteArgs {
  status: 'processed' | 'failed'
  httpStatus?: number
  error?: string
  /** Increments attempts in place. Defaults to false (attempts stays as-is). */
  countAttempt?: boolean
}

function hashPayload(payload: ClaimArgs['payload']): Buffer | null {
  if (payload == null) return null
  const s =
    typeof payload === 'string'
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString('utf8')
        : safeStringify(payload)
  return createHash('sha256').update(s).digest()
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Deterministic idempotency key for Asaas webhooks. Asaas does not ship a
 * stable `event.id`, but `payment.id` + `event` name are unique per
 * delivery — a replay from Asaas always repeats the same pair.
 */
export function asaasIdempotencyKey(body: {
  event?: string | null
  payment?: { id?: string | null } | null
}): string {
  const event = body?.event ?? 'unknown'
  const paymentId = body?.payment?.id ?? 'no-payment'
  return `${paymentId}:${event}`
}

/**
 * Deterministic idempotency key for Clicksign webhooks. Clicksign sends
 * `document.key` + `event.name` + `event.occurred_at`; the triple is
 * stable across retries.
 */
export function clicksignIdempotencyKey(body: {
  event?: { name?: string | null; occurred_at?: string | null } | null
  document?: { key?: string | null } | null
}): string {
  const docKey = body?.document?.key ?? 'no-doc'
  const eventName = body?.event?.name ?? 'unknown'
  const when = body?.event?.occurred_at ?? 'no-time'
  return `${docKey}:${eventName}:${when}`
}

const DEDUP_MODULE = { module: 'webhooks/dedup' }

/**
 * Claim an idempotency slot. Returns `{ status: 'claimed', eventId }` for
 * the first delivery, `{ status: 'duplicate', eventId, firstSeenAt }` for
 * replays, or `{ status: 'degraded' }` when the DB is unreachable.
 */
export async function claimWebhookEvent(args: ClaimArgs): Promise<ClaimResult> {
  if (!args.source || !args.idempotencyKey) {
    throw new Error('claimWebhookEvent: source and idempotencyKey are required')
  }

  const requestId = args.requestId ?? getRequestContext()?.requestId ?? null
  const payloadHash = hashPayload(args.payload)

  try {
    const admin = createAdminClient()

    // 1. Attempt insert — UNIQUE(source, idempotency_key) rejects duplicates.
    const insert = await admin
      .from('webhook_events')
      .insert({
        source: args.source,
        event_type: args.eventType ?? null,
        idempotency_key: args.idempotencyKey,
        payload_hash: payloadHash,
        request_id: requestId,
        status: 'received',
      })
      .select('id')
      .single()

    if (!insert.error && insert.data?.id) {
      return { status: 'claimed', eventId: insert.data.id as number }
    }

    // 23505 == unique_violation → duplicate. Anything else is degradation.
    const code = (insert.error as { code?: string } | null)?.code
    if (code !== '23505') {
      logger.error('claim failed (non-unique error)', {
        ...DEDUP_MODULE,
        source: args.source,
        idempotencyKey: args.idempotencyKey,
        code,
        error: insert.error,
      })
      return { status: 'degraded', reason: code ?? 'insert-failed' }
    }

    // 2. Fetch the existing row for diagnostics and to attach to the response.
    const existing = await admin
      .from('webhook_events')
      .select('id, received_at, status, attempts')
      .eq('source', args.source)
      .eq('idempotency_key', args.idempotencyKey)
      .maybeSingle()

    if (existing.error || !existing.data) {
      logger.warn('duplicate detected but row lookup failed', {
        ...DEDUP_MODULE,
        source: args.source,
        error: existing.error,
      })
      return { status: 'degraded', reason: 'lookup-after-conflict' }
    }

    // Bump attempts so operators can spot chatty senders.
    await admin
      .from('webhook_events')
      .update({ attempts: (existing.data.attempts ?? 1) + 1, status: 'duplicate' })
      .eq('id', existing.data.id)

    return {
      status: 'duplicate',
      eventId: existing.data.id as number,
      firstSeenAt: existing.data.received_at as string,
      previousStatus: (existing.data.status as string) ?? 'unknown',
    }
  } catch (err) {
    logger.error('claim threw', {
      ...DEDUP_MODULE,
      source: args.source,
      idempotencyKey: args.idempotencyKey,
      error: err,
    })
    return { status: 'degraded', reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Mark a previously claimed event as processed or failed. Never throws —
 * failure to update the audit row must not corrupt the business response.
 */
export async function completeWebhookEvent(eventId: number, outcome: CompleteArgs): Promise<void> {
  if (!Number.isFinite(eventId) || eventId <= 0) return

  try {
    const admin = createAdminClient()
    const patch: Record<string, unknown> = {
      status: outcome.status,
      processed_at: new Date().toISOString(),
    }
    if (outcome.httpStatus != null) patch.http_status = outcome.httpStatus
    if (outcome.error != null) patch.error = outcome.error

    const q = admin.from('webhook_events').update(patch).eq('id', eventId)

    const { error } = await q
    if (error) {
      logger.warn('complete failed', {
        ...DEDUP_MODULE,
        eventId,
        outcomeStatus: outcome.status,
        error,
      })
    }
  } catch (err) {
    logger.warn('complete threw', {
      ...DEDUP_MODULE,
      eventId,
      error: err,
    })
  }
}
