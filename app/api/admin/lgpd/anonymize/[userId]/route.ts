import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { revokeAllUserTokens } from '@/lib/token-revocation'

/**
 * POST /api/admin/lgpd/anonymize/:userId
 * LGPD Art. 18, VI — Executa anonimização de PII do usuário.
 * Preserva dados financeiros (obrigação legal 10 anos — CTN Art. 195).
 * Somente SUPER_ADMIN pode executar.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const { userId } = await params

    if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) {
      return NextResponse.json(
        { error: 'Invalid userId' },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      )
    }

    const admin = createAdminClient()

    // 1. Fetch current profile for audit log
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', userId)
      .single()

    if (!profile) {
      return NextResponse.json(
        { error: 'Usuário não encontrado' },
        { status: 404, headers: { 'X-Request-ID': requestId } }
      )
    }

    // 2. Anonymize profile PII
    await admin
      .from('profiles')
      .update({
        full_name: `Usuário Anonimizado`,
        email: `anon-${userId.slice(0, 8)}@deleted.clinipharma.invalid`,
        phone: null,
        phone_encrypted: null,
        status: 'INACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    // 3. Anonymize doctor record if exists
    await admin
      .from('doctors')
      .update({
        full_name: `Médico Anonimizado`,
        email: `anon-${userId.slice(0, 8)}@deleted.clinipharma.invalid`,
        crm: null,
        crm_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    // 4. Soft-delete notifications (not financial/audit data)
    await admin.from('notifications').delete().eq('user_id', userId)

    // 5. Revoke all active sessions immediately
    await revokeAllUserTokens(userId)

    // 6. Deactivate Supabase Auth user
    await admin.auth.admin.updateUserById(userId, {
      email: `anon-${userId.slice(0, 8)}@deleted.clinipharma.invalid`,
      ban_duration: 'none',
    })

    // 7. Audit log (preserve for legal compliance)
    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.DELETE,
      oldValues: { full_name: profile.full_name, email: profile.email },
      newValues: { anonymized: true, reason: 'LGPD Art. 18 VI — solicitação de exclusão' },
    })

    return NextResponse.json(
      {
        ok: true,
        anonymized: userId,
        preserved: ['orders', 'payments', 'commissions', 'audit_logs'],
        message: 'PII anonimizada. Dados financeiros preservados conforme CTN Art. 195.',
      },
      { headers: { 'X-Request-ID': requestId } }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return NextResponse.json(
        { error: 'Sem permissão' },
        { status: 403, headers: { 'X-Request-ID': requestId } }
      )
    }
    console.error('[lgpd/anonymize] error:', err)
    return NextResponse.json(
      { error: 'Erro interno' },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    )
  }
}
