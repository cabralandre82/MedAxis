/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { sendSms, SMS, sendWhatsApp, WA } from '@/lib/zenvia'
import { sendPushToUser } from '@/lib/push'
import { inngest } from '@/lib/inngest'
import { asaasIdempotencyKey, claimWebhookEvent, completeWebhookEvent } from '@/lib/webhooks/dedup'
import { logger } from '@/lib/logger'

function isAuthorized(req: NextRequest): boolean {
  const tokenFromQuery = req.nextUrl.searchParams.get('accessToken')
  const tokenFromHeader = req.headers.get('asaas-access-token')
  const expected = process.env.ASAAS_WEBHOOK_SECRET
  return tokenFromQuery === expected || tokenFromHeader === expected
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await req.text()
  let body: { event?: string; payment?: { id?: string; externalReference?: string } }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = (body.event ?? '') as string
  const paymentData = body.payment

  if (!paymentData?.externalReference) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Wave 2 — idempotency: refuse replays at the DB layer.
  const claim = await claimWebhookEvent({
    source: 'asaas',
    eventType: event,
    idempotencyKey: asaasIdempotencyKey(body),
    payload: rawBody,
  })

  if (claim.status === 'duplicate') {
    logger.info('asaas duplicate delivery', {
      module: 'webhooks/asaas',
      eventId: claim.eventId,
      firstSeenAt: claim.firstSeenAt,
      event,
    })
    return NextResponse.json({ ok: true, duplicate: true, eventId: claim.eventId })
  }

  const eventId = claim.status === 'claimed' ? claim.eventId : null

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    await inngest.send({
      name: 'webhook/asaas.received',
      data: { event, payment: paymentData },
    })
    if (eventId) {
      await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
    }
    return NextResponse.json({ ok: true, queued: true, event })
  }

  const orderId: string = paymentData.externalReference
  const admin = createAdminClient()

  // Fetch order
  const { data: order } = await admin
    .from('orders')
    .select(
      `
      id, code, order_status, clinic_id,
      clinics(trade_name, profiles(email, phone, full_name, notification_preferences))
    `
    )
    .eq('id', orderId)
    .single()

  if (!order) {
    if (eventId) {
      await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
    }
    return NextResponse.json({ ok: true, skipped: 'order not found' })
  }

  const clinic = (order as any).clinics as {
    trade_name: string
    profiles: {
      email: string | null
      phone: string | null
      full_name: string
      notification_preferences: Record<string, boolean>
    } | null
  } | null

  // Update payment record
  await admin
    .from('payments')
    .update({
      status: asaasStatusToInternal(event),
      asaas_payment_id: paymentData.id,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', orderId)

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    // Idempotency guard: only advance if not already confirmed
    if ((order as any).order_status === 'PAYMENT_CONFIRMED') {
      return NextResponse.json({ ok: true, skipped: 'already_confirmed' })
    }

    // Advance order status
    await admin
      .from('orders')
      .update({ order_status: 'PAYMENT_CONFIRMED', updated_at: new Date().toISOString() })
      .eq('id', orderId)

    // Record status history
    await admin.from('order_status_history').insert({
      order_id: orderId,
      old_status: (order as any).order_status,
      new_status: 'PAYMENT_CONFIRMED',
      changed_by_user_id: '00000000-0000-0000-0000-000000000000', // system
      reason: `Confirmado automaticamente via Asaas (evento: ${event})`,
    })

    // Notify clinic user
    const { data: clinicMember } = await admin
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', order.clinic_id)
      .limit(1)
      .maybeSingle()

    if (clinicMember) {
      await createNotification({
        userId: clinicMember.user_id,
        type: 'PAYMENT_CONFIRMED',
        title: `Pagamento confirmado — Pedido ${order.code}`,
        message: `O pagamento do pedido ${order.code} foi confirmado. A farmácia iniciará a execução em breve.`,
        link: `/orders/${orderId}`,
      })

      await sendPushToUser(clinicMember.user_id, {
        title: `✅ Pagamento confirmado — ${order.code}`,
        body: `A farmácia iniciará a execução do pedido em breve.`,
        link: `/orders/${orderId}`,
      })
    }

    // Send SMS + WhatsApp to clinic
    const phone = clinic?.profiles?.phone
    const clinicName = clinic?.trade_name ?? ''
    const clinicEmail = clinic?.profiles?.email

    if (phone) {
      await sendSms(phone, SMS.paymentConfirmed(order.code))
      await sendWhatsApp(phone, WA.paymentConfirmed(order.code))
    }

    // Send confirmation email
    if (clinicEmail) {
      await sendEmail({
        to: clinicEmail,
        subject: `✅ Pagamento confirmado — Pedido ${order.code}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0f3460">Pagamento Confirmado</h2>
            <p>Olá, <strong>${clinic?.profiles?.full_name ?? clinicName}</strong>!</p>
            <p>O pagamento do pedido <strong>${order.code}</strong> foi confirmado com sucesso.</p>
            <p>Em breve, a farmácia iniciará a execução do seu pedido.</p>
            <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/orders/${orderId}" style="background:#0f3460;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Ver pedido</a></p>
            <hr style="margin:30px 0;border:none;border-top:1px solid #eee">
            <p style="color:#999;font-size:12px">Clinipharma — clinipharma.com.br</p>
          </div>
        `,
      })
    }

    // Notify all admins via role-based notification
    await createNotificationForRole('SUPER_ADMIN', {
      type: 'PAYMENT_CONFIRMED',
      title: `Pagamento confirmado — Pedido ${order.code}`,
      message: `Pagamento do pedido ${order.code} (${clinicName}) confirmado pelo gateway Asaas.`,
      link: `/orders/${orderId}`,
    })
  }

  if (event === 'PAYMENT_OVERDUE') {
    // Notify clinic
    const { data: clinicMember } = await admin
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', order.clinic_id)
      .limit(1)
      .maybeSingle()

    if (clinicMember) {
      await createNotification({
        userId: clinicMember.user_id,
        type: 'ORDER_STATUS',
        title: `Pagamento vencido — Pedido ${order.code}`,
        message: `O pagamento do pedido ${order.code} está vencido. Acesse a plataforma para regularizar.`,
        link: `/orders/${orderId}`,
      })
    }
  }

  if (eventId) {
    await completeWebhookEvent(eventId, { status: 'processed', httpStatus: 200 })
  }

  return NextResponse.json({ ok: true, event })
}

function asaasStatusToInternal(event: string): string {
  const map: Record<string, string> = {
    PAYMENT_CREATED: 'PENDING',
    PAYMENT_UPDATED: 'PENDING',
    PAYMENT_CONFIRMED: 'CONFIRMED',
    PAYMENT_RECEIVED: 'CONFIRMED',
    PAYMENT_OVERDUE: 'OVERDUE',
    PAYMENT_DELETED: 'CANCELLED',
    PAYMENT_REFUNDED: 'REFUNDED',
    PAYMENT_PARTIALLY_REFUNDED: 'REFUNDED',
  }
  return map[event] ?? 'PENDING'
}
