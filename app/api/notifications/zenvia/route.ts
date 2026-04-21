/**
 * Zenvia delivery-status webhook — 2026-04-18.
 *
 * Zenvia v2 is webhook-only for delivery status (there is no
 * `GET /v2/channels/sms/messages/{id}/status` endpoint). Without this
 * route, the platform is blind to every SMS outcome after
 * `lib/zenvia.ts` fires the initial POST: a carrier rejection, a
 * number on DNC, a sender-ID block — all invisible. That blind spot
 * was identified on 2026-04-18 during the first live SMS smoke test
 * (Zenvia accepted both sends with HTTP 200 + message IDs but the
 * handset never received anything; no observability existed to say
 * why). This route closes the loop.
 *
 * Protocol (Zenvia Messaging API v2 — `MESSAGE_STATUS` event):
 *
 *   POST /api/notifications/zenvia
 *   Headers:
 *     X-Clinipharma-Zenvia-Secret: <shared secret — constant-time compared>
 *     Content-Type: application/json
 *   Body:
 *     {
 *       "id":             "<event uuid>",
 *       "timestamp":      "2026-04-18T23:59:59.999Z",
 *       "type":           "MESSAGE_STATUS",
 *       "subscriptionId": "<subscription uuid>",
 *       "channel":        "sms" | "whatsapp",
 *       "messageId":      "<id returned on send>",
 *       "contactId":      "5521999999999",
 *       "messageStatus": {
 *         "timestamp":   "2026-04-18T23:59:59.999Z",
 *         "code":        "SENT" | "DELIVERED" | "NOT_DELIVERED" | "REJECTED" | ...,
 *         "description": "<human-readable>"
 *       }
 *     }
 *
 * Responsibilities of this handler, in order:
 *
 *   1. Authenticate (shared secret header, constant-time compare).
 *   2. Idempotency claim via `webhook_events` (source=`zenvia`,
 *      key=`messageId:code:statusTimestamp`). Replays return 200 but
 *      skip work. The Zenvia subscription retries on any non-2xx
 *      response, so duplicates are expected on transient failures.
 *   3. Structured log with every field an operator needs: `messageId`,
 *      `channel`, `status`, `to` (redacted via the logger's PII scrubber),
 *      `zenviaEventId`, `subscriptionId`. Failures log at `error`;
 *      success at `info`.
 *   4. Prometheus counter `SMS_STATUS_EVENT_TOTAL` with labels
 *      `{channel, status}` so Grafana can graph delivery rate and an
 *      alert can fire on sudden NOT_DELIVERED spikes.
 *   5. Respond 200 quickly (under ~200ms) so Zenvia's retry queue
 *      doesn't back up. Zenvia's docs recommend ≤5s but the further
 *      we are under that, the better.
 *
 * What this handler deliberately does NOT do (yet):
 *
 *   • No DB write of individual status events — the audit table
 *     `zenvia_message_events` is a planned follow-up (needs a
 *     migration and adds migration surface on the critical path).
 *     For now, structured logs are the source of truth; ops can
 *     pipe them into an incident query.
 *   • No business-side reaction to delivery failure (e.g.
 *     automatic fallback to email when SMS fails) — that requires a
 *     status model + policy per notification type. Out of scope
 *     for this MVP.
 *   • No WhatsApp handling beyond logging the status. WhatsApp is
 *     off-by-design at launch (`WHATSAPP_ENABLED=false`), so
 *     WhatsApp status events should never arrive; if they do, we
 *     log them and move on.
 *
 * @see lib/zenvia.ts            — outbound SMS / WhatsApp client
 * @see lib/webhooks/dedup.ts    — claim / complete helpers
 * @see lib/security/hmac.ts     — constant-time string comparison
 * @see docs/infra/vercel-projects-topology.md — operational context
 */

import { NextRequest, NextResponse } from 'next/server'
import { claimWebhookEvent, completeWebhookEvent, zenviaIdempotencyKey } from '@/lib/webhooks/dedup'
import { logger } from '@/lib/logger'
import { safeEqualString } from '@/lib/security/hmac'
import { incCounter, Metrics } from '@/lib/metrics'

const MODULE = { module: 'webhooks/zenvia' }

const AUTH_HEADER = 'x-clinipharma-zenvia-secret'

interface ZenviaStatusPayload {
  id?: string
  timestamp?: string
  type?: string
  subscriptionId?: string
  channel?: 'sms' | 'whatsapp' | string
  messageId?: string
  contactId?: string
  messageStatus?: {
    timestamp?: string
    code?: string
    description?: string
  }
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.ZENVIA_WEBHOOK_SECRET ?? null
  if (!expected) return false
  const provided = req.headers.get(AUTH_HEADER) ?? ''
  return safeEqualString(provided, expected)
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    logger.warn('unauthorized delivery', { ...MODULE })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await req.text()
  let body: ZenviaStatusPayload
  try {
    body = JSON.parse(rawBody) as ZenviaStatusPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = body.type ?? 'unknown'
  const channel = body.channel ?? 'unknown'
  const messageId = body.messageId ?? null
  const statusCode = body.messageStatus?.code ?? 'unknown'
  const statusTimestamp = body.messageStatus?.timestamp ?? null
  const description = body.messageStatus?.description ?? null

  // Only MESSAGE_STATUS events shape the contract above; ignore anything else
  // (Zenvia may evolve the API). 200 + `ignored: true` so the subscription
  // doesn't get stuck retrying.
  if (eventType !== 'MESSAGE_STATUS') {
    logger.info('non-status event ignored', {
      ...MODULE,
      eventType,
      zenviaEventId: body.id,
    })
    return NextResponse.json({ ok: true, ignored: true, eventType })
  }

  if (!messageId || !statusCode || statusCode === 'unknown') {
    logger.warn('MESSAGE_STATUS missing required fields', {
      ...MODULE,
      zenviaEventId: body.id,
      messageId,
      zenviaStatusCode: statusCode,
    })
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const claim = await claimWebhookEvent({
    source: 'zenvia',
    eventType: `${channel}:${statusCode}`,
    idempotencyKey: zenviaIdempotencyKey({
      messageId,
      code: statusCode,
      timestamp: statusTimestamp,
    }),
    payload: rawBody,
  })

  if (claim.status === 'duplicate') {
    logger.info('duplicate delivery', {
      ...MODULE,
      eventId: claim.eventId,
      firstSeenAt: claim.firstSeenAt,
      messageId,
      zenviaStatusCode: statusCode,
    })
    return NextResponse.json({ ok: true, duplicate: true, eventId: claim.eventId })
  }

  const eventId = claim.status === 'claimed' ? claim.eventId : null

  incCounter(Metrics.SMS_STATUS_EVENT_TOTAL, {
    channel,
    status: statusCode,
  })

  const logLevel = statusCode === 'NOT_DELIVERED' || statusCode === 'REJECTED' ? 'warn' : 'info'

  logger[logLevel]('delivery status', {
    ...MODULE,
    messageId,
    channel,
    status: statusCode,
    description,
    contactId: body.contactId,
    zenviaEventId: body.id,
    subscriptionId: body.subscriptionId,
    statusTimestamp,
  })

  if (eventId) {
    await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
  }

  return NextResponse.json({ ok: true, messageId, status: statusCode })
}
