import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import {
  claimWebhookEvent,
  clicksignIdempotencyKey,
  completeWebhookEvent,
} from '@/lib/webhooks/dedup'
import { logger } from '@/lib/logger'
import { verifyHmacSha256 } from '@/lib/security/hmac'
import { incCounter, Metrics } from '@/lib/metrics'

/**
 * Clicksign webhook handler.
 * Configure in Clicksign: POST https://clinipharma.com.br/api/contracts/webhook
 * Clicksign signs the raw body with HMAC SHA256 and sends:
 *   Content-Hmac: sha256=<hex_digest>
 * Set CLICKSIGN_WEBHOOK_SECRET to the HMAC SHA256 Secret shown in the Clicksign panel.
 *
 * Wave 5: HMAC compare delegated to lib/security/hmac which uses
 * `timingSafeEqual` over hex-decoded bytes and enforces hex format.
 *
 * Pre-Launch Onda S2 / T4: instrumentado com `clicksign_webhook_total{outcome}`
 * (não muda comportamento). Cada caminho de saída incrementa o counter para
 * o `outcome` correspondente. Em produção esperamos `outcome=hmac_verified`
 * dominar; valores não-zero em `hmac_dev_bypass` sinalizam que
 * `CLICKSIGN_WEBHOOK_SECRET` caiu da env (P2). Valores não-zero em
 * `hmac_failed` sustentado sinalizam ataque ou config drift no portal
 * Clicksign (P2). Ver `docs/runbooks/clicksign-webhook-silent.md`.
 */
type HmacResult = 'verified' | 'dev_bypass' | 'failed'
async function isValidHmac(req: NextRequest, rawBody: string): Promise<HmacResult> {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET
  if (!secret) return 'dev_bypass' // no secret configured — skip check in dev
  return verifyHmacSha256(rawBody, req.headers.get('content-hmac'), secret) ? 'verified' : 'failed'
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const hmacResult = await isValidHmac(req, rawBody)
  if (hmacResult === 'failed') {
    incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'hmac_failed' })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // hmac_verified vs hmac_dev_bypass — counter incrementa por caminho
  // separado para que o operador veja `dev_bypass > 0` em prod como
  // sinal de config drift (CLICKSIGN_WEBHOOK_SECRET removido).
  incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, {
    outcome: hmacResult === 'verified' ? 'hmac_verified' : 'hmac_dev_bypass',
  })

  let body: {
    event?: { name?: string }
    document?: { key?: string; downloads?: { signed_file_url?: string } }
  }
  try {
    body = JSON.parse(rawBody)
  } catch (err) {
    incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'parse_error' })
    logger.warn('[clicksign-webhook] body is not valid JSON', {
      bodyLen: rawBody.length,
      err: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const eventType: string = body.event?.name ?? ''
  const documentKey: string = body.document?.key ?? ''

  if (!documentKey) {
    incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'processed_skipped' })
    return NextResponse.json({ ok: true, skipped: true })
  }

  const claim = await claimWebhookEvent({
    source: 'clicksign',
    eventType,
    idempotencyKey: clicksignIdempotencyKey(body),
    payload: rawBody,
  })

  if (claim.status === 'duplicate') {
    incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'duplicate' })
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
    incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'processed_skipped' })
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

  incCounter(Metrics.CLICKSIGN_WEBHOOK_TOTAL, { outcome: 'processed' })
  return NextResponse.json({ ok: true, event: eventType })
}
