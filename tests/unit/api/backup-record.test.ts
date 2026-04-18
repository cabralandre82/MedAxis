// @vitest-environment node
/**
 * Unit tests for `POST /api/backups/record` (Wave 12).
 *
 * The endpoint sits in a trust boundary — it receives payloads
 * from an external runner and writes into the hash-chained
 * ledger. We assert:
 *
 *   - In production-like envs, a missing BACKUP_LEDGER_SECRET is
 *     a hard 500 (never an OPEN ingest).
 *   - Bearer and x-backup-ledger-secret are both accepted.
 *   - Payload validation returns 422 problem+json with field
 *     diagnostics (we don't blindly forward to the DB).
 *   - On RPC failure the endpoint surfaces 502 + problem+json,
 *     so the workflow retry loop triggers.
 *   - On success we return 201 with the hashed row id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const recordBackupRun = vi.fn()
vi.mock('@/lib/backup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backup')>('@/lib/backup')
  return {
    ...actual,
    recordBackupRun: (...a: unknown[]) => recordBackupRun(...a),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const incCounter = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...a: unknown[]) => incCounter(...a),
  }
})

function jsonReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://app.test/api/backups/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const validBody = {
  kind: 'BACKUP',
  label: 'weekly',
  r2_prefix: 'weekly/20260417T070000Z',
  files_sha256: 'aa:db.dump',
  size_bytes: 1000,
  outcome: 'ok',
  source_url: 'https://github.com/owner/repo/actions/runs/1',
  metadata: { commit: 'abc' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function loadRoute() {
  return (await import('@/app/api/backups/record/route')).POST
}

describe('POST /api/backups/record — auth', () => {
  it('returns 500 when BACKUP_LEDGER_SECRET is missing in production', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BACKUP_LEDGER_SECRET', '')
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { detail: string }
    expect(body.detail).toMatch(/not configured/)
    expect(recordBackupRun).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer token does not match', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BACKUP_LEDGER_SECRET', 'correct-secret')
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody, { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(incCounter).toHaveBeenCalledWith(
      'backup_record_total',
      expect.objectContaining({ outcome: 'auth_fail' })
    )
    expect(recordBackupRun).not.toHaveBeenCalled()
  })

  it('accepts x-backup-ledger-secret header alternative', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BACKUP_LEDGER_SECRET', 'correct-secret')
    recordBackupRun.mockResolvedValue({
      id: 'row-1',
      kind: 'BACKUP',
      label: 'weekly',
      row_hash: 'ff',
      recorded_at: '2026-04-17T00:00:00Z',
    })
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody, { 'x-backup-ledger-secret': 'correct-secret' }))
    expect(res.status).toBe(201)
    expect(recordBackupRun).toHaveBeenCalledOnce()
  })

  it('operates OPEN with a warning when secret is unset in development', async () => {
    vi.stubEnv('VERCEL_ENV', 'development')
    vi.stubEnv('BACKUP_LEDGER_SECRET', '')
    recordBackupRun.mockResolvedValue({
      id: 'row-dev',
      kind: 'BACKUP',
      label: 'weekly',
      row_hash: 'aa',
      recorded_at: '2026-04-17T00:00:00Z',
    })
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody))
    expect(res.status).toBe(201)
  })
})

describe('POST /api/backups/record — validation', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BACKUP_LEDGER_SECRET', 'correct-secret')
  })

  const okHeaders = { authorization: 'Bearer correct-secret' }

  it('returns 400 when the body is not JSON', async () => {
    const POST = await loadRoute()
    const res = await POST(jsonReq('not-json', okHeaders))
    expect(res.status).toBe(400)
  })

  it('returns 422 with field-level errors on schema violation', async () => {
    const POST = await loadRoute()
    const res = await POST(jsonReq({ kind: 'BOGUS', label: 'weekly', outcome: 'ok' }, okHeaders))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { errors: Array<{ path: string }> }
    expect(body.errors.some((e) => e.path === 'kind')).toBe(true)
  })

  it('rejects an empty label', async () => {
    const POST = await loadRoute()
    const res = await POST(jsonReq({ kind: 'BACKUP', label: '', outcome: 'ok' }, okHeaders))
    expect(res.status).toBe(422)
  })
})

describe('POST /api/backups/record — write path', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BACKUP_LEDGER_SECRET', 'correct-secret')
  })

  it('returns 201 + {ok,id,row_hash} on success', async () => {
    recordBackupRun.mockResolvedValueOnce({
      id: 'row-xyz',
      kind: 'BACKUP',
      label: 'weekly',
      row_hash: 'deadbeef',
      recorded_at: '2026-04-17T01:02:03.000Z',
    })
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody, { authorization: 'Bearer correct-secret' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; id: string; row_hash: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('row-xyz')
    expect(body.row_hash).toBe('deadbeef')
  })

  it('returns 502 problem+json when the RPC fails', async () => {
    recordBackupRun.mockRejectedValueOnce(new Error('pg connection refused'))
    const POST = await loadRoute()
    const res = await POST(jsonReq(validBody, { authorization: 'Bearer correct-secret' }))
    expect(res.status).toBe(502)
    expect(res.headers.get('content-type')).toMatch(/problem\+json/)
    const body = (await res.json()) as { detail: string }
    expect(body.detail).toMatch(/pg connection refused/)
  })
})
