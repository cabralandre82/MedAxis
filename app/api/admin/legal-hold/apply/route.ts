import { NextRequest, NextResponse } from 'next/server'
import { applyLegalHold, applyHoldSchema } from '@/lib/legal-hold'
import { requireRole } from '@/lib/rbac'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { logger } from '@/lib/logger'

/**
 * POST /api/admin/legal-hold/apply — Wave 13.
 *
 * Registers a formal preservation order against a subject. The
 * actor MUST be SUPER_ADMIN (DPO-level) — a legal hold freezes
 * retention for years, so misfires are expensive.
 *
 * Body: see `applyHoldSchema` in `lib/legal-hold`.
 *
 * Output (201):
 *   {
 *     ok: true,
 *     hold: { id, subject_type, subject_id, reason_code, expires_at, ... }
 *   }
 *
 * Idempotent: a second call for the same (subject, reason_code)
 * while the first hold is still active returns the existing row
 * (HTTP 200 instead of 201) so the DPO UI can retry safely.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const baseHeaders = { 'X-Request-ID': requestId }
  try {
    const actor = await requireRole(['SUPER_ADMIN'])

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Body is not valid JSON' },
        { status: 400, headers: baseHeaders }
      )
    }

    const parsed = applyHoldSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid payload',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 422, headers: baseHeaders }
      )
    }

    const row = await applyLegalHold(parsed.data, actor.id)
    const isIdempotent = row.placed_by !== actor.id // DB returned an existing row

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE, // legal_holds share the PROFILE audit family for now
      entityId: row.id,
      action: AuditAction.CREATE,
      newValues: {
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        reason_code: row.reason_code,
        expires_at: row.expires_at,
        hold_id: row.id,
      },
      metadata: { module: 'legal-hold', requestId, idempotent: isIdempotent },
    })

    return NextResponse.json(
      { ok: true, hold: row, idempotent: isIdempotent },
      { status: isIdempotent ? 200 : 201, headers: baseHeaders }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403, headers: baseHeaders })
    }
    logger.error('[legal-hold/apply] error', { error: err, requestId })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500, headers: baseHeaders })
  }
}
