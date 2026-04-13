import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createAuditLog, AuditEntity, AuditAction } from '@/lib/audit'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 20 })

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/orders/[id]/prescriptions
 *
 * Upload one prescription linked to a specific order item (Model B).
 * Body: multipart/form-data
 *   - file:              File
 *   - orderItemId:       uuid
 *   - patientName:       string (optional)
 *   - prescriptionNumber: string (optional)
 *   - unitsCovered:      integer (default 1)
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: orderId } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await uploadLimiter.check(`rx-upload:${user.id}`)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitos uploads. Aguarde um minuto.' }, { status: 429 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const orderItemId = formData.get('orderItemId')?.toString()
  const patientName = formData.get('patientName')?.toString() ?? null
  const prescriptionNumber = formData.get('prescriptionNumber')?.toString() ?? null
  const unitsCovered = parseInt(formData.get('unitsCovered')?.toString() ?? '1', 10)

  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })
  if (!orderItemId) return NextResponse.json({ error: 'orderItemId obrigatório' }, { status: 400 })
  if (isNaN(unitsCovered) || unitsCovered < 1) {
    return NextResponse.json({ error: 'unitsCovered deve ser >= 1' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Tipo de arquivo não permitido: ${file.type}` },
      { status: 400 }
    )
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Arquivo excede 10 MB' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify order exists and user belongs to the clinic
  const { data: order } = await admin
    .from('orders')
    .select('id, clinic_id, order_status')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })

  const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  if (!isAdmin) {
    const { data: membership } = await admin
      .from('clinic_members')
      .select('id')
      .eq('clinic_id', order.clinic_id)
      .eq('user_id', user.id)
      .single()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the order item belongs to this order
  const { data: orderItem } = await admin
    .from('order_items')
    .select(
      'id, product_id, quantity, products(name, requires_prescription, max_units_per_prescription)'
    )
    .eq('id', orderItemId)
    .eq('order_id', orderId)
    .single()

  if (!orderItem) {
    return NextResponse.json({ error: 'Item do pedido não encontrado' }, { status: 404 })
  }

  const product = orderItem.products as unknown as {
    name: string
    requires_prescription: boolean
    max_units_per_prescription: number | null
  } | null

  if (!product?.requires_prescription) {
    return NextResponse.json({ error: 'Este produto não exige receita médica' }, { status: 422 })
  }

  // Check if more prescriptions are actually needed
  if (product.max_units_per_prescription !== null) {
    const { data: existing } = await admin
      .from('order_item_prescriptions')
      .select('units_covered')
      .eq('order_item_id', orderItemId)

    const totalCovered = (existing ?? []).reduce((acc, r) => acc + r.units_covered, 0)
    if (totalCovered >= orderItem.quantity) {
      return NextResponse.json(
        { error: 'Todas as unidades deste item já têm receita enviada' },
        { status: 422 }
      )
    }
  }

  // Upload to storage
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${orderId}/items/${orderItemId}/${Date.now()}-${sanitizedName}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { data: uploadData, error: uploadError } = await admin.storage
    .from('order-documents')
    .upload(storagePath, buffer, { contentType: file.type })

  if (uploadError || !uploadData) {
    logger.error('[prescriptions] Storage upload failed', { error: uploadError, orderId })
    return NextResponse.json({ error: 'Erro ao fazer upload' }, { status: 500 })
  }

  // Insert record
  const { data: record, error: insertError } = await admin
    .from('order_item_prescriptions')
    .insert({
      order_item_id: orderItemId,
      order_id: orderId,
      storage_path: uploadData.path,
      original_filename: file.name,
      mime_type: file.type,
      file_size: file.size,
      patient_name: patientName,
      prescription_number: prescriptionNumber,
      units_covered: unitsCovered,
      uploaded_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (insertError || !record) {
    logger.error('[prescriptions] Insert failed', { error: insertError, orderId })
    return NextResponse.json({ error: 'Erro ao registrar receita' }, { status: 500 })
  }

  await createAuditLog({
    actorUserId: user.id,
    actorRole: user.roles[0],
    entityType: AuditEntity.ORDER,
    entityId: orderId,
    action: AuditAction.UPDATE,
    newValues: {
      event: 'prescription_uploaded',
      prescription_id: record.id,
      order_item_id: orderItemId,
      units_covered: unitsCovered,
      product_name: product.name,
    },
  })

  return NextResponse.json({ success: true, id: record.id })
}
