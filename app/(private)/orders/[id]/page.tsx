/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { OrderDetail } from '@/components/orders/order-detail'
import { ReorderButton } from '@/components/orders/reorder-button'
import { SaveTemplateModal } from '@/components/orders/templates/save-template-modal'
import { getPrescriptionState } from '@/lib/prescription-rules'

export const metadata: Metadata = {
  title: 'Detalhe do pedido',
}

interface OrderPageProps {
  params: Promise<{ id: string }>
}

export default async function OrderPage({ params }: OrderPageProps) {
  const { id } = await params
  const user = await getCurrentUser()
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      `
      *,
      clinics (id, trade_name, corporate_name, city, state),
      doctors (id, full_name, crm, crm_state, specialty),
      pharmacies (id, trade_name, city, state),
      order_items (
        id, product_id, quantity, unit_price, total_price,
        pharmacy_cost_per_unit, platform_commission_per_unit,
        coupon_id, discount_amount, original_total_price,
        products (id, name, concentration, presentation)
      ),
      order_documents (id, document_type, original_filename, mime_type, file_size, created_at),
      order_status_history (
        id, old_status, new_status, reason, created_at,
        profiles!changed_by_user_id (full_name)
      ),
      order_operational_updates (id, status, description, created_at),
      payments (id, gross_amount, status, payment_method, reference_code, confirmed_at, notes, asaas_payment_id, asaas_invoice_url, asaas_pix_qr_code, asaas_pix_copy_paste, asaas_boleto_url, payment_link, payment_due_date),
      commissions (id, commission_type, commission_percentage, commission_total_amount),
      transfers (id, gross_amount, commission_amount, net_amount, status, transfer_reference, processed_at)
    `
    )
    .eq('id', id)
    .single()

  if (!order) notFound()

  // Get tracking token
  const admin = createAdminClient()
  const { data: trackingToken } = await admin
    .from('order_tracking_tokens')
    .select('token')
    .eq('order_id', id)
    .single()

  // If no token yet, create one
  let token = trackingToken?.token
  if (!token) {
    const { data: newToken } = await admin
      .from('order_tracking_tokens')
      .insert({ order_id: id })
      .select('token')
      .single()
    token = newToken?.token
  }

  const trackingUrl = token ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/track/${token}` : null

  // Fetch prescription state server-side (empty if no controlled products)
  const prescriptionState = await getPrescriptionState(id)

  const canReorder = ['DELIVERED', 'COMPLETED', 'CANCELLED'].includes((order as any).order_status)
  const orderItems = ((order as any).order_items ?? []).map((i: any) => ({
    product_id: i.product_id,
    variant_id: i.variant_id ?? null,
    quantity: i.quantity,
    pharmacy_id: (order as any).pharmacy_id,
    unit_price: i.unit_price,
    pharmacy_cost_per_unit: i.pharmacy_cost_per_unit,
    product_name: i.products?.name,
  }))

  return (
    <div>
      {/* Tracking link + reorder actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {trackingUrl && (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-gray-50"
          >
            🔗 Link de rastreamento público
          </a>
        )}
        {canReorder && (
          <>
            <ReorderButton orderId={id} />
            {orderItems.length > 0 && (
              <SaveTemplateModal clinicId={(order as any).clinic_id} items={orderItems} />
            )}
          </>
        )}
      </div>
      <OrderDetail order={order} currentUser={user!} prescriptionItems={prescriptionState.items} />
    </div>
  )
}
