import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

// Signed URL expires in 5 minutes — enough to open/download, short enough to limit sharing
const SIGNED_URL_EXPIRES_IN = 300

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  // Fetch document and its order to check access
  const { data: doc } = await admin
    .from('order_documents')
    .select('id, storage_path, original_filename, mime_type, order_id')
    .eq('id', id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })

  // Fetch the order to verify access rights
  const { data: order } = await admin
    .from('orders')
    .select('id, clinic_id, pharmacy_id, created_by_user_id')
    .eq('id', doc.order_id)
    .single()

  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })

  const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isOrderOwner = order.created_by_user_id === user.id

  // Check clinic membership
  const { data: clinicMember } = await admin
    .from('clinic_members')
    .select('user_id')
    .eq('clinic_id', order.clinic_id)
    .eq('user_id', user.id)
    .maybeSingle()

  // Check pharmacy membership
  const { data: pharmacyMember } = await admin
    .from('pharmacy_members')
    .select('user_id')
    .eq('pharmacy_id', order.pharmacy_id)
    .eq('user_id', user.id)
    .maybeSingle()

  const hasAccess = isAdmin || isOrderOwner || !!clinicMember || !!pharmacyMember

  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Generate a short-lived signed URL from Supabase Storage
  const { data: signed, error: signError } = await admin.storage
    .from('order-documents')
    .createSignedUrl(doc.storage_path, SIGNED_URL_EXPIRES_IN, {
      download: doc.original_filename,
    })

  if (signError || !signed?.signedUrl) {
    logger.error('[document/download] failed to create signed URL', {
      docId: id,
      error: signError,
    })
    return NextResponse.json({ error: 'Erro ao gerar link de download' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
