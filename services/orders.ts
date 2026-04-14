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

const createOrderSchema = z
  .object({
    buyer_type: z.enum(['CLINIC', 'DOCTOR']).default('CLINIC'),
    clinic_id: uuidLoose.optional().nullable(),
    doctor_id: uuidLoose.optional().nullable(),
    delivery_address_id: uuidLoose.optional().nullable(),
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
  .superRefine((d, ctx) => {
    if (d.buyer_type === 'CLINIC' && !d.clinic_id) {
      ctx.addIssue({ code: 'custom', path: ['clinic_id'], message: 'Clínica é obrigatória' })
    }
    if (d.buyer_type === 'DOCTOR' && !d.doctor_id) {
      ctx.addIssue({ code: 'custom', path: ['doctor_id'], message: 'Médico é obrigatório' })
    }
    if (d.buyer_type === 'DOCTOR' && !d.delivery_address_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['delivery_address_id'],
        message: 'Endereço de entrega é obrigatório',
      })
    }
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

    const {
      buyer_type,
      clinic_id = null,
      doctor_id = null,
      delivery_address_id = null,
      notes,
      items,
    } = parsed.data
    const supabase = await createClient()
    const adminClient = createAdminClient()

    const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

    if (buyer_type === 'CLINIC') {
      // CLINIC_ADMIN must belong to the clinic they are ordering for
      if (!isAdmin) {
        const { data: membership } = await adminClient
          .from('clinic_members')
          .select('clinic_id')
          .eq('user_id', user.id)
          .eq('clinic_id', clinic_id!)
          .maybeSingle()
        if (!membership) return { error: 'Sem permissão para criar pedido para esta clínica' }
      }
    } else {
      // DOCTOR buyer — must be the logged-in doctor themselves
      const { data: myDoctor } = await adminClient
        .from('doctors')
        .select('id, cpf')
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .maybeSingle()
      if (!myDoctor) return { error: 'Perfil de médico não encontrado' }
      if (myDoctor.id !== doctor_id)
        return { error: 'Sem permissão para criar pedido para este médico' }
      if (!myDoctor.cpf)
        return { error: 'CPF não cadastrado. Atualize seu perfil antes de fazer uma compra solo.' }

      // Validate that delivery address belongs to this doctor
      const { data: addr } = await adminClient
        .from('doctor_addresses')
        .select('id')
        .eq('id', delivery_address_id!)
        .eq('doctor_id', myDoctor.id)
        .maybeSingle()
      if (!addr) return { error: 'Endereço de entrega inválido' }
    }

    // Validate all products and get pharmacy (all items must be from same pharmacy)
    const productIds = items.map((i) => i.product_id)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select(
        'id, pharmacy_id, price_current, name, estimated_deadline_days, active, requires_prescription'
      )
      .in('id', productIds)

    if (productsError || !products?.length) return { error: 'Produtos não encontrados' }
    if (products.some((p) => !p.active)) return { error: 'Um ou mais produtos estão inativos' }

    // Prescription guard: if any product requires a prescription, a doctor must be identified.
    // For CLINIC orders this means doctor_id must be provided (clinic has at least one linked doctor).
    // For DOCTOR solo orders doctor_id is always set, so this is a no-op for that path.
    const hasRxProduct = products.some((p) => p.requires_prescription)
    if (hasRxProduct && !doctor_id) {
      return {
        error:
          'Um ou mais produtos exigem receita médica. Vincule um médico à clínica antes de realizar este pedido.',
      }
    }

    const pharmacyIds = [...new Set(products.map((p) => p.pharmacy_id))]
    if (pharmacyIds.length > 1) return { error: 'Todos os produtos devem ser da mesma farmácia' }

    const pharmacy_id = pharmacyIds[0]

    // Compliance check — clinic buyer: clinic + pharmacy must be active
    //                   doctor buyer: only pharmacy is validated (clinic skipped)
    const compliance = await canPlaceOrder(clinic_id, pharmacy_id, undefined, buyer_type)
    if (!compliance.allowed)
      return { error: compliance.reason ?? 'Pedido bloqueado por regra de compliance' }

    // Calculate initial total (will be recalculated by trigger)
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
    const estimatedTotal = items.reduce((sum, item) => {
      const p = productMap[item.product_id]
      return sum + (p?.price_current ?? 0) * item.quantity
    }, 0)

    // Auto-detect active coupons — clinic coupons for CLINIC buyer, doctor coupons for DOCTOR buyer
    const couponMap = await getActiveCouponsForOrder(
      buyer_type === 'CLINIC' ? clinic_id : null,
      productIds,
      buyer_type === 'DOCTOR' ? doctor_id : null
    )

    // Create order header
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .insert({
        buyer_type,
        clinic_id: buyer_type === 'CLINIC' ? clinic_id : null,
        doctor_id,
        delivery_address_id: buyer_type === 'DOCTOR' ? delivery_address_id : null,
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
        buyer_type,
        clinic_id: clinic_id ?? null,
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

      const { data: clinic } =
        buyer_type === 'CLINIC' && clinic_id
          ? await adminClient.from('clinics').select('trade_name').eq('id', clinic_id).single()
          : { data: null }

      const { data: doctor } = doctor_id
        ? await adminClient.from('doctors').select('full_name').eq('id', doctor_id).single()
        : { data: null }

      // Buyer display name: clinic trade name or doctor name
      const buyerName =
        buyer_type === 'CLINIC' ? (clinic?.trade_name ?? '—') : (doctor?.full_name ?? '—')

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
          clinicName: buyerName,
          doctorName: doctor?.full_name ?? '—',
          deadline: `${maxDeadline} dias`,
        })
        await sendEmail({ to: pharmacy.email, ...tmpl })
      }

      // In-app + push notification for admins
      await createNotificationForRole('SUPER_ADMIN', {
        type: 'ORDER_CREATED',
        title: `Novo pedido ${order.code}`,
        body: `${buyerName} · ${productNames} · ${formatCurrency(finalTotal)}`,
        link: `/orders/${order.id}`,
        push: true,
      })
      await createNotificationForRole('PLATFORM_ADMIN', {
        type: 'ORDER_CREATED',
        title: `Novo pedido ${order.code}`,
        body: `${buyerName} · ${productNames}`,
        link: `/orders/${order.id}`,
        push: true,
      })

      // SMS confirmation to buyer (clinic or doctor)
      if (buyer_type === 'CLINIC' && clinic_id) {
        const { data: clinicData } = await adminClient
          .from('clinics')
          .select('phone')
          .eq('id', clinic_id)
          .single()
        if (clinicData?.phone) {
          sendSms(clinicData.phone, SMS.orderCreated(order.code)).catch(() => null)
        }
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

    // ── Auto-void payments and transfers when order is canceled ──────────────
    if (newStatus === 'CANCELED') {
      try {
        await handleOrderCancellationFinancials(orderId, user.id, user.roles[0], adminClient)
      } catch (err) {
        // Financial cleanup failure must never block the status update
        logger.error('[updateOrderStatus] financial cleanup failed on cancel', {
          orderId,
          error: err,
        })
      }
    }

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

/**
 * Voids pending payments and pending transfers when an order is canceled.
 *
 * Rules:
 *  - payment PENDING | UNDER_REVIEW  → CANCELED (no money involved)
 *  - payment CONFIRMED               → kept as-is + urgent admin notification (manual refund needed)
 *  - transfer NOT_READY | PENDING    → CANCELED (money not yet sent)
 *  - transfer COMPLETED              → kept as-is + urgent admin notification (manual reversal needed)
 *  - payment FAILED | REFUNDED       → no action
 *  - transfer FAILED                 → no action
 */
async function handleOrderCancellationFinancials(
  orderId: string,
  actorUserId: string,
  actorRole: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any
): Promise<void> {
  const now = new Date().toISOString()

  // ── Payment ────────────────────────────────────────────────────────────────
  const { data: payment } = await adminClient
    .from('payments')
    .select('id, status, gross_amount')
    .eq('order_id', orderId)
    .maybeSingle()

  if (payment) {
    if (['PENDING', 'UNDER_REVIEW'].includes(payment.status)) {
      const { error: paymentCancelErr } = await adminClient
        .from('payments')
        .update({ status: 'CANCELED', updated_at: now })
        .eq('id', payment.id)
      if (paymentCancelErr)
        throw new Error(
          `[handleOrderCancellationFinancials] payment update failed: ${paymentCancelErr.message}`
        )

      await createAuditLog({
        actorUserId,
        actorRole,
        entityType: AuditEntity.PAYMENT,
        entityId: payment.id,
        action: AuditAction.STATUS_CHANGE,
        oldValues: { status: payment.status },
        newValues: {
          status: 'CANCELED',
          reason: 'Pedido cancelado — pagamento anulado automaticamente',
        },
      })
    } else if (payment.status === 'CONFIRMED') {
      // Flag for manual refund — also notify so the admin knows immediately
      await adminClient.from('payments').update({ needs_manual_refund: true }).eq('id', payment.id)

      const amount = formatCurrency(Number(payment.gross_amount))
      const payload = {
        type: 'GENERIC' as const,
        title: '⚠️ Pedido cancelado com pagamento confirmado',
        body: `O pedido foi cancelado, mas o pagamento de ${amount} já foi confirmado. Registre o estorno em Pagamentos quando concluído.`,
        link: `/payments`,
        push: true,
      }
      await Promise.all([
        createNotificationForRole('SUPER_ADMIN', payload),
        createNotificationForRole('PLATFORM_ADMIN', payload),
      ])
    }
  }

  // ── Transfer ───────────────────────────────────────────────────────────────
  const { data: transfer } = await adminClient
    .from('transfers')
    .select('id, status, net_amount')
    .eq('order_id', orderId)
    .maybeSingle()

  if (transfer) {
    if (['NOT_READY', 'PENDING'].includes(transfer.status)) {
      const { error: transferCancelErr } = await adminClient
        .from('transfers')
        .update({ status: 'CANCELED', updated_at: now })
        .eq('id', transfer.id)
      if (transferCancelErr)
        throw new Error(
          `[handleOrderCancellationFinancials] transfer update failed: ${transferCancelErr.message}`
        )

      await createAuditLog({
        actorUserId,
        actorRole,
        entityType: AuditEntity.TRANSFER,
        entityId: transfer.id,
        action: AuditAction.STATUS_CHANGE,
        oldValues: { status: transfer.status },
        newValues: {
          status: 'CANCELED',
          reason: 'Pedido cancelado — repasse anulado automaticamente',
        },
      })
    } else if (transfer.status === 'COMPLETED') {
      // Flag for manual reversal — also notify so the admin knows immediately
      await adminClient
        .from('transfers')
        .update({ needs_manual_reversal: true })
        .eq('id', transfer.id)

      const amount = formatCurrency(Number(transfer.net_amount))
      const payload = {
        type: 'GENERIC' as const,
        title: '⚠️ Pedido cancelado com repasse já processado',
        body: `O pedido foi cancelado, mas o repasse de ${amount} à farmácia já foi concluído. Registre a reversão em Repasses quando concluído.`,
        link: `/transfers`,
        push: true,
      }
      await Promise.all([
        createNotificationForRole('SUPER_ADMIN', payload),
        createNotificationForRole('PLATFORM_ADMIN', payload),
      ])
    }
  }
}
