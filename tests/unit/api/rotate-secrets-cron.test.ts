// @vitest-environment node
/**
 * Unit tests for `GET /api/cron/rotate-secrets` (Wave 15).
 *
 * The route is a thin orchestrator over `rotateAllOverdue()`; we
 * mock the orchestrator and verify the cron's contracts:
 *
 *   - 0 overdue secrets → 200 with `{ overdue: 0 }`, no alert.
 *   - rotated/queued/requires-operator → warning alert, body
 *     reports counts.
 *   - failed > 0 → critical alert.
 *   - requires-operator > 0 + enforce ON → critical alert.
 *   - `rotateAllOverdue()` throws → critical alert with
 *     dedupKey 'secrets:cron:misconfigured'.
 *   - The operator list in the alert message includes secret
 *     names, tier and outcome (so on-call can act without
 *     opening Grafana).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

const CRON_SECRET = 'test-cron-secret'

const rotateAllOverdueMock = vi.fn()
vi.mock('@/lib/secrets', () => ({
  rotateAllOverdue: (...a: unknown[]) => rotateAllOverdueMock(...a),
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
  return new NextRequest('http://localhost/api/cron/rotate-secrets', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

function summary(
  results: Array<{
    secret: string
    tier: 'A' | 'B' | 'C'
    outcome:
      | 'rotated'
      | 'queued-for-operator'
      | 'requires-operator'
      | 'failed'
      | 'skipped-misconfigured'
    errorMessage?: string | null
  }> = [],
  redeploy: { triggered: boolean; id: string | null } = { triggered: false, id: null }
) {
  const overdueByTier = { A: 0, B: 0, C: 0 } as Record<'A' | 'B' | 'C', number>
  for (const r of results) overdueByTier[r.tier] += 1
  return {
    startedAt: new Date().toISOString(),
    durationMs: 100,
    scanned: 19,
    overdueByTier,
    results: results.map((r) => ({
      ageDays: 100,
      details: {},
      errorMessage: null,
      ...r,
    })),
    redeployTriggered: redeploy.triggered,
    redeployId: redeploy.id,
  }
}

describe('GET /api/cron/rotate-secrets', () => {
  it('returns 200 / overdue=0 when no secrets are overdue', async () => {
    rotateAllOverdueMock.mockResolvedValue(summary([]))
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { overdue: number; scanned: number } }
    expect(body.result.overdue).toBe(0)
    expect(body.result.scanned).toBe(19)
    expect(triggerAlertMock).not.toHaveBeenCalled()
  })

  it('emits warning alert for queued + requires-operator (enforce OFF)', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    rotateAllOverdueMock.mockResolvedValue(
      summary([
        { secret: 'RESEND_API_KEY', tier: 'B', outcome: 'queued-for-operator' },
        { secret: 'OPENAI_API_KEY', tier: 'C', outcome: 'requires-operator' },
      ])
    )
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    const arg = triggerAlertMock.mock.calls[0][0]
    expect(arg.severity).toBe('warning')
    expect(arg.dedupKey).toBe('secrets:rotation:overdue')
    expect(arg.message).toContain('RESEND_API_KEY')
    expect(arg.message).toContain('OPENAI_API_KEY')
    expect(arg.message).toContain('secret-compromise.md')
  })

  it('escalates to CRITICAL when enforce flag is ON and Tier C requires operator', async () => {
    isFeatureEnabled.mockResolvedValue(true)
    rotateAllOverdueMock.mockResolvedValue(
      summary([{ secret: 'OPENAI_API_KEY', tier: 'C', outcome: 'requires-operator' }])
    )
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    await GET(makeReq())
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    expect(triggerAlertMock.mock.calls[0][0].severity).toBe('critical')
  })

  it('escalates to CRITICAL when any rotation failed (regardless of enforce)', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    rotateAllOverdueMock.mockResolvedValue(
      summary([
        {
          secret: 'CRON_SECRET',
          tier: 'A',
          outcome: 'failed',
          errorMessage: 'Vercel API 502',
        },
        { secret: 'METRICS_SECRET', tier: 'A', outcome: 'rotated' },
      ])
    )
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    const arg = triggerAlertMock.mock.calls[0][0]
    expect(arg.severity).toBe('critical')
    expect(arg.title).toMatch(/1 failed/)
    expect(arg.message).toContain('CRON_SECRET')
    expect(arg.message).toContain('Vercel API 502')
  })

  it('alerts CRITICAL when orchestrator throws (env misconfig)', async () => {
    rotateAllOverdueMock.mockRejectedValue(new Error('VERCEL_TOKEN missing'))
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(triggerAlertMock).toHaveBeenCalledOnce()
    const arg = triggerAlertMock.mock.calls[0][0]
    expect(arg.severity).toBe('critical')
    expect(arg.dedupKey).toBe('secrets:cron:misconfigured')
    expect(arg.message).toContain('VERCEL_TOKEN missing')
    const body = (await res.json()) as { result: { status: string; error: string } }
    expect(body.result.status).toBe('misconfigured')
  })

  it('truncates the operator list at 30 entries', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const huge = Array.from({ length: 50 }, (_, i) => ({
      secret: `SECRET_${i}`,
      tier: 'B' as const,
      outcome: 'queued-for-operator' as const,
    }))
    rotateAllOverdueMock.mockResolvedValue(summary(huge))
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    await GET(makeReq())
    const msg = triggerAlertMock.mock.calls[0][0].message as string
    expect(msg).toContain('SECRET_0 ')
    expect(msg).toContain('SECRET_29 ')
    expect(msg).not.toContain('SECRET_30 ')
  })

  it('reports redeploy triggered + id in the body counts', async () => {
    rotateAllOverdueMock.mockResolvedValue(
      summary([{ secret: 'CRON_SECRET', tier: 'A', outcome: 'rotated' }], {
        triggered: true,
        id: 'dpl_abc123',
      })
    )
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const res = await GET(makeReq())
    const body = (await res.json()) as {
      result: {
        counts: { rotated: number }
        redeploy_triggered: boolean
        redeploy_id: string
      }
    }
    expect(body.result.counts.rotated).toBe(1)
    expect(body.result.redeploy_triggered).toBe(true)
    expect(body.result.redeploy_id).toBe('dpl_abc123')
  })

  it('returns 401 when CRON_SECRET bearer is missing', async () => {
    const { GET } = await import('@/app/api/cron/rotate-secrets/route')
    const req = new NextRequest('http://localhost/api/cron/rotate-secrets', {
      method: 'GET',
      // no auth header
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(rotateAllOverdueMock).not.toHaveBeenCalled()
  })
})
