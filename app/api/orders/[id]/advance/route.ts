import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { isValidTransition } from '@/lib/orders/status-machine'
import { isPrescriptionRequirementMet, getPrescriptionState } from '@/lib/prescription-rules'
import { createAuditLog, AuditEntity, AuditAction } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { sendSms, SMS } from '@/lib/sms'
import { sendWhatsApp, WA } from '@/lib/whatsapp'
import { logger } from '@/lib/logger'
import type { OrderStatus } from '@/lib/orders/status-machine'

interface RouteParams {
  params: Promise<{ id: string }>
}

const bodySchema = z.object({
  newStatus: z.string(),
  reason: z.string().optional(),
})

/**
 * POST /api/orders/[id]/advance
 *
 * Advances an order to a new status, enforcing:
 *   1. Role-based state machine transitions
 *   2. Prescription requirements BEFORE leaving AWAITING_DOCUMENTS
 *
 * This is the single gate for all status changes to prevent bypassing
 * prescription enforcement via direct DB manipulation from UI.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: orderId } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isPharmacy = user.roles.includes('PHARMACY_ADMIN')

  if (!isAdmin && !isPharmacy) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = bodySchema.safeParse(await req.json())
  if (!body.success) {
    return NextResponse.json({ error: 'newStatus obrigatório' }, { status: 400 })
  }

  const { newStatus, reason } = body.data
  const role = isAdmin ? 'admin' : 'pharmacy'

  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, order_status, clinic_id, pharmacy_id')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })

  // RBAC — pharmacy can only touch orders assigned to their pharmacy
  if (isPharmacy && !isAdmin) {
    const { data: member } = await admin
      .from('pharmacy_members')
      .select('id')
      .eq('pharmacy_id', order.pharmacy_id)
      .eq('user_id', user.id)
      .single()
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isValidTransition(order.order_status, newStatus, role)) {
    return NextResponse.json(
      {
        error: `Transição inválida: ${order.order_status} → ${newStatus}`,
      },
      { status: 422 }
    )
  }

  // ── Prescription gate ────────────────────────────────────────────────────────
  // Applies when leaving AWAITING_DOCUMENTS regardless of role.
  // Even admins cannot advance without prescriptions — the liability stays with
  // the platform if we allow bypassing this gate.
  if (
    order.order_status === 'AWAITING_DOCUMENTS' &&
    newStatus !== 'AWAITING_DOCUMENTS' &&
    newStatus !== 'CANCELED'
  ) {
    const prescriptionMet = await isPrescriptionRequirementMet(orderId)
    if (!prescriptionMet) {
      const state = await getPrescriptionState(orderId)
      return NextResponse.json(
        {
          error: 'Receitas médicas pendentes',
          detail: state.reason,
          prescriptionState: state,
        },
        { status: 422 }
      )
    }
  }

  // ── Apply transition ─────────────────────────────────────────────────────────
  const { error: updateError } = await admin
    .from('orders')
    .update({ order_status: newStatus as OrderStatus })
    .eq('id', orderId)

  if (updateError) {
    logger.error('[advance] order update failed', { error: updateError, orderId })
    return NextResponse.json({ error: 'Erro ao atualizar pedido' }, { status: 500 })
  }

  // Record in status history
  await admin.from('order_status_history').insert({
    order_id: orderId,
    old_status: order.order_status,
    new_status: newStatus,
    changed_by_user_id: user.id,
    reason: reason ?? null,
  })

  await createAuditLog({
    actorUserId: user.id,
    actorRole: user.roles[0],
    entityType: AuditEntity.ORDER,
    entityId: orderId,
    action: AuditAction.UPDATE,
    newValues: { old_status: order.order_status, new_status: newStatus, reason },
  })

  // ── Post-transition notifications ─────────────────────────────────────────
  // Notify the clinic on key status changes triggered by pharmacy
  const KEY_STATUSES: Record<string, string> = {
    READY: 'pronto para entrega',
    SHIPPED: 'enviado',
    DELIVERED: 'entregue',
  }
  if (KEY_STATUSES[newStatus]) {
    try {
      const { data: fullOrder } = await admin
        .from('orders')
        .select(
          `code, created_by_user_id,
           clinics ( phone )`
        )
        .eq('id', orderId)
        .single()

      const clinicPhone = (fullOrder?.clinics as { phone?: string } | null)?.phone
      const code = fullOrder?.code ?? orderId

      if (clinicPhone) {
        if (newStatus === 'READY') {
          sendSms(clinicPhone, SMS.orderReady(code)).catch(() => null)
          sendWhatsApp(clinicPhone, WA.orderReady(code)).catch(() => null)
        } else if (newStatus === 'SHIPPED') {
          sendSms(clinicPhone, SMS.orderShipped(code)).catch(() => null)
          sendWhatsApp(clinicPhone, WA.orderShipped(code)).catch(() => null)
        } else if (newStatus === 'DELIVERED') {
          sendSms(clinicPhone, SMS.orderDelivered(code)).catch(() => null)
          sendWhatsApp(clinicPhone, WA.orderDelivered(code)).catch(() => null)
        }
      }

      if (fullOrder?.created_by_user_id) {
        await createNotification({
          userId: fullOrder.created_by_user_id,
          type: 'ORDER_STATUS',
          title: `Pedido ${code}: ${KEY_STATUSES[newStatus]}`,
          link: `/orders/${orderId}`,
          push: true,
        })
      }
    } catch (notifyErr) {
      logger.warn('[advance] post-transition notification failed', { notifyErr })
    }
  }

  return NextResponse.json({ success: true, status: newStatus })
}
