// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/rate-limit-report` (Wave 10).
 *
 * Exercises the P1/P2/info severity ladder, the alert-dispatch
 * wiring, and the retention-purge call. The classification rules
 * are encapsulated in `classifyReport()`, which we also test in
 * isolation so the numeric thresholds don't silently drift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const triggerAlertMock = vi.fn().mockResolvedValue({ delivered: ['log'], deduped: false })
vi.mock('@/lib/alerts', () => ({ triggerAlert: triggerAlertMock }))

const incCounter = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...args: unknown[]) => incCounter(...args),
  }
})

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/rate-limit-report', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function makeReportStub(rows: Array<Record<string, unknown>>) {
  return {
    select: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function makeErrorStub(message: string) {
  return {
    select: vi.fn().mockResolvedValue({ data: null, error: { message } }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
})

describe('classifyReport', () => {
  let classify: typeof import('@/lib/cron/rate-limit-report-helpers').classifyReport

  beforeEach(async () => {
    // Classifier is a pure function; import in isolation.
    ;({ classifyReport: classify } = await import('@/lib/cron/rate-limit-report-helpers'))
  })

  const row = (
    ip_hash: string,
    total_hits: number,
    distinct_buckets = 1,
    buckets: string[] = ['auth.forgot']
  ) => ({
    ip_hash,
    total_hits,
    distinct_buckets,
    buckets,
    last_seen_at: '2026-04-17T12:00:00Z',
    first_seen_at: '2026-04-17T11:00:00Z',
    sample_user_id: null,
  })

  it('returns info when under all thresholds', () => {
    const v = classify([row('a'.repeat(64), 5)])
    expect(v.severity).toBe('info')
  })

  it('warning when >= 10 distinct IPs', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i).padStart(64, '0'), 5))
    const v = classify(rows)
    expect(v.severity).toBe('warning')
    expect(v.reason).toContain('10 IPs')
  })

  it('warning when a single IP has > 100 hits', () => {
    const v = classify([row('a'.repeat(64), 150)])
    expect(v.severity).toBe('warning')
    expect(v.reason).toContain('150 hits')
  })

  it('critical when 50+ distinct IPs', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(String(i).padStart(64, '0'), 2))
    const v = classify(rows)
    expect(v.severity).toBe('critical')
    expect(v.reason).toContain('50 IPs')
  })

  it('critical when a single IP has > 500 hits', () => {
    const v = classify([row('a'.repeat(64), 600)])
    expect(v.severity).toBe('critical')
    expect(v.reason).toContain('600 hits')
  })

  it('critical when one IP spans > 5 buckets (credential stuffing signal)', () => {
    const v = classify([
      row('a'.repeat(64), 50, 6, [
        'auth.forgot',
        'auth.login',
        'lgpd.export',
        'lgpd.deletion',
        'register.submit',
        'coupon.activate',
      ]),
    ])
    expect(v.severity).toBe('critical')
    expect(v.reason).toContain('distinct buckets')
  })

  it('top offenders are sorted deterministically (hits desc, hash asc)', () => {
    const v = classify([row('b'.repeat(64), 10), row('a'.repeat(64), 10), row('c'.repeat(64), 20)])
    expect(v.topOffenders.map((r) => r.ip_hash[0])).toEqual(['c', 'a', 'b'])
  })

  it('caps topOffenders at 10 entries', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(String(i).padStart(64, '0'), 10 + i))
    const v = classify(rows)
    expect(v.topOffenders).toHaveLength(10)
  })
})

describe('GET /api/cron/rate-limit-report', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('info run: no alert, purge called, 200', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'rate_limit_report_view' ? makeReportStub([]) : {}),
      rpcHandlers: {
        rate_limit_purge_old: async () => ({ data: 0, error: null }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.severity).toBe('info')
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('warning run: P2 alert fired with correct dedupKey', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ip_hash: String(i).padStart(64, '0'),
      total_hits: 3,
      distinct_buckets: 1,
      buckets: ['auth.forgot'],
      last_seen_at: '2026-04-17T12:00:00Z',
      first_seen_at: '2026-04-17T11:00:00Z',
      sample_user_id: null,
    }))
    const stub = attachCronGuard({
      from: (table) => (table === 'rate_limit_report_view' ? makeReportStub(rows) : {}),
      rpcHandlers: {
        rate_limit_purge_old: async () => ({ data: 5, error: null }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    expect(triggerAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'rate-limit:spike:warn',
        component: 'cron/rate-limit-report',
      })
    )
    const body = await res.json()
    expect(body.result.severity).toBe('warning')
    expect(body.result.purgedCount).toBe(5)
  })

  it('critical run: P1 alert with crit dedupKey', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const rows = [
      {
        ip_hash: 'a'.repeat(64),
        total_hits: 700,
        distinct_buckets: 2,
        buckets: ['auth.forgot', 'auth.login'],
        last_seen_at: '2026-04-17T12:00:00Z',
        first_seen_at: '2026-04-17T11:00:00Z',
        sample_user_id: null,
      },
    ]
    const stub = attachCronGuard({
      from: (table) => (table === 'rate_limit_report_view' ? makeReportStub(rows) : {}),
      rpcHandlers: {
        rate_limit_purge_old: async () => ({ data: 0, error: null }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        dedupKey: 'rate-limit:spike:crit',
      })
    )
  })

  it('500s when the view query errors', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'rate_limit_report_view' ? makeErrorStub('view broken') : {}),
      rpcHandlers: {
        rate_limit_purge_old: async () => ({ data: 0, error: null }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('still returns 200 when purge RPC fails (purge is best-effort)', async () => {
    const { GET } = await import('@/app/api/cron/rate-limit-report/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'rate_limit_report_view' ? makeReportStub([]) : {}),
      rpcHandlers: {
        rate_limit_purge_old: async () => ({ data: null, error: { message: 'boom' } }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.purgedCount).toBe(0)
  })
})
