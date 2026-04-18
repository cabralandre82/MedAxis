// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/dsar-sla-check` (Wave 9).
 *
 * Covers the P1/P2 severity ladder, the WARN-only path (no
 * breaches), the enforce flag gating (auto-expire only when ON),
 * and the no-op clean path. `dsar.sla_enforce` flag state is
 * controlled by mocking `isFeatureEnabled`.
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

const isFeatureEnabledMock = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/features', () => ({ isFeatureEnabled: isFeatureEnabledMock }))

const incCounter = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...args: unknown[]) => incCounter(...args),
  }
})

function makeRequest(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/dsar-sla-check', {
    method: 'GET',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

/**
 * Build a stub for admin.from('dsar_requests').select().in().lte().order()
 * chain returning the supplied rows.
 */
function makeDsarStub(rows: Array<Record<string, unknown>>) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return chain
}

function makeErrorStub(message: string) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: null, error: { message } }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  isFeatureEnabledMock.mockResolvedValue(false)
})

describe('GET /api/cron/dsar-sla-check', () => {
  it('returns 401 without CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('clean run: no breaches, no warnings → 200, no alerts, no counters', async () => {
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub([]) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.breachCount).toBe(0)
    expect(body.result.warningCount).toBe(0)
    expect(body.result.expiredCount).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
    expect(incCounter.mock.calls.filter((c) => String(c[0]).startsWith('dsar_sla_'))).toHaveLength(
      0
    )
  })

  it('warning-only: P2 alert, no auto-expire even with flag OFF', async () => {
    const futureDue = new Date(Date.now() + 2 * 86400_000).toISOString()
    const rows = [
      {
        id: 'r-1',
        kind: 'ERASURE',
        status: 'PROCESSING',
        sla_due_at: futureDue,
        requested_at: new Date().toISOString(),
        subject_user_id: 'u1',
      },
    ]
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.warningCount).toBe(1)
    expect(body.result.breachCount).toBe(0)
    expect(body.result.expiredCount).toBe(0)

    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('lgpd:dsar:sla:warning')
    expect(alertArg.message).toMatch(/Sample/i)

    expect(incCounter).toHaveBeenCalledWith('dsar_sla_warning_total', { kind: 'ERASURE' })
  })

  it('breach with flag OFF: severity=warning, no auto-expire, no RPC call', async () => {
    const pastDue = new Date(Date.now() - 86400_000).toISOString()
    const rows = [
      {
        id: 'r-2',
        kind: 'EXPORT',
        status: 'RECEIVED',
        sla_due_at: pastDue,
        requested_at: new Date().toISOString(),
        subject_user_id: 'u2',
      },
    ]
    isFeatureEnabledMock.mockResolvedValue(false)
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.breachCount).toBe(1)
    expect(body.result.expiredCount).toBe(0)
    expect(body.result.enforce).toBe(false)

    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('lgpd:dsar:sla:breach')
    expect(alertArg.message).toMatch(/runbook/)

    expect(incCounter).toHaveBeenCalledWith('dsar_sla_breach_total', { kind: 'EXPORT' })
    // No dsar_expire_stale RPC call.
    expect(stub.rpc).not.toHaveBeenCalledWith('dsar_expire_stale', expect.anything())
  })

  it('breach with flag ON: severity=critical + auto-expire via RPC', async () => {
    const pastDue = new Date(Date.now() - 86400_000).toISOString()
    const rows = [
      {
        id: 'r-3',
        kind: 'ERASURE',
        status: 'PROCESSING',
        sla_due_at: pastDue,
        requested_at: new Date().toISOString(),
        subject_user_id: 'u3',
      },
    ]
    isFeatureEnabledMock.mockResolvedValue(true)
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub(rows) : {}),
      rpcHandlers: {
        dsar_expire_stale: async () => ({ data: 2, error: null }),
      },
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.breachCount).toBe(1)
    expect(body.result.expiredCount).toBe(2)
    expect(body.result.enforce).toBe(true)

    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('critical')
    expect(stub.rpc).toHaveBeenCalledWith(
      'dsar_expire_stale',
      expect.objectContaining({ p_grace_days: expect.any(Number) })
    )
    expect(incCounter).toHaveBeenCalledWith('dsar_expired_total', { via: 'cron' })
  })

  it('both breach + warning: fires breach alert only (warning is shadowed)', async () => {
    const now = Date.now()
    const rows = [
      {
        id: 'breach-1',
        kind: 'EXPORT',
        status: 'RECEIVED',
        sla_due_at: new Date(now - 86400_000).toISOString(),
        requested_at: new Date().toISOString(),
        subject_user_id: 'u1',
      },
      {
        id: 'warn-1',
        kind: 'ERASURE',
        status: 'PROCESSING',
        sla_due_at: new Date(now + 2 * 86400_000).toISOString(),
        requested_at: new Date().toISOString(),
        subject_user_id: 'u2',
      },
    ]
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.breachCount).toBe(1)
    expect(body.result.warningCount).toBe(1)

    // Only ONE alert — the breach one. Warning alert is suppressed
    // because breaches are the higher priority signal.
    expect(triggerAlertMock).toHaveBeenCalledTimes(1)
    expect(triggerAlertMock.mock.calls[0][0].dedupKey).toBe('lgpd:dsar:sla:breach')
  })

  it('returns 500 + does not alert when query errors', async () => {
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeErrorStub('relation does not exist') : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('alert dispatch failure does not mask the query result', async () => {
    triggerAlertMock.mockRejectedValueOnce(new Error('pagerduty down'))
    const rows = [
      {
        id: 'r-x',
        kind: 'EXPORT',
        status: 'RECEIVED',
        sla_due_at: new Date(Date.now() - 86400_000).toISOString(),
        requested_at: new Date().toISOString(),
        subject_user_id: 'u1',
      },
    ]
    const { GET } = await import('@/app/api/cron/dsar-sla-check/route')
    const stub = attachCronGuard({
      from: (table) => (table === 'dsar_requests' ? makeDsarStub(rows) : {}),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.breachCount).toBe(1)
  })
})
