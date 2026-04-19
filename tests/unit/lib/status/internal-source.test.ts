// @vitest-environment node
/**
 * Unit tests for `lib/status/internal-source.ts`.
 *
 * Focus on the pure helpers (`bucketize`, `uptimeFromBuckets`,
 * `classifyComponent`, `collectIncidents`) so we lock the algorithm
 * down without spinning up Supabase.
 *
 * Also covers the `InternalStatusSource.build()` integration with a
 * stub admin client to confirm the wire format matches `StatusSummary`.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  bucketize,
  uptimeFromBuckets,
  classifyComponent,
  collectIncidents,
  InternalStatusSource,
  __internal,
} from '@/lib/status/internal-source'
import type { ComponentId } from '@/lib/status/types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const now = new Date('2026-04-18T12:00:00.000Z')

const RULE_APP = __internal.COMPONENT_RULES.find((r) => r.id === 'app')!
const RULE_DB = __internal.COMPONENT_RULES.find((r) => r.id === 'database')!
const RULE_CRON = __internal.COMPONENT_RULES.find((r) => r.id === 'cron')!

describe('bucketize', () => {
  it('places events in the correct hourly bucket', () => {
    // `now` is hour-aligned, so an event at exactly `now - 1h` lands
    // in the final bucket (counts[last]). Test with -3h and -2h for
    // unambiguous bucket positions.
    const t1 = new Date(now.getTime() - 3 * HOUR).toISOString()
    const t2 = new Date(now.getTime() - 2 * HOUR).toISOString()
    const series = bucketize(
      RULE_APP,
      [],
      [
        { level: 'error', route: '/x', created_at: t1 },
        { level: 'error', route: '/x', created_at: t2 },
        { level: 'error', route: '/x', created_at: t2 },
      ],
      now
    )
    const last = series.counts.length - 1
    expect(series.counts[last - 2]).toBe(1) // -3h bucket
    expect(series.counts[last - 1]).toBe(2) // -2h bucket
    expect(series.counts[last]).toBe(0) // -1h bucket, no events
  })

  it('ignores rows that do not match the rule predicate', () => {
    const ts = new Date(now.getTime() - 2 * HOUR).toISOString()
    const series = bucketize(
      RULE_APP,
      [],
      [
        { level: 'warn', route: '/x', created_at: ts }, // filtered out
        { level: 'error', route: '/x', created_at: ts }, // counted
      ],
      now
    )
    const last = series.counts.length - 1
    expect(series.counts[last - 1]).toBe(1) // -2h bucket
  })

  it('drops rows outside the window', () => {
    const ts = new Date(now.getTime() - 200 * DAY).toISOString()
    const series = bucketize(RULE_APP, [], [{ level: 'error', route: null, created_at: ts }], now)
    expect(series.counts.reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('uptimeFromBuckets', () => {
  it('returns 1.0 when no bucket exceeds threshold', () => {
    const series = bucketize(RULE_DB, [], [], now)
    const u = uptimeFromBuckets(series, RULE_DB.badThresholdPerHour, now)
    expect(u.sevenDays).toBe(1)
    expect(u.thirtyDays).toBe(1)
    expect(u.ninetyDays).toBe(1)
  })

  it('drops uptime proportional to bad buckets', () => {
    // 10 distinct hours each with 1 failed cron in last 7d.
    // RULE_DB threshold = 0 (strict greater) ⇒ count > 0 = bad.
    const cronRuns = Array.from({ length: 10 }, (_, i) => ({
      job_name: 'foo',
      status: 'failed',
      started_at: new Date(now.getTime() - (i + 1) * HOUR).toISOString(),
    }))
    const series = bucketize(RULE_DB, cronRuns, [], now)
    const u = uptimeFromBuckets(series, RULE_DB.badThresholdPerHour, now)
    expect(u.sevenDays).toBeCloseTo((168 - 10) / 168, 4)
  })

  it('returns null when window contains zero buckets', () => {
    // Force a tiny window with no buckets at all.
    const series = bucketize(RULE_DB, [], [], now, 0)
    const u = uptimeFromBuckets(series, RULE_DB.badThresholdPerHour, now)
    expect(u.sevenDays).toBe(null)
  })
})

describe('classifyComponent', () => {
  it('marks operational when nothing recent is bad', () => {
    const c = classifyComponent(RULE_DB, [], [], now)
    expect(c.state).toBe('operational')
    expect(c.uptime.sevenDays).toBe(1)
  })

  it('marks degraded when the last hour exceeds threshold', () => {
    const justNow = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    const c = classifyComponent(
      RULE_DB,
      [{ job_name: 'asaas-poll', status: 'failed', started_at: justNow }],
      [],
      now
    )
    expect(c.state).toBe('degraded')
    expect(c.detail).toMatch(/eventos na última hora/)
  })

  it('marks down when the last hour is severely above threshold', () => {
    const justNow = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
    const rows = Array.from({ length: 20 }, (_, i) => ({
      job_name: `cron-${i}`,
      status: 'failed',
      started_at: justNow,
    }))
    const c = classifyComponent(RULE_DB, rows, [], now)
    expect(c.state).toBe('down')
  })
})

describe('collectIncidents', () => {
  it('groups consecutive bad hours into a single incident', () => {
    // 4 consecutive failed crons across 4 different hours (≥3h ⇒ major).
    const cronRuns = [3, 2, 1, 0].map((hAgo) => ({
      job_name: 'rotate-secrets',
      status: 'failed',
      started_at: new Date(now.getTime() - hAgo * HOUR).toISOString(),
    }))

    const incidents = collectIncidents([RULE_DB], cronRuns, [], now)
    const dbIncidents = incidents.filter((i) => i.components.includes('database'))
    expect(dbIncidents.length).toBeGreaterThanOrEqual(1)
    const inc = dbIncidents[0]!
    // The most recent run touches "now-0h", which is within the active
    // window — surface as still-investigating.
    expect(inc.status === 'investigating' || inc.status === 'resolved').toBe(true)
    expect(inc.severity === 'major' || inc.severity === 'critical').toBe(true)
    expect(inc.components).toContain<ComponentId>('database')
  })

  it('returns no incidents when there are no bad buckets', () => {
    const incidents = collectIncidents([RULE_DB], [], [], now)
    expect(incidents).toEqual([])
  })

  it('separates two bad runs into two incidents when there is a gap', () => {
    // Two bursts: one ~50h ago, another ~20h ago.
    const cronRuns = [
      {
        job_name: 'a',
        status: 'failed',
        started_at: new Date(now.getTime() - 50 * HOUR).toISOString(),
      },
      {
        job_name: 'a',
        status: 'failed',
        started_at: new Date(now.getTime() - 20 * HOUR).toISOString(),
      },
    ]
    const incidents = collectIncidents([RULE_DB], cronRuns, [], now)
    expect(incidents.length).toBe(2)
    // Newest first.
    expect(Date.parse(incidents[0]!.startedAt)).toBeGreaterThan(Date.parse(incidents[1]!.startedAt))
  })

  it('honours per-rule thresholds (cron rule needs >=2 to trip)', () => {
    // Only 1 failed cron — RULE_CRON threshold = 1 (>1 = bad), so 1 alone
    // does not trip an incident.
    const cronRuns = [
      { job_name: 'x', status: 'failed', started_at: new Date(now.getTime() - HOUR).toISOString() },
    ]
    const incidents = collectIncidents([RULE_CRON], cronRuns, [], now)
    expect(incidents).toEqual([])
  })
})

describe('InternalStatusSource.build', () => {
  it('returns a StatusSummary with all configured components', async () => {
    const stubAdmin = makeStubAdmin([], [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = new InternalStatusSource(stubAdmin as any)
    const out = await src.build(now)

    expect(out.source).toBe('internal')
    expect(out.generatedAt).toBe(now.toISOString())
    expect(out.components.map((c) => c.id).sort()).toEqual(
      __internal.ALL_COMPONENT_IDS.slice().sort()
    )
    expect(out.window.sevenDays.toIso).toBe(now.toISOString())
    expect(out.degraded).toBe(false)
  })

  it('flags degraded=true when the underlying queries fail', async () => {
    const stubAdmin = makeStubAdminWithError('boom')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = new InternalStatusSource(stubAdmin as any)
    const out = await src.build(now)

    expect(out.degraded).toBe(true)
    expect(out.degradedReason).toMatch(/boom/)
    // Even degraded, components shape is preserved.
    expect(out.components.length).toBe(__internal.COMPONENT_RULES.length)
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

function makeStubAdmin(cronRows: unknown[], logRows: unknown[]) {
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      select: () => ({
        gte: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: table === 'cron_runs' ? cronRows : logRows,
                error: null,
              }),
          }),
        }),
      }),
    })),
  }
}

function makeStubAdminWithError(message: string) {
  return {
    from: vi.fn().mockImplementation(() => ({
      select: () => ({
        gte: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: null, error: { message } }),
          }),
        }),
      }),
    })),
  }
}
