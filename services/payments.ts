'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { sendEmail } from '@/lib/email'
import { paymentConfirmedEmail, transferRegisteredEmail } from '@/lib/email/templates'
import { formatCurrency } from '@/lib/utils'

interface ConfirmPaymentInput {
  paymentId: string
  paymentMethod: string
  referenceCode?: string
  notes?: string
}

export async function confirmPayment(input: ConfirmPaymentInput): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: payment, error: fetchError } = await adminClient
      .from('payments')
      .select('id, order_id, gross_amount, status')
      .eq('id', input.paymentId)
      .single()

    if (fetchError || !payment) return { error: 'Pagamento não encontrado' }
    if (payment.status !== 'PENDING') return { error: 'Pagamento já processado' }

    // Fetch order with frozen cost fields + clinic consultant
    const { data: orderData } = await adminClient
      .from('orders')
      .select(
        'id, pharmacy_id, clinic_id, total_price, quantity, pharmacy_cost_per_unit, platform_commission_per_unit, clinics(consultant_id)'
      )
      .eq('id', payment.order_id)
      .single()

    if (!orderData) return { error: 'Pedido não encontrado' }

    const qty = Number(orderData.quantity)

    // Financial breakdown — uses frozen values when available, falls back to product current
    let pharmacyTransfer: number
    let platformCommission: number

    if (
      orderData.pharmacy_cost_per_unit != null &&
      orderData.platform_commission_per_unit != null
    ) {
      // Frozen at order creation (normal path)
      pharmacyTransfer = Math.round(Number(orderData.pharmacy_cost_per_unit) * qty * 100) / 100
      platformCommission =
        Math.round(Number(orderData.platform_commission_per_unit) * qty * 100) / 100
    } else {
      // Fallback for orders created before migration 005
      const { data: product } = await adminClient
        .from('products')
        .select('price_current, pharmacy_cost')
        .eq('id', (orderData as Record<string, unknown>).product_id as string)
        .single()

      const pCost = Number(product?.pharmacy_cost ?? 0)
      const pPrice = Number(product?.price_current ?? payment.gross_amount / qty)
      pharmacyTransfer = Math.round(pCost * qty * 100) / 100
      platformCommission = Math.round((pPrice - pCost) * qty * 100) / 100
    }

    // Confirm payment
    await adminClient
      .from('payments')
      .update({
        status: 'CONFIRMED',
        payment_method: input.paymentMethod,
        reference_code: input.referenceCode ?? null,
        notes: input.notes ?? null,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.paymentId)

    // Platform commission record
    await adminClient.from('commissions').insert({
      order_id: payment.order_id,
      commission_type: 'FIXED',
      commission_fixed_amount: platformCommission,
      commission_total_amount: platformCommission,
      calculated_by_user_id: user.id,
    })

    // Pharmacy transfer record (net_amount = what pharmacy receives)
    await adminClient.from('transfers').insert({
      order_id: payment.order_id,
      pharmacy_id: orderData.pharmacy_id,
      gross_amount: Number(orderData.total_price),
      commission_amount: platformCommission,
      net_amount: pharmacyTransfer,
      status: 'PENDING',
    })

    // Consultant commission (global rate from app_settings)
    const clinic = orderData.clinics as { consultant_id?: string | null } | null
    if (clinic?.consultant_id) {
      const { data: setting } = await adminClient
        .from('app_settings')
        .select('value_json')
        .eq('key', 'consultant_commission_rate')
        .single()

      const consultantRate = Number(setting?.value_json ?? 5)
      const consultantCommission =
        Math.round(Number(orderData.total_price) * consultantRate * 100) / 10000

      await adminClient.from('consultant_commissions').insert({
        order_id: payment.order_id,
        consultant_id: clinic.consultant_id,
        order_total: Number(orderData.total_price),
        commission_rate: consultantRate,
        commission_amount: consultantCommission,
        status: 'PENDING',
      })
    }

    // Update order status
    await adminClient
      .from('orders')
      .update({
        payment_status: 'CONFIRMED',
        order_status: 'COMMISSION_CALCULATED',
        transfer_status: 'PENDING',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.order_id)

    await adminClient.from('order_status_history').insert({
      order_id: payment.order_id,
      old_status: 'AWAITING_PAYMENT',
      new_status: 'COMMISSION_CALCULATED',
      changed_by_user_id: user.id,
      reason: `Pagamento confirmado (${input.paymentMethod}${input.referenceCode ? ' · ref: ' + input.referenceCode : ''})`,
    })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PAYMENT,
      entityId: input.paymentId,
      action: AuditAction.PAYMENT_CONFIRMED,
      newValues: {
        order_id: payment.order_id,
        order_total: orderData.total_price,
        pharmacy_transfer: pharmacyTransfer,
        platform_commission: platformCommission,
      },
    })

    // Notify clinic contact
    const { data: clinicData } = await adminClient
      .from('clinics')
      .select('email, trade_name')
      .eq('id', orderData.clinic_id)
      .single()

    const { data: orderProduct } = await adminClient
      .from('orders')
      .select('products(name)')
      .eq('id', payment.order_id)
      .single()

    if (clinicData?.email) {
      const tmpl = paymentConfirmedEmail({
        orderCode: payment.order_id,
        orderId: payment.order_id,
        productName: (orderProduct?.products as { name?: string } | null)?.name ?? '—',
        totalPrice: formatCurrency(Number(orderData.total_price)),
        clinicName: clinicData.trade_name,
      })
      await sendEmail({ to: clinicData.email, ...tmpl })
    }

    return {}
  } catch (err) {
    console.error('confirmPayment error:', err)
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function completeTransfer(
  transferId: string,
  reference: string,
  notes?: string
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: transfer, error: fetchError } = await adminClient
      .from('transfers')
      .select('id, order_id, status, net_amount, pharmacy_id')
      .eq('id', transferId)
      .single()

    if (fetchError || !transfer) return { error: 'Repasse não encontrado' }
    if (transfer.status === 'COMPLETED') return { error: 'Repasse já concluído' }

    await adminClient
      .from('transfers')
      .update({
        status: 'COMPLETED',
        transfer_reference: reference,
        notes: notes ?? null,
        processed_by_user_id: user.id,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transferId)

    await adminClient
      .from('orders')
      .update({
        transfer_status: 'COMPLETED',
        order_status: 'RELEASED_FOR_EXECUTION',
        updated_at: new Date().toISOString(),
      })
      .eq('id', transfer.order_id)

    await adminClient.from('order_status_history').insert({
      order_id: transfer.order_id,
      old_status: 'TRANSFER_PENDING',
      new_status: 'RELEASED_FOR_EXECUTION',
      changed_by_user_id: user.id,
      reason: `Repasse à farmácia registrado · ref: ${reference}`,
    })

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.TRANSFER,
      entityId: transferId,
      action: AuditAction.TRANSFER_REGISTERED,
      newValues: { order_id: transfer.order_id, net_amount: transfer.net_amount, reference },
    })

    // Notify pharmacy
    const { data: pharmacyData } = await adminClient
      .from('pharmacies')
      .select('email, trade_name')
      .eq('id', transfer.pharmacy_id)
      .single()

    if (pharmacyData?.email) {
      const { data: orderForCode } = await adminClient
        .from('orders')
        .select('code')
        .eq('id', transfer.order_id)
        .single()

      const tmpl = transferRegisteredEmail({
        orderId: transfer.order_id,
        orderCode: orderForCode?.code ?? transfer.order_id,
        pharmacyName: pharmacyData.trade_name,
        netAmount: formatCurrency(Number(transfer.net_amount)),
        reference,
      })
      await sendEmail({ to: pharmacyData.email, ...tmpl })
    }

    return {}
  } catch (err) {
    console.error('completeTransfer error:', err)
    return { error: 'Erro interno' }
  }
}
