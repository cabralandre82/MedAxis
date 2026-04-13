'use server'
import { logger } from '@/lib/logger'

import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { revalidateTag } from 'next/cache'
import { requireAuth } from '@/lib/auth/session'
import { sendEmail } from '@/lib/email'
import { newOrderEmail, orderStatusUpdatedEmail } from '@/lib/email/templates'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { formatCurrency } from '@/lib/utils'
import { z } from 'zod'
import { isValidTransition } from '@/lib/orders/status-machine'
import { canPlaceOrder } from '@/lib/compliance'
import { getActiveCouponsForOrder } from '@/services/coupons'
import { sendSms, SMS } from '@/lib/sms'
import { sendWhatsApp, WA } from '@/lib/whatsapp'

// Supabase uses gen_random_uuid() which may produce UUIDs outside strict RFC 4122 v4
// variant bits (e.g. variant starting with 6x). Use a loose regex instead of z.string().uuid().
const uuidLoose = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'ID inválido')

const createOrderSchema = z.object({
  clinic_id: uuidLoose,
  doctor_id: uuidLoose.optional().nullable(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: uuidLoose,
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'Adicione ao menos um produto'),
})

export type OrderDocument = {
  file: File
  type: string
}

export type CreateOrderInput = z.infer<typeof createOrderSchema> & {
  documents?: OrderDocument[]
}

interface CreateOrderResult {
  orderId?: string
  error?: string
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  try {
    const user = await requireAuth()

    const parsed = createOrderSchema.safeParse(input)
    if (!parsed.success) {
      logger.error('[createOrder] schema validation failed', {
        issues: parsed.error.issues,
        input: {
          clinic_id: input.clinic_id,
          doctor_id: input.doctor_id,
          itemCount: input.items?.length,
        },
      })
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }

    const { clinic_id, doctor_id = null, notes, items } = parsed.data
    const supabase = await createClient()
    const adminClient = createAdminClient()

    // Validate all products and get pharmacy (all items must be from same pharmacy)
    const productIds = items.map((i) => i.product_id)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, pharmacy_id, price_current, name, estimated_deadline_days, active')
      .in('id', productIds)

    if (productsError || !products?.length) return { error: 'Produtos não encontrados' }
    if (products.some((p) => !p.active)) return { error: 'Um ou mais produtos estão inativos' }

    const pharmacyIds = [...new Set(products.map((p) => p.pharmacy_id))]
    if (pharmacyIds.length > 1) return { error: 'Todos os produtos devem ser da mesma farmácia' }

    const pharmacy_id = pharmacyIds[0]

    // Compliance check: clinic and pharmacy must be active; pharmacy CNPJ revalidated if stale
    const compliance = await canPlaceOrder(clinic_id, pharmacy_id)
    if (!compliance.allowed)
      return { error: compliance.reason ?? 'Pedido bloqueado por regra de compliance' }

    // Calculate initial total (will be recalculated by trigger)
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
    const estimatedTotal = items.reduce((sum, item) => {
      const p = productMap[item.product_id]
      return sum + (p?.price_current ?? 0) * item.quantity
    }, 0)

    // Auto-detect active coupons for this clinic — trigger will apply math
    const couponMap = await getActiveCouponsForOrder(clinic_id, productIds)

    // Create order header
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .insert({
        clinic_id,
        doctor_id,
        pharmacy_id,
        total_price: estimatedTotal,
        order_status: 'AWAITING_DOCUMENTS',
        payment_status: 'PENDING',
        transfer_status: 'NOT_READY',
        notes: notes ?? null,
        created_by_user_id: user.id,
        code: '',
      })
      .select('id, code')
      .single()

    if (orderError || !order) {
      logger.error('Order creation error:', { error: orderError })
      return { error: 'Erro ao criar pedido. Tente novamente.' }
    }

    // Insert items (trigger freezes prices and applies coupon discount)
    const { error: itemsError } = await adminClient.from('order_items').insert(
      items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: productMap[item.product_id]?.price_current ?? 0,
        total_price: (productMap[item.product_id]?.price_current ?? 0) * item.quantity,
        coupon_id: couponMap[item.product_id] ?? null,
      }))
    )

    if (itemsError) {
      logger.error('Order items error:', { error: itemsError })
      await adminClient.from('orders').delete().eq('id', order.id)
      return { error: 'Erro ao registrar itens do pedido.' }
    }

    // Record initial status history (non-blocking — log on failure)
    const { error: historyError } = await adminClient.from('order_status_history').insert({
      order_id: order.id,
      old_status: null,
      new_status: 'AWAITING_DOCUMENTS',
      changed_by_user_id: user.id,
      reason: 'Pedido criado',
    })
    if (historyError)
      logger.error('[createOrder] failed to insert status history', {
        orderId: order.id,
        error: historyError,
      })

    // Fetch updated total (after trigger recalc)
    const { data: updatedOrder } = await adminClient
      .from('orders')
      .select('total_price')
      .eq('id', order.id)
      .single()

    const finalTotal = updatedOrder?.total_price ?? estimatedTotal

    // Create payment record (gross_amount = total at time of order creation)
    await adminClient.from('payments').insert({
      order_id: order.id,
      payer_profile_id: user.id,
      gross_amount: finalTotal,
      status: 'PENDING',
      payment_method: 'MANUAL',
    })

    // Create public tracking token for this order (non-blocking)
    const { error: tokenError } = await adminClient
      .from('order_tracking_tokens')
      .upsert(
        { order_id: order.id, expires_at: null },
        { onConflict: 'order_id', ignoreDuplicates: true }
      )
    if (tokenError)
      logger.error('[createOrder] failed to upsert tracking token', {
        orderId: order.id,
        error: tokenError,
      })

    // Upload documents if any; track how many were saved successfully
    let uploadedCount = 0
    if (input.documents && input.documents.length > 0) {
      for (const { file, type } of input.documents) {
        try {
          const fileName = `${order.id}/${Date.now()}-${file.name}`
          const arrayBuffer = await file.arrayBuffer()
          const buffer = new Uint8Array(arrayBuffer)
          const { data: uploadData } = await adminClient.storage
            .from('order-documents')
            .upload(fileName, buffer, { contentType: file.type })
          if (uploadData) {
            await adminClient.from('order_documents').insert({
              order_id: order.id,
              document_type: type,
              storage_path: uploadData.path,
              original_filename: file.name,
              mime_type: file.type,
              file_size: file.size,
              uploaded_by_user_id: user.id,
            })
            uploadedCount++
          }
        } catch (uploadErr) {
          logger.error('Document upload error:', { error: uploadErr })
        }
      }
    }

    // If at least one document was uploaded, advance status to READY_FOR_REVIEW
    if (uploadedCount > 0) {
      await adminClient
        .from('orders')
        .update({ order_status: 'READY_FOR_REVIEW', updated_at: new Date().toISOString() })
        .eq('id', order.id)

      await adminClient.from('order_status_history').insert({
        order_id: order.id,
        old_status: 'AWAITING_DOCUMENTS',
        new_status: 'READY_FOR_REVIEW',
        changed_by_user_id: user.id,
        reason: `${uploadedCount} documento(s) enviado(s) na criação do pedido`,
      })
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      action: AuditAction.CREATE,
      newValues: {
        code: order.code,
        clinic_id,
        doctor_id,
        pharmacy_id,
        item_count: items.length,
        total_price: finalTotal,
      },
    })

    // Notify pharmacy
    try {
      const { data: pharmacy } = await adminClient
        .from('pharmacies')
        .select('email, trade_name')
        .eq('id', pharmacy_id)
        .single()

      const { data: clinic } = await adminClient
        .from('clinics')
        .select('trade_name')
        .eq('id', clinic_id)
        .single()

      const { data: doctor } = doctor_id
        ? await adminClient.from('doctors').select('full_name').eq('id', doctor_id).single()
        : { data: null }

      const productNames = items
        .map((i) => `${productMap[i.product_id]?.name ?? '—'} (×${i.quantity})`)
        .join(', ')

      const maxDeadline = Math.max(
        ...items.map((i) => productMap[i.product_id]?.estimated_deadline_days ?? 0)
      )

      if (pharmacy?.email) {
        const tmpl = newOrderEmail({
          orderCode: order.code,
          orderId: order.id,
          productName: productNames,
          quantity: items.reduce((s, i) => s + i.quantity, 0),
          totalPrice: formatCurrency(finalTotal),
          clinicName: clinic?.trade_name ?? '—',
          doctorName: doctor?.full_name ?? '—',
          deadline: `${maxDeadline} dias`,
        })
        await sendEmail({ to: pharmacy.email, ...tmpl })
      }

      // In-app + push notification for admins
      await createNotificationForRole('SUPER_ADMIN', {
        type: 'ORDER_CREATED',
        title: `Novo pedido ${order.code}`,
        body: `${clinic?.trade_name ?? '—'} · ${productNames} · ${formatCurrency(finalTotal)}`,
        link: `/orders/${order.id}`,
        push: true,
      })
      await createNotificationForRole('PLATFORM_ADMIN', {
        type: 'ORDER_CREATED',
        title: `Novo pedido ${order.code}`,
        body: `${clinic?.trade_name ?? '—'} · ${productNames}`,
        link: `/orders/${order.id}`,
        push: true,
      })

      // SMS confirmation to clinic on order creation
      const { data: clinicData } = await adminClient
        .from('clinics')
        .select('phone')
        .eq('id', clinic_id)
        .single()
      if (clinicData?.phone) {
        sendSms(clinicData.phone, SMS.orderCreated(order.code)).catch(() => null)
      }
    } catch {
      // email/notification failure must not affect order creation
    }

    revalidateTag('dashboard')
    return { orderId: order.id }
  } catch (err) {
    logger.error('createOrder error:', { error: err })
    if (err instanceof Error && err.message === 'UNAUTHORIZED')
      return { error: 'Sessão expirada. Faça login novamente.' }
    return { error: 'Erro interno. Tente novamente.' }
  }
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  reason?: string
): Promise<{ error?: string }> {
  try {
    const user = await requireAuth()
    const adminClient = createAdminClient()

    const { data: order, error: fetchError } = await adminClient
      .from('orders')
      .select('id, order_status, pharmacy_id, created_by_user_id')
      .eq('id', orderId)
      .single()

    if (fetchError || !order) return { error: 'Pedido não encontrado' }

    const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
    const isPharmacy = user.roles.includes('PHARMACY_ADMIN')

    if (!isAdmin && !isPharmacy) return { error: 'Sem permissão para alterar status do pedido' }

    // PHARMACY_ADMIN must own the pharmacy of this order
    if (isPharmacy && !isAdmin) {
      const { data: membership } = await adminClient
        .from('pharmacy_members')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .eq('pharmacy_id', order.pharmacy_id)
        .maybeSingle()

      if (!membership) return { error: 'Sem permissão: pedido pertence a outra farmácia' }
    }

    // Enforce state machine transitions
    const role = isAdmin ? 'admin' : 'pharmacy'
    if (!isValidTransition(order.order_status, newStatus, role)) {
      return {
        error: `Transição inválida: ${order.order_status} → ${newStatus} não é permitida para ${role}`,
      }
    }

    const { error: updateError } = await adminClient
      .from('orders')
      .update({ order_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId)

    if (updateError) return { error: 'Erro ao atualizar status' }

    const { error: histUpdateError } = await adminClient.from('order_status_history').insert({
      order_id: orderId,
      old_status: order.order_status,
      new_status: newStatus,
      changed_by_user_id: user.id,
      reason: reason ?? null,
    })
    if (histUpdateError)
      logger.error('[updateOrderStatus] failed to insert status history', {
        orderId,
        error: histUpdateError,
      })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: orderId,
      action: AuditAction.STATUS_CHANGE,
      oldValues: { status: order.order_status },
      newValues: { status: newStatus, reason },
    })

    const NOTIFY_STATUSES: Record<string, string> = {
      READY: 'Pronto para envio',
      SHIPPED: 'Enviado',
      DELIVERED: 'Entregue',
      COMPLETED: 'Concluído',
      CANCELED: 'Cancelado',
      WITH_ISSUE: 'Com problema',
    }

    if (NOTIFY_STATUSES[newStatus]) {
      try {
        const { data: fullOrder } = await adminClient
          .from('orders')
          .select('code, clinic_id, clinics(email, phone), order_items(products(name))')
          .eq('id', orderId)
          .single()

        const clinic = fullOrder?.clinics as { email?: string; phone?: string } | null
        const clinicEmail = clinic?.email
        const clinicPhone = clinic?.phone
        const itemsRaw = fullOrder?.order_items as Array<{
          products: { name: string }[] | null
        }> | null
        const productNames =
          itemsRaw
            ?.map(
              (i) =>
                (Array.isArray(i.products)
                  ? i.products[0]?.name
                  : (i.products as { name: string } | null)?.name) ?? '—'
            )
            .join(', ') ?? '—'

        if (clinicEmail) {
          const tmpl = orderStatusUpdatedEmail({
            orderCode: fullOrder?.code ?? orderId,
            orderId,
            newStatus,
            statusLabel: NOTIFY_STATUSES[newStatus],
            productName: productNames,
          })
          await sendEmail({ to: clinicEmail, ...tmpl })
        }

        // SMS + WhatsApp on key transitions
        const orderCode = fullOrder?.code ?? orderId
        if (clinicPhone) {
          if (newStatus === 'READY') {
            sendSms(clinicPhone, SMS.orderReady(orderCode)).catch(() => null)
            sendWhatsApp(clinicPhone, WA.orderReady(orderCode)).catch(() => null)
          } else if (newStatus === 'SHIPPED') {
            sendSms(clinicPhone, SMS.orderShipped(orderCode)).catch(() => null)
            sendWhatsApp(clinicPhone, WA.orderShipped(orderCode)).catch(() => null)
          } else if (newStatus === 'DELIVERED') {
            sendSms(clinicPhone, SMS.orderDelivered(orderCode)).catch(() => null)
            sendWhatsApp(clinicPhone, WA.orderDelivered(orderCode)).catch(() => null)
          } else if (newStatus === 'CANCELED') {
            sendSms(clinicPhone, SMS.orderCanceled(orderCode)).catch(() => null)
          }
        }

        // In-app notification for order creator
        await createNotification({
          userId: order.created_by_user_id,
          type: 'ORDER_STATUS',
          title: `Pedido ${fullOrder?.code ?? orderId}: ${NOTIFY_STATUSES[newStatus]}`,
          body: productNames,
          link: `/orders/${orderId}`,
          push: true,
        })
      } catch {
        // email/notification failure must not affect status update
      }
    }

    revalidateTag('dashboard')
    return {}
  } catch (err) {
    logger.error('updateOrderStatus error:', { error: err })
    return { error: 'Erro interno' }
  }
}
