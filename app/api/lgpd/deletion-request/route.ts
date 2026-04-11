import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotificationForRole } from '@/lib/notifications'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'

/**
 * POST /api/lgpd/deletion-request
 * LGPD Art. 18, VI — Direito de eliminação dos dados pessoais.
 * Creates a deletion request and notifies SUPER_ADMIN for manual review.
 * Data with legal retention obligations (financial, 10 years) is NOT auto-deleted.
 */
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}))
  const reason = (body.reason as string | undefined)?.slice(0, 500) ?? 'Sem motivo informado'

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  // Record the deletion request in audit_logs for traceability
  await createAuditLog({
    actorUserId: user.id,
    actorRole: 'SELF',
    entityType: AuditEntity.PROFILE,
    entityId: user.id,
    action: AuditAction.CREATE,
    newValues: { type: 'LGPD_DELETION_REQUEST', reason, requested_at: new Date().toISOString() },
  })

  // Notify SUPER_ADMIN for manual review
  await createNotificationForRole('SUPER_ADMIN', {
    type: 'GENERIC',
    title: `📋 Solicitação de exclusão de dados — LGPD`,
    message: `O usuário ${profile?.full_name ?? user.id} (${profile?.email ?? ''}) solicitou a exclusão de seus dados pessoais.\n\nMotivo: ${reason}\n\nAnalisar e executar anonimização via /api/admin/lgpd/anonymize/${user.id}`,
    link: `/admin/users/${user.id}`,
  })

  return NextResponse.json(
    {
      ok: true,
      message:
        'Sua solicitação de exclusão foi recebida e será analisada pela nossa equipe em até 15 dias úteis, conforme previsto na LGPD.',
    },
    { headers: { 'X-Request-ID': requestId } }
  )
}
