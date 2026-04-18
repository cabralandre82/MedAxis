import { NextRequest, NextResponse } from 'next/server'
import { releaseLegalHold, releaseHoldSchema } from '@/lib/legal-hold'
import { requireRole } from '@/lib/rbac'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { logger } from '@/lib/logger'

/**
 * POST /api/admin/legal-hold/release — Wave 13.
 *
 * Releases an active legal hold. Emits an audit row so the fact
 * that purges resumed on a given date is recoverable from the
 * tamper-evident log.
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

    const parsed = releaseHoldSchema.safeParse(body)
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

    const row = await releaseLegalHold(parsed.data, actor.id)

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: row.id,
      action: AuditAction.UPDATE,
      oldValues: { status: 'active' },
      newValues: {
        status: row.status,
        released_at: row.released_at,
        release_reason: row.release_reason,
      },
      metadata: { module: 'legal-hold', requestId },
    })

    return NextResponse.json({ ok: true, hold: row }, { status: 200, headers: baseHeaders })
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403, headers: baseHeaders })
    }
    logger.error('[legal-hold/release] error', { error: err, requestId })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500, headers: baseHeaders })
  }
}
