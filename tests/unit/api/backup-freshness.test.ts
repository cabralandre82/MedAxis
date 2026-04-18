// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/backup-freshness` (Wave 12).
 *
 * The classifier lives as a pure exported function so we test it
 * without spinning up the cron guard. The cron wrapper is then
 * exercised end-to-end against in-memory stubs to prove:
 *
 *   - Healthy streams return 200 with breaches=0.
 *   - Stale BACKUP triggers a warning alert when
 *     `backup.freshness_enforce=false`.
 *   - Stale BACKUP escalates to a critical alert when the flag
 *     is ON.
 *   - Chain breaks surface both as a diagnosis and a metric.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

const getBackupFreshness = vi.fn()
const verifyBackupChain = vi.fn()
vi.mock('@/lib/backup', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backup')>('@/lib/backup')
  return {
    ...actual,
    getBackupFreshness: (...a: unknown[]) => getBackupFreshness(...a),
    verifyBackupChain: (...a: unknown[]) => verifyBackupChain(...a),
  }
})

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const triggerAlertMock = vi.fn().mockResolvedValue({ delivered: ['log'], deduped: false })
vi.mock('@/lib/alerts', () => ({ triggerAlert: triggerAlertMock }))

const isFeatureEnabled = vi.fn()
vi.mock('@/lib/features', () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }))

const incCounter = vi.fn()
const setGauge = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...a: unknown[]) => incCounter(...a),
    setGauge: (...a: unknown[]) => setGauge(...a),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  isFeatureEnabled.mockResolvedValue(false)
  verifyBackupChain.mockResolvedValue({ first_break_id: null, checked_rows: 0 })
})

function makeReq() {
  return new NextRequest('http://localhost/api/cron/backup-freshness', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

describe('diagnoseFreshness', () => {
  let diagnose: typeof import('@/lib/cron/backup-freshness-helpers').diagnoseFreshness
  beforeEach(async () => {
    ;({ diagnoseFreshness: diagnose } = await import('@/lib/cron/backup-freshness-helpers'))
  })

  const nowIso = new Date().toISOString()

  it('returns empty when both streams are fresh and OK', () => {
    const out = diagnose(
      [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: 1,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 3600,
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 86400,
        },
      ],
      [
        { kind: 'BACKUP', firstBreakId: null },
        { kind: 'RESTORE_DRILL', firstBreakId: null },
      ]
    )
    expect(out).toEqual([])
  })

  it('flags missing streams as a hard breach', () => {
    const out = diagnose([], [])
    expect(out).toHaveLength(2)
    expect(out.every((b) => b.reason === 'missing')).toBe(true)
    expect(out.map((b) => b.kind).sort()).toEqual(['BACKUP', 'RESTORE_DRILL'])
  })

  it('flags stale BACKUP when age > 9 days', () => {
    const out = diagnose(
      [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: 1,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 10 * 86400,
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 86400,
        },
      ],
      [
        { kind: 'BACKUP', firstBreakId: null },
        { kind: 'RESTORE_DRILL', firstBreakId: null },
      ]
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('BACKUP')
    expect(out[0].reason).toBe('stale')
  })

  it('flags stale RESTORE_DRILL when age > 35 days', () => {
    const out = diagnose(
      [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: 1,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 3600,
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 40 * 86400,
        },
      ],
      [
        { kind: 'BACKUP', firstBreakId: null },
        { kind: 'RESTORE_DRILL', firstBreakId: null },
      ]
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('RESTORE_DRILL')
    expect(out[0].reason).toBe('stale')
  })

  it('flags last_failed separately from stale', () => {
    const out = diagnose(
      [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'fail',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 3600,
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 86400,
        },
      ],
      [
        { kind: 'BACKUP', firstBreakId: null },
        { kind: 'RESTORE_DRILL', firstBreakId: null },
      ]
    )
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('last_failed')
    expect(out[0].lastOutcome).toBe('fail')
  })

  it('surfaces chain breaks per kind', () => {
    const out = diagnose(
      [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: 1,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 3600,
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'x',
          size_bytes: null,
          recorded_at: nowIso,
          source_url: null,
          metadata_json: {},
          age_seconds: 86400,
        },
      ],
      [
        { kind: 'BACKUP', firstBreakId: 'uuid-abc' },
        { kind: 'RESTORE_DRILL', firstBreakId: null },
      ]
    )
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('chain_break')
    expect(out[0].kind).toBe('BACKUP')
  })
})

describe('cron runner', () => {
  beforeEach(() => {
    const stub = attachCronGuard({ from: () => ({}) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
  })

  it('returns 200 / breaches=0 when streams are healthy', async () => {
    const nowIso = new Date().toISOString()
    getBackupFreshness.mockResolvedValue([
      {
        kind: 'BACKUP',
        label: 'weekly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: 1,
        recorded_at: nowIso,
        source_url: null,
        metadata_json: {},
        age_seconds: 3600,
      },
      {
        kind: 'RESTORE_DRILL',
        label: 'monthly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: null,
        recorded_at: nowIso,
        source_url: null,
        metadata_json: {},
        age_seconds: 86400,
      },
    ])
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { breaches: number } }
    expect(body.result.breaches).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('pages warning when a stream is stale and enforce flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    getBackupFreshness.mockResolvedValue([
      {
        kind: 'BACKUP',
        label: 'weekly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: 1,
        recorded_at: '2000-01-01',
        source_url: null,
        metadata_json: {},
        age_seconds: 20 * 86400,
      },
      {
        kind: 'RESTORE_DRILL',
        label: 'monthly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: null,
        recorded_at: '2000-01-01',
        source_url: null,
        metadata_json: {},
        age_seconds: 86400,
      },
    ])
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    expect(triggerAlertMock.mock.calls[0][0].severity).toBe('warning')
    expect(incCounter).toHaveBeenCalledWith('backup_freshness_breach_total', expect.any(Object), 1)
  })

  it('escalates to critical when enforce flag is ON', async () => {
    isFeatureEnabled.mockResolvedValue(true)
    getBackupFreshness.mockResolvedValue([
      {
        kind: 'BACKUP',
        label: 'weekly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: 1,
        recorded_at: '2000-01-01',
        source_url: null,
        metadata_json: {},
        age_seconds: 20 * 86400,
      },
      {
        kind: 'RESTORE_DRILL',
        label: 'monthly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: null,
        recorded_at: '2000-01-01',
        source_url: null,
        metadata_json: {},
        age_seconds: 86400,
      },
    ])
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    await GET(makeReq())
    expect(triggerAlertMock.mock.calls[0][0].severity).toBe('critical')
  })

  it('returns 401 when cron secret is wrong', async () => {
    getBackupFreshness.mockResolvedValue([])
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    const req = new NextRequest('http://localhost/api/cron/backup-freshness', {
      method: 'GET',
      headers: { authorization: 'Bearer nope' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(getBackupFreshness).not.toHaveBeenCalled()
  })

  it('records chain-break metric when verify reports a break', async () => {
    const nowIso = new Date().toISOString()
    getBackupFreshness.mockResolvedValue([
      {
        kind: 'BACKUP',
        label: 'weekly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: 1,
        recorded_at: nowIso,
        source_url: null,
        metadata_json: {},
        age_seconds: 3600,
      },
      {
        kind: 'RESTORE_DRILL',
        label: 'monthly',
        outcome: 'ok',
        r2_prefix: 'x',
        size_bytes: null,
        recorded_at: nowIso,
        source_url: null,
        metadata_json: {},
        age_seconds: 86400,
      },
    ])
    verifyBackupChain.mockImplementation((kind?: string) =>
      kind === 'BACKUP'
        ? Promise.resolve({ first_break_id: 'uuid-broken', checked_rows: 10 })
        : Promise.resolve({ first_break_id: null, checked_rows: 4 })
    )
    const { GET } = await import('@/app/api/cron/backup-freshness/route')
    await GET(makeReq())
    expect(incCounter).toHaveBeenCalledWith(
      'backup_chain_break_total',
      expect.objectContaining({ kind: 'BACKUP' })
    )
  })
})
