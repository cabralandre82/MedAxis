import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import {
  claimWebhookEvent,
  clicksignIdempotencyKey,
  completeWebhookEvent,
} from '@/lib/webhooks/dedup'
import { logger } from '@/lib/logger'

/**
 * Clicksign webhook handler.
 * Configure in Clicksign: POST https://clinipharma.com.br/api/contracts/webhook
 * Clicksign signs the raw body with HMAC SHA256 and sends:
 *   Content-Hmac: sha256=<hex_digest>
 * Set CLICKSIGN_WEBHOOK_SECRET to the HMAC SHA256 Secret shown in the Clicksign panel.
 */
async function isValidHmac(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET
  if (!secret) return true // no secret configured — skip check in dev

  const receivedHeader = req.headers.get('content-hmac') ?? ''
  // Header format: "sha256=<hex>"
  const receivedHex = receivedHeader.replace(/^sha256=/, '')
  if (!receivedHex) return false

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(receivedHex, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!(await isValidHmac(req, rawBody))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = JSON.parse(rawBody)
  const eventType: string = body.event?.name ?? ''
  const documentKey: string = body.document?.key ?? ''

  if (!documentKey) return NextResponse.json({ ok: true, skipped: true })

  const claim = await claimWebhookEvent({
    source: 'clicksign',
    eventType,
    idempotencyKey: clicksignIdempotencyKey(body),
    payload: rawBody,
  })

  if (claim.status === 'duplicate') {
    logger.info('clicksign duplicate delivery', {
      module: 'webhooks/clicksign',
      eventId: claim.eventId,
      firstSeenAt: claim.firstSeenAt,
      eventType,
    })
    return NextResponse.json({ ok: true, duplicate: true, eventId: claim.eventId })
  }

  const eventId = claim.status === 'claimed' ? claim.eventId : null
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('id, type, entity_type, entity_id, user_id, status')
    .eq('clicksign_document_key', documentKey)
    .single()

  if (!contract) {
    if (eventId) {
      await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
    }
    return NextResponse.json({ ok: true, skipped: 'contract not found' })
  }

  if (eventType === 'sign' || eventType === 'auto_close') {
    await admin
      .from('contracts')
      .update({
        status: 'SIGNED',
        signed_at: new Date().toISOString(),
        document_url: body.document?.downloads?.signed_file_url ?? null,
      })
      .eq('id', contract.id)

    // Notify user
    if (contract.user_id) {
      await createNotification({
        userId: contract.user_id,
        type: 'GENERIC',
        title: 'Contrato assinado com sucesso',
        message: 'Seu contrato foi assinado digitalmente. Bem-vindo(a) à Clinipharma!',
        link: '/profile',
      })
    }

    // Notify all super admins
    await createNotificationForRole('SUPER_ADMIN', {
      type: 'GENERIC',
      title: `Contrato ${contract.type} assinado`,
      message: `Contrato ${contract.type} (entidade ${contract.entity_id}) foi assinado digitalmente.`,
      link: `/registrations`,
    })
  }

  if (eventType === 'deadline' || eventType === 'cancel') {
    await admin
      .from('contracts')
      .update({ status: eventType === 'cancel' ? 'CANCELLED' : 'EXPIRED' })
      .eq('id', contract.id)

    if (contract.user_id) {
      await createNotification({
        userId: contract.user_id,
        type: 'GENERIC',
        title: `Contrato ${eventType === 'cancel' ? 'cancelado' : 'expirado'}`,
        message: 'Seu contrato expirou ou foi cancelado. Entre em contato com a Clinipharma.',
        link: '/profile',
      })
    }
  }

  if (eventId) {
    await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
  }

  return NextResponse.json({ ok: true, event: eventType })
}
