'use server'

import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/session'
import { orderSchema } from '@/lib/validators'
import type { OrderFormData } from '@/lib/validators'
import { sendEmail } from '@/lib/email'
import { newOrderEmail, orderStatusUpdatedEmail } from '@/lib/email/templates'
import { formatCurrency } from '@/lib/utils'

interface CreateOrderInput extends OrderFormData {
  documents?: File[]
}

interface CreateOrderResult {
  orderId?: string
  error?: string
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  try {
    const user = await requireAuth()

    const parsed = orderSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }

    const data = parsed.data
    const supabase = await createClient()
    const adminClient = createAdminClient()

    // Get product with pharmacy info (price will be frozen by trigger)
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, pharmacy_id, price_current, active')
      .eq('id', data.product_id)
      .single()

    if (productError || !product) {
      return { error: 'Produto não encontrado ou inativo' }
    }

    if (!product.active) {
      return { error: 'Este produto não está disponível no momento' }
    }

    // Create the order (price frozen by DB trigger)
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .insert({
        clinic_id: data.clinic_id,
        doctor_id: data.doctor_id,
        pharmacy_id: product.pharmacy_id,
        product_id: data.product_id,
        quantity: data.quantity,
        unit_price: product.price_current,
        total_price: product.price_current * data.quantity,
        order_status:
          (input.documents?.length ?? 0) > 0 ? 'AWAITING_DOCUMENTS' : 'AWAITING_DOCUMENTS',
        payment_status: 'PENDING',
        transfer_status: 'NOT_READY',
        notes: data.notes ?? null,
        created_by_user_id: user.id,
        code: '',
      })
      .select('id, code')
      .single()

    if (orderError || !order) {
      console.error('Order creation error:', orderError)
      return { error: 'Erro ao criar pedido. Tente novamente.' }
    }

    // Record initial status history
    await adminClient.from('order_status_history').insert({
      order_id: order.id,
      old_status: null,
      new_status: 'AWAITING_DOCUMENTS',
      changed_by_user_id: user.id,
      reason: 'Pedido criado',
    })

    // Create payment record
    await adminClient.from('payments').insert({
      order_id: order.id,
      payer_profile_id: user.id,
      gross_amount: product.price_current * data.quantity,
      status: 'PENDING',
      payment_method: 'MANUAL',
    })

    // Upload documents if any
    if (input.documents && input.documents.length > 0) {
      for (const file of input.documents) {
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
              document_type: 'PRESCRIPTION',
              storage_path: uploadData.path,
              original_filename: file.name,
              mime_type: file.type,
              file_size: file.size,
              uploaded_by_user_id: user.id,
            })
          }
        } catch (uploadErr) {
          console.error('Document upload error:', uploadErr)
          // Don't fail the whole order for upload errors
        }
      }
    }

    // Audit log
    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      action: AuditAction.CREATE,
      newValues: {
        code: order.code,
        product_id: data.product_id,
        clinic_id: data.clinic_id,
        doctor_id: data.doctor_id,
        quantity: data.quantity,
        total_price: product.price_current * data.quantity,
      },
    })

    // Notify pharmacy about new order
    try {
      const { data: pharmacy } = await adminClient
        .from('pharmacies')
        .select('email, trade_name')
        .eq('id', product.pharmacy_id)
        .single()

      const { data: clinic } = await adminClient
        .from('clinics')
        .select('trade_name')
        .eq('id', data.clinic_id)
        .single()

      const { data: doctor } = await adminClient
        .from('doctors')
        .select('full_name')
        .eq('id', data.doctor_id)
        .single()

      const { data: productInfo } = await adminClient
        .from('products')
        .select('name, estimated_deadline_days')
        .eq('id', data.product_id)
        .single()

      if (pharmacy?.email) {
        const tmpl = newOrderEmail({
          orderCode: order.code,
          orderId: order.id,
          productName: productInfo?.name ?? '—',
          quantity: data.quantity,
          totalPrice: formatCurrency(product.price_current * data.quantity),
          clinicName: clinic?.trade_name ?? '—',
          doctorName: doctor?.full_name ?? '—',
          deadline: `${productInfo?.estimated_deadline_days ?? '—'} dias`,
        })
        await sendEmail({ to: pharmacy.email, ...tmpl })
      }
    } catch {
      // email failure must not affect order creation
    }

    return { orderId: order.id }
  } catch (err) {
    console.error('createOrder error:', err)
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return { error: 'Sessão expirada. Faça login novamente.' }
    }
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

    if (fetchError || !order) {
      return { error: 'Pedido não encontrado' }
    }

    const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
    const isPharmacy = user.roles.includes('PHARMACY_ADMIN')

    if (!isAdmin && !isPharmacy) {
      return { error: 'Sem permissão para alterar status do pedido' }
    }

    const { error: updateError } = await adminClient
      .from('orders')
      .update({ order_status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId)

    if (updateError) {
      return { error: 'Erro ao atualizar status' }
    }

    // Manual history record (trigger also records this, but we add the reason)
    await adminClient.from('order_status_history').insert({
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
      action: AuditAction.STATUS_CHANGE,
      oldValues: { status: order.order_status },
      newValues: { status: newStatus, reason },
    })

    // Notify clinic about status updates relevant to them
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
          .select('code, clinic_id, clinics(email), products(name)')
          .eq('id', orderId)
          .single()

        const clinicEmail = (fullOrder?.clinics as { email?: string } | null)?.email
        if (clinicEmail) {
          const tmpl = orderStatusUpdatedEmail({
            orderCode: fullOrder?.code ?? orderId,
            orderId,
            newStatus,
            statusLabel: NOTIFY_STATUSES[newStatus],
            productName: (fullOrder?.products as { name?: string } | null)?.name ?? '—',
          })
          await sendEmail({ to: clinicEmail, ...tmpl })
        }
      } catch {
        // email failure must not affect status update
      }
    }

    return {}
  } catch (err) {
    console.error('updateOrderStatus error:', err)
    return { error: 'Erro interno' }
  }
}
