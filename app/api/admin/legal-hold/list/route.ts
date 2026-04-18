import { NextRequest, NextResponse } from 'next/server'
import { listActiveHolds, listAllHolds } from '@/lib/legal-hold'
import { requireRole } from '@/lib/rbac'
import { logger } from '@/lib/logger'

/**
 * GET /api/admin/legal-hold/list?scope=active|all — Wave 13.
 *
 * Returns the holds visible to the DPO dashboard. Default
 * `scope=active` is the hot list; `scope=all` is the full history
 * (capped at 200 rows).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  const baseHeaders = { 'X-Request-ID': requestId }
  try {
    await requireRole(['SUPER_ADMIN'])
    const scope = (new URL(req.url).searchParams.get('scope') ?? 'active').toLowerCase()
    const holds = scope === 'all' ? await listAllHolds(200) : await listActiveHolds()
    return NextResponse.json(
      { ok: true, scope, count: holds.length, holds },
      { status: 200, headers: baseHeaders }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403, headers: baseHeaders })
    }
    logger.error('[legal-hold/list] error', { error: err, requestId })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500, headers: baseHeaders })
  }
}
