import { NextRequest, NextResponse } from 'next/server'
import { recordBackupRun, recordRunSchema } from '@/lib/backup'
import { safeEqualString } from '@/lib/security/hmac'
import { logger } from '@/lib/logger'
import { incCounter, Metrics } from '@/lib/metrics'

/**
 * POST /api/backups/record — Wave 12.
 *
 * Ingest endpoint for the offsite backup and restore-drill
 * GitHub workflows. Every run (success or failure) POSTs a
 * small JSON summary so the platform has a queryable history.
 *
 * ## Authentication
 *
 * Protected by `BACKUP_LEDGER_SECRET`, supplied by the workflow
 * as `Authorization: Bearer <secret>`. The secret lives in
 * GitHub Actions repo secrets AND in Vercel env vars. We refuse
 * to start if the env var is missing in prod-like environments,
 * to prevent a misconfigured rotation from silently accepting
 * anonymous writes.
 *
 * ## Input
 *
 *   {
 *     "kind": "BACKUP" | "VERIFY" | "RESTORE_DRILL",
 *     "label": "weekly",
 *     "r2_prefix": "weekly/20260414T070000Z",
 *     "files_sha256": "aa:db-...dump\\nbb:storage-...tgz",
 *     "size_bytes": 1234567,
 *     "outcome": "ok" | "fail" | "partial",
 *     "source_url": "https://github.com/.../actions/runs/123",
 *     "metadata": { "commit": "abcd123", "restore_seconds": 42 }
 *   }
 *
 * ## Output
 *
 *   { "ok": true, "id": "<uuid>", "row_hash": "<hex>" }
 *
 * Errors follow RFC 7807 `application/problem+json`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PRODLIKE = new Set(['production', 'preview'])

function authenticate(req: NextRequest): { ok: true } | { ok: false; reason: string } {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
  const secret = process.env.BACKUP_LEDGER_SECRET ?? ''

  if (!secret) {
    if (PRODLIKE.has(env)) {
      return { ok: false, reason: 'BACKUP_LEDGER_SECRET not configured' }
    }
    // Dev convenience — warn once per request.
    logger.warn(
      '[backup-record] BACKUP_LEDGER_SECRET unset — endpoint is OPEN. Safe only for localhost.',
      {
        module: 'backup-record',
        env,
      }
    )
    return { ok: true }
  }

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const header = req.headers.get('x-backup-ledger-secret') ?? ''
  const presented = bearer || header
  if (!presented || !safeEqualString(presented, secret)) {
    return { ok: false, reason: 'invalid or missing credentials' }
  }
  return { ok: true }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = authenticate(req)
  if (!auth.ok) {
    const status = auth.reason.includes('not configured') ? 500 : 401
    incCounter(Metrics.BACKUP_RECORD_TOTAL, { outcome: 'auth_fail' })
    return NextResponse.json(
      {
        type: 'about:blank',
        title: status === 401 ? 'Unauthorized' : 'Misconfigured',
        status,
        detail: auth.reason,
      },
      { status, headers: { 'Content-Type': 'application/problem+json' } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Body is not valid JSON' },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } }
    )
  }

  const parsed = recordRunSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Invalid payload',
        status: 422,
        detail: 'See `errors` for field-level diagnostics',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422, headers: { 'Content-Type': 'application/problem+json' } }
    )
  }

  try {
    const row = await recordBackupRun(parsed.data)
    logger.info('[backup-record] recorded run', {
      module: 'backup-record',
      kind: row.kind,
      label: row.label,
      outcome: row.outcome,
      id: row.id,
      size_bytes: row.size_bytes,
    })
    return NextResponse.json(
      { ok: true, id: row.id, row_hash: row.row_hash, recorded_at: row.recorded_at },
      { status: 201 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[backup-record] RPC failure', { module: 'backup-record', error: message })
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Ledger write failed',
        status: 502,
        detail: message,
      },
      { status: 502, headers: { 'Content-Type': 'application/problem+json' } }
    )
  }
}
