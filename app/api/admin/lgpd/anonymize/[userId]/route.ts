import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { createAuditLog, AuditAction, AuditEntity, logPiiView } from '@/lib/audit'
import { revokeAllUserTokens } from '@/lib/token-revocation'
import { logger } from '@/lib/logger'
import { transitionDsarRequest, hashCanonicalBundle } from '@/lib/dsar'
import { isUnderLegalHold } from '@/lib/legal-hold'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter, Metrics } from '@/lib/metrics'

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

    // Wave 13 — refuse to anonymise a subject under legal hold when
    // the enforce flag is ON. Always emit the metric so we can
    // observe "would-have-blocked" during the ramp-up period.
    if (await isUnderLegalHold('user', userId)) {
      incCounter(Metrics.LEGAL_HOLD_BLOCKED_DSAR_TOTAL, { subject_type: 'user' })
      const enforce = await isFeatureEnabled('legal_hold.block_dsar_erasure', {}).catch(() => false)
      if (enforce) {
        logger.warn('[lgpd/anonymize] refused — subject under legal hold', {
          userId,
          requestId,
          actorUserId: actor.id,
        })
        return NextResponse.json(
          {
            error: 'LEGAL_HOLD_ACTIVE',
            detail:
              'Sujeito está sob preservação legal (ordem vigente). Libere o hold antes de prosseguir com a anonimização.',
          },
          { status: 409, headers: { 'X-Request-ID': requestId } }
        )
      }
      logger.warn('[lgpd/anonymize] WOULD-HAVE-BLOCKED (flag OFF) — subject under legal hold', {
        userId,
        requestId,
        actorUserId: actor.id,
      })
    }

    // Record that we read this subject's PII as part of the admin
    // anonymisation workflow (Wave 9). Best-effort; never blocks.
    await logPiiView({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      subjectUserId: userId,
      scope: ['full_name', 'email', 'phone'],
      reason: 'lgpd_anonymize_pre_read',
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    })

    // 2. Anonymize profile PII. We set anonymized_at so downstream
    // code can tell a live user from a tombstoned one without
    // string-matching on the email placeholder.
    const nowIso = new Date().toISOString()
    const { error: profileAnonErr } = await admin
      .from('profiles')
      .update({
        full_name: `Usuário Anonimizado`,
        email: `anon-${userId.slice(0, 8)}@deleted.clinipharma.invalid`,
        phone: null,
        phone_encrypted: null,
        status: 'INACTIVE',
        anonymized_at: nowIso,
        anonymized_by: actor.id,
        updated_at: nowIso,
      })
      .eq('id', userId)
    if (profileAnonErr)
      return NextResponse.json(
        { error: 'Erro ao anonimizar perfil' },
        { status: 500, headers: { 'X-Request-ID': requestId } }
      )

    // 3. Anonymize doctor record if exists
    const { error: doctorAnonErr } = await admin
      .from('doctors')
      .update({
        full_name: `Médico Anonimizado`,
        email: `anon-${userId.slice(0, 8)}@deleted.clinipharma.invalid`,
        crm: null,
        crm_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    if (doctorAnonErr)
      logger.error('[lgpd/anonymize] doctors.update failed', {
        userId,
        error: doctorAnonErr,
        requestId,
      })

    // 4. Soft-delete notifications (not financial/audit data)
    const { error: notifDelErr } = await admin.from('notifications').delete().eq('user_id', userId)
    if (notifDelErr)
      logger.error('[lgpd/anonymize] notifications.delete failed', {
        userId,
        error: notifDelErr,
        requestId,
      })

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

    // 8. Close any open ERASURE DSAR request for this subject.
    //    We compute the delivery_hash over the anonymisation result
    //    so the FULFILLED row carries proof-of-completion.
    let dsarRequestId: string | null = null
    try {
      const { data: openReq } = await admin
        .from('dsar_requests')
        .select('id, status, kind')
        .eq('subject_user_id', userId)
        .eq('kind', 'ERASURE')
        .in('status', ['RECEIVED', 'PROCESSING'])
        .order('requested_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (openReq?.id) {
        dsarRequestId = openReq.id
        // RECEIVED → PROCESSING first if needed.
        if (openReq.status === 'RECEIVED') {
          await transitionDsarRequest(openReq.id, 'PROCESSING', {
            actorUserId: actor.id,
            actorRole: actor.roles[0],
          })
        }
        const deliveryHash = hashCanonicalBundle({
          subject_user_id: userId,
          anonymized_at: nowIso,
          anonymized_by: actor.id,
          preserved: ['orders', 'payments', 'commissions', 'audit_logs'],
        })
        await transitionDsarRequest(openReq.id, 'FULFILLED', {
          actorUserId: actor.id,
          actorRole: actor.roles[0],
          deliveryHash,
          deliveryRef: `anonymized:${userId}`,
          metadata: {
            reason: 'LGPD Art. 18 VI',
            preserved: ['orders', 'payments', 'commissions', 'audit_logs'],
          },
        })
      }
    } catch (dsarErr) {
      logger.error('[lgpd/anonymize] failed to close DSAR request', {
        userId,
        error: dsarErr,
      })
    }

    return NextResponse.json(
      {
        ok: true,
        anonymized: userId,
        preserved: ['orders', 'payments', 'commissions', 'audit_logs'],
        dsar_request_id: dsarRequestId,
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
    logger.error('[lgpd/anonymize] error', { error: err, requestId })
    return NextResponse.json(
      { error: 'Erro interno' },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    )
  }
}
