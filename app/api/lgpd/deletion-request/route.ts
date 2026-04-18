import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotificationForRole } from '@/lib/notifications'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { createDsarRequest } from '@/lib/dsar'
import { guard, lgpdFormLimiter, Bucket, extractClientIp } from '@/lib/rate-limit'
import { verifyTurnstile } from '@/lib/turnstile'
import { logger } from '@/lib/logger'

/**
 * POST /api/lgpd/deletion-request
 * LGPD Art. 18, VI — Direito de eliminação dos dados pessoais.
 *
 * Wave 9: now persists the request to `public.dsar_requests`
 * (ERASURE kind) so it enters the SLA-tracked queue. The legacy
 * audit_log + SUPER_ADMIN notification are preserved for
 * backward-compat with the existing admin UI; the new row id goes
 * into the notification metadata so admins can follow the link.
 *
 * A subject can have at most one open ERASURE request at a time
 * (enforced by the unique partial index in migration 051). A
 * duplicate returns HTTP 409.
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

  // Rate limit: 3 deletion requests per hour per user. We scope
  // by user id (not IP) because the form is authenticated — an
  // attacker on a shared NAT shouldn't grief another tenant,
  // and a legitimate user behind a corporate proxy shouldn't be
  // collectively throttled with their coworkers.
  const denied = await guard(req, lgpdFormLimiter, {
    bucket: Bucket.LGPD_DELETION,
    identifier: `${Bucket.LGPD_DELETION}:user:${user.id}`,
    userId: user.id,
  })
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const reason = (body.reason as string | undefined)?.slice(0, 500) ?? 'Sem motivo informado'
  const turnstileToken = (body.turnstileToken as string | undefined) ?? null

  // Turnstile is a second layer on top of the per-user rate
  // limit. It's a no-op while `security.turnstile_enforce` is
  // OFF (the default during rollout) but logs every token seen
  // so we can tune the false-positive rate before flipping.
  const tsResult = await verifyTurnstile({
    token: turnstileToken,
    remoteIp: extractClientIp(req),
    bucket: Bucket.LGPD_DELETION,
  })
  if (!tsResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'turnstile_required',
        message: tsResult.softFailure
          ? 'Verificação expirada. Por favor, tente novamente.'
          : 'Não foi possível validar a verificação de segurança. Atualize a página e tente novamente.',
      },
      { status: 403, headers: { 'X-Request-ID': requestId } }
    )
  }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  const dsar = await createDsarRequest({
    subjectUserId: user.id,
    kind: 'ERASURE',
    reasonText: reason,
    requestedBy: user.id,
    requestCorrelationId: requestId,
  })

  if (dsar.error) {
    if (dsar.error.reason === 'duplicate_open') {
      return NextResponse.json(
        {
          ok: false,
          error: 'duplicate_open',
          message: dsar.error.message,
        },
        { status: 409, headers: { 'X-Request-ID': requestId } }
      )
    }
    logger.error('[lgpd/deletion-request] failed to enqueue DSAR', {
      error: dsar.error,
      userId: user.id,
    })
    // Fall through to the legacy pathway so the user still gets a
    // success response — admins are paged via notification + audit.
  }

  await createAuditLog({
    actorUserId: user.id,
    actorRole: 'SELF',
    entityType: AuditEntity.DSAR_REQUEST,
    entityId: dsar.data?.id ?? user.id,
    action: AuditAction.CREATE,
    newValues: {
      type: 'LGPD_DELETION_REQUEST',
      dsar_request_id: dsar.data?.id ?? null,
      reason,
      requested_at: new Date().toISOString(),
    },
  })

  await createNotificationForRole('SUPER_ADMIN', {
    type: 'GENERIC',
    title: `📋 Solicitação de exclusão de dados — LGPD`,
    message: `O usuário ${profile?.full_name ?? user.id} (${profile?.email ?? ''}) solicitou a exclusão de seus dados pessoais.\n\nMotivo: ${reason}\n\nRequest id: ${dsar.data?.id ?? 'n/a'}\nSLA vence em: ${dsar.data?.sla_due_at ?? 'n/a'}\n\nAnalisar e executar anonimização via /api/admin/lgpd/anonymize/${user.id}`,
    link: `/admin/dsar/${dsar.data?.id ?? user.id}`,
  })

  return NextResponse.json(
    {
      ok: true,
      message:
        'Sua solicitação de exclusão foi recebida e será analisada pela nossa equipe em até 15 dias úteis, conforme previsto na LGPD.',
      dsar_request_id: dsar.data?.id ?? null,
      sla_due_at: dsar.data?.sla_due_at ?? null,
    },
    { headers: { 'X-Request-ID': requestId } }
  )
}
