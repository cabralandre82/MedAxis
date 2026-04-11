import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { decrypt } from '@/lib/crypto'

/**
 * GET /api/lgpd/export
 * LGPD Art. 18, I — Direito de acesso aos dados pessoais.
 * Returns a JSON bundle of all personal data for the authenticated user.
 */
export async function GET(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    )
  }

  const admin = createAdminClient()

  // Profile
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, phone_encrypted, role, status, created_at')
    .eq('id', user.id)
    .single()

  // Orders (as clinic member)
  const { data: clinicMemberships } = await admin
    .from('clinic_members')
    .select('clinic_id, clinics(trade_name)')
    .eq('user_id', user.id)

  const clinicIds = clinicMemberships?.map((m) => m.clinic_id) ?? []

  const { data: orders } = clinicIds.length
    ? await admin
        .from('orders')
        .select('id, code, order_status, total_price, created_at')
        .in('clinic_id', clinicIds)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [] }

  // Notifications
  const { data: notifications } = await admin
    .from('notifications')
    .select('id, type, title, message, created_at, read_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  // Audit logs (actions performed by this user)
  const { data: auditLogs } = await admin
    .from('audit_logs')
    .select('id, entity_type, entity_id, action, created_at')
    .eq('actor_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)

  const bundle = {
    exported_at: new Date().toISOString(),
    user_id: user.id,
    profile: profile
      ? {
          ...profile,
          phone: decrypt(profile.phone_encrypted) ?? profile.phone,
          phone_encrypted: undefined,
        }
      : null,
    clinic_memberships: clinicMemberships ?? [],
    orders: orders ?? [],
    notifications: notifications ?? [],
    audit_logs: auditLogs ?? [],
  }

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="clinipharma-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      'X-Request-ID': requestId,
    },
  })
}
