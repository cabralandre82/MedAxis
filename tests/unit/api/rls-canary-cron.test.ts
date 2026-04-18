// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/rls-canary` (Wave 14).
 *
 * The route is a thin orchestrator over `runCanary()`; we mock the
 * canary lib and verify the cron's two contracts:
 *
 *   - 0 violations → 200 result, no alert.
 *   - ≥1 violation → still 200 (cron-guard wraps non-throwing
 *     handlers), but `triggerAlert` fires with severity controlled
 *     by `rls_canary.page_on_violation`.
 *   - `runCanary()` throws (env misconfig) → critical alert with
 *     dedupKey 'rls-canary:misconfigured'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

const runCanaryMock = vi.fn()
vi.mock('@/lib/rls-canary', () => ({
  runCanary: (...a: unknown[]) => runCanaryMock(...a),
}))

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())

const triggerAlertMock = vi.fn().mockResolvedValue({ delivered: ['log'], deduped: false })
vi.mock('@/lib/alerts', () => ({ triggerAlert: triggerAlertMock }))

const isFeatureEnabled = vi.fn()
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', CRON_SECRET)
  isFeatureEnabled.mockResolvedValue(false)
  const stub = attachCronGuard({ from: () => ({}) })
  vi.mocked(adminModule.createAdminClient).mockReturnValue(
    stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
  )
})

function makeReq() {
  return new NextRequest('http://localhost/api/cron/rls-canary', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

describe('GET /api/cron/rls-canary', () => {
  it('returns 200 / violations=0 when canary is clean', async () => {
    runCanaryMock.mockResolvedValue({
      ranAtMs: Date.now(),
      durationMs: 42,
      subject: 'subject-uuid',
      tablesChecked: 40,
      violations: 0,
      assertions: [],
    })
    const { GET } = await import('@/app/api/cron/rls-canary/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { violations: number } }
    expect(body.result.violations).toBe(0)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('pages warning when violations exist and enforce flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    runCanaryMock.mockResolvedValue({
      ranAtMs: Date.now(),
      durationMs: 42,
      subject: 'subject-uuid',
      tablesChecked: 40,
      violations: 2,
      assertions: [
        {
          table_name: 'orders',
          bucket: 'tenant',
          visible_rows: 1,
          expected_max: 0,
          violated: true,
          error_message: null,
        },
        {
          table_name: 'payments',
          bucket: 'tenant',
          visible_rows: 3,
          expected_max: 0,
          violated: true,
          error_message: null,
        },
      ],
    })
    const { GET } = await import('@/app/api/cron/rls-canary/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    const alertArg = triggerAlertMock.mock.calls[0][0]
    expect(alertArg.severity).toBe('warning')
    expect(alertArg.dedupKey).toBe('rls:canary:violation')
    expect(alertArg.message).toContain('orders')
    expect(alertArg.message).toContain('payments')
  })

  it('escalates to critical when enforce flag is ON', async () => {
    isFeatureEnabled.mockResolvedValue(true)
    runCanaryMock.mockResolvedValue({
      ranAtMs: Date.now(),
      durationMs: 42,
      subject: 'subject-uuid',
      tablesChecked: 40,
      violations: 1,
      assertions: [
        {
          table_name: 'orders',
          bucket: 'tenant',
          visible_rows: 1,
          expected_max: 0,
          violated: true,
          error_message: null,
        },
      ],
    })
    const { GET } = await import('@/app/api/cron/rls-canary/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    expect(triggerAlertMock.mock.calls[0][0].severity).toBe('critical')
  })

  it('alerts critical when runCanary throws (env misconfig)', async () => {
    runCanaryMock.mockRejectedValue(new Error('SUPABASE_JWT_SECRET is required'))
    const { GET } = await import('@/app/api/cron/rls-canary/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200) // cron guard wraps the result
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    const arg = triggerAlertMock.mock.calls[0][0]
    expect(arg.severity).toBe('critical')
    expect(arg.dedupKey).toBe('rls-canary:misconfigured')
    expect(arg.message).toContain('SUPABASE_JWT_SECRET')
  })

  it('truncates violation list in alert message at 20 entries', async () => {
    isFeatureEnabled.mockResolvedValue(true)
    const huge = Array.from({ length: 30 }, (_, i) => ({
      table_name: `t${i}`,
      bucket: 'tenant' as const,
      visible_rows: 1,
      expected_max: 0,
      violated: true,
      error_message: null,
    }))
    runCanaryMock.mockResolvedValue({
      ranAtMs: Date.now(),
      durationMs: 42,
      subject: 'subject-uuid',
      tablesChecked: 30,
      violations: 30,
      assertions: huge,
    })
    const { GET } = await import('@/app/api/cron/rls-canary/route')
    await GET(makeReq())
    const msg = triggerAlertMock.mock.calls[0][0].message as string
    // First 20 names appear; t20+ should not.
    expect(msg).toContain('t0 ')
    expect(msg).toContain('t19 ')
    expect(msg).not.toContain('t20 ')
  })
})
