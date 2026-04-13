import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { getPrescriptionState } from '@/lib/prescription-rules'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/orders/[id]/prescription-state
 *
 * Returns current prescription fulfillment state for the order.
 * Used by the UI to render progress without a full page reload.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: orderId } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, clinic_id, pharmacy_id')
    .eq('id', orderId)
    .single()

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  if (!isAdmin) {
    const { data: clinicMember } = await admin
      .from('clinic_members')
      .select('id')
      .eq('clinic_id', order.clinic_id)
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: pharmacyMember } = await admin
      .from('pharmacy_members')
      .select('id')
      .eq('pharmacy_id', order.pharmacy_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!clinicMember && !pharmacyMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const state = await getPrescriptionState(orderId)
  return NextResponse.json(state)
}
