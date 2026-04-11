/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const reorderSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
  })
  .refine((d) => d.orderId || d.templateId, { message: 'orderId ou templateId obrigatório' })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = reorderSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { orderId, templateId } = parsed.data
  const admin = createAdminClient()

  // Resolve user roles for ownership check
  const { data: rolesData } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isAdmin = (rolesData?.length ?? 0) > 0
  let items: Array<{
    product_id: string
    variant_id: string | null
    quantity: number
    pharmacy_id: string
    unit_price: number
    pharmacy_cost_per_unit: number
  }> = []
  let clinicId: string
  let pharmacyId: string
  let doctorId: string | null = null

  if (orderId) {
    const { data: order } = await admin
      .from('orders')
      .select(
        'clinic_id, pharmacy_id, doctor_id, order_items(product_id, variant_id, quantity, unit_price, pharmacy_cost_per_unit)'
      )
      .eq('id', orderId)
      .single()

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // Verify user belongs to the source order's clinic (or is admin)
    if (!isAdmin) {
      const { data: membership } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('clinic_id', (order as any).clinic_id)
        .maybeSingle()
      if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    clinicId = (order as any).clinic_id
    pharmacyId = (order as any).pharmacy_id
    doctorId = (order as any).doctor_id ?? null
    items = ((order as any).order_items ?? []).map((i: any) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      quantity: i.quantity,
      pharmacy_id: pharmacyId,
      unit_price: i.unit_price,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit ?? 0,
    }))
  } else if (templateId) {
    const { data: template } = await admin
      .from('order_templates')
      .select('*')
      .eq('id', templateId)
      .single()

    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    // Verify user belongs to the template's clinic (or is admin)
    if (!isAdmin) {
      const { data: membership } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('clinic_id', (template as any).clinic_id)
        .maybeSingle()
      if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    clinicId = (template as any).clinic_id
    const templateItems = (template as any).items as Array<{
      product_id: string
      variant_id?: string
      quantity: number
      pharmacy_id: string
      unit_price: number
      pharmacy_cost_per_unit?: number
    }>
    pharmacyId = templateItems[0]?.pharmacy_id
    items = templateItems.map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      quantity: i.quantity,
      pharmacy_id: i.pharmacy_id,
      unit_price: i.unit_price,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit ?? 0,
    }))
  } else {
    return NextResponse.json({ error: 'orderId or templateId required' }, { status: 400 })
  }

  if (!items.length) return NextResponse.json({ error: 'No items to reorder' }, { status: 400 })
  if (!pharmacyId!)
    return NextResponse.json({ error: 'Pharmacy not found in source' }, { status: 400 })

  // doctor_id is required by schema — if missing use clinic's primary doctor
  if (!doctorId) {
    const { data: docLink } = await admin
      .from('doctor_clinic_links')
      .select('doctor_id')
      .eq('clinic_id', clinicId!)
      .eq('is_primary', true)
      .limit(1)
      .maybeSingle()
    doctorId = docLink?.doctor_id ?? null
  }
  if (!doctorId) {
    return NextResponse.json(
      { error: 'Médico não encontrado para esta clínica. Abra o pedido manualmente.' },
      { status: 422 }
    )
  }

  const totalAmount = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

  // Create new order — let DB trigger generate the code (MED-YYYY-NNNNNN format)
  const { data: newOrder, error: orderErr } = await admin
    .from('orders')
    .insert({
      code: '', // trigger generates it
      clinic_id: clinicId!,
      pharmacy_id: pharmacyId!,
      doctor_id: doctorId,
      order_status: 'DRAFT',
      total_price: totalAmount,
      payment_status: 'PENDING',
      transfer_status: 'NOT_READY',
      created_by_user_id: user.id,
    })
    .select('id, code')
    .single()

  if (orderErr || !newOrder) {
    return NextResponse.json(
      { error: orderErr?.message ?? 'Failed to create order' },
      { status: 500 }
    )
  }

  const orderId_new = (newOrder as any).id
  const code = (newOrder as any).code

  // Create order items (trigger will freeze prices from current product data)
  const { error: itemsErr } = await admin.from('order_items').insert(
    items.map((i) => ({
      order_id: orderId_new,
      product_id: i.product_id,
      variant_id: i.variant_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.unit_price * i.quantity,
      pharmacy_cost_per_unit: i.pharmacy_cost_per_unit,
    }))
  )
  if (itemsErr) {
    logger.error('[reorder] failed to insert order_items', {
      orderId: orderId_new,
      error: itemsErr,
    })
    await admin.from('orders').delete().eq('id', orderId_new)
    return NextResponse.json({ error: 'Erro ao copiar itens do pedido' }, { status: 500 })
  }

  // Initial status history (non-blocking)
  const { error: histErr } = await admin.from('order_status_history').insert({
    order_id: orderId_new,
    old_status: null,
    new_status: 'DRAFT',
    changed_by_user_id: user.id,
    reason: `Repetição de ${orderId ? `pedido ${orderId.slice(0, 8)}` : 'template'}`,
  })
  if (histErr)
    logger.error('[reorder] failed to insert status history', {
      orderId: orderId_new,
      error: histErr,
    })

  // Create tracking token (non-blocking)
  const { error: tokenErr } = await admin
    .from('order_tracking_tokens')
    .upsert(
      { order_id: orderId_new, expires_at: null },
      { onConflict: 'order_id', ignoreDuplicates: true }
    )
  if (tokenErr)
    logger.error('[reorder] failed to upsert tracking token', {
      orderId: orderId_new,
      error: tokenErr,
    })

  // Notify
  await createNotification({
    userId: user.id,
    type: 'ORDER_CREATED',
    title: `Pedido ${code} criado (repetição)`,
    message: `Pedido gerado a partir de ${orderId ? 'pedido anterior' : 'template'}. Complete os dados e confirme.`,
    link: `/orders/${orderId_new}`,
  })

  return NextResponse.json({ orderId: orderId_new, code }, { status: 201 })
}
