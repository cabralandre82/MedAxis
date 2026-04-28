import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { advanceOrderAfterDocumentUpload } from '@/lib/orders/document-transitions'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 20 }) // 20 uploads/min per user

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await uploadLimiter.check(`upload:${user.id}`)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Muitos uploads. Aguarde um minuto antes de tentar novamente.' },
      { status: 429 }
    )
  }

  const formData = await req.formData()
  const orderId = formData.get('orderId')?.toString()
  const documentType = formData.get('documentType')?.toString() ?? 'OTHER'
  const files = formData.getAll('files') as File[]

  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })
  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 })

  const admin = createAdminClient()

  // Verify the user has access to this order
  const { data: order } = await admin
    .from('orders')
    .select('id, created_by_user_id, clinic_id')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isOwner = order.created_by_user_id === user.id
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const uploaded: string[] = []

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Tipo de arquivo não permitido: ${file.type}` },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `Arquivo muito grande: ${file.name}` }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    const fileName = `${orderId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { data: uploadData, error: uploadError } = await admin.storage
      .from('order-documents')
      .upload(fileName, buffer, { contentType: file.type })

    if (uploadError || !uploadData) {
      logger.error('Storage upload error', { error: uploadError, file: file.name })
      return NextResponse.json({ error: 'Erro ao fazer upload' }, { status: 500 })
    }

    await admin.from('order_documents').insert({
      order_id: orderId,
      document_type: documentType,
      storage_path: uploadData.path,
      original_filename: file.name,
      mime_type: file.type,
      file_size: file.size,
      uploaded_by_user_id: user.id,
    })

    uploaded.push(uploadData.path)
  }

  // Couple document upload to order state — moves AWAITING_DOCUMENTS to
  // READY_FOR_REVIEW so the pharmacy can run analysis. See
  // lib/orders/document-transitions.ts for the rationale.
  let transitioned = false
  let newStatus: string | null = null
  if (uploaded.length > 0) {
    const result = await advanceOrderAfterDocumentUpload({
      orderId,
      changedByUserId: user.id,
      reason: `${uploaded.length} documento(s) enviado(s) — análise solicitada`,
    })
    transitioned = result.transitioned
    newStatus = result.status
  }

  return NextResponse.json({
    success: true,
    uploaded,
    order_status: newStatus,
    transitioned,
  })
}
