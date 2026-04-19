// @vitest-environment node
/**
 * Unit tests for `lib/status/grafana-cloud-source.ts`.
 *
 * No real network: we inject a `fetchImpl` stub via the constructor.
 *
 * Coverage:
 *   - extractRatio handles vector / scalar / empty results
 *   - uptimeQuery composes the expected PromQL
 *   - mapGrafanaIncident converts severity/status correctly
 *   - GrafanaCloudStatusSource.build() composes a StatusSummary,
 *     marks degraded=true when partial failure, never throws
 *   - fromEnv returns null when env is incomplete
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GrafanaCloudStatusSource,
  uptimeQuery,
  extractRatio,
  deriveState,
  mapGrafanaIncident,
  __internal,
} from '@/lib/status/grafana-cloud-source'

const now = new Date('2026-04-18T12:00:00.000Z')

describe('uptimeQuery', () => {
  it('uses default label and the provided window', () => {
    const spec = __internal.COMPONENT_SPECS[0]!
    expect(uptimeQuery(spec, undefined, '7d')).toBe(
      `avg_over_time(clinipharma_probe_success{service="${spec.probeJob}"}[7d])`
    )
  })

  it('respects the configured probe label', () => {
    const spec = __internal.COMPONENT_SPECS[0]!
    expect(uptimeQuery(spec, 'job', '30d')).toBe(
      `avg_over_time(clinipharma_probe_success{job="${spec.probeJob}"}[30d])`
    )
  })
})

describe('extractRatio', () => {
  it('returns the first value of a vector', () => {
    const r = extractRatio({
      resultType: 'vector',
      result: [{ metric: {}, value: [1745000000, '0.997'] }],
    })
    expect(r).toBeCloseTo(0.997, 4)
  })

  it('returns null for empty vector', () => {
    const r = extractRatio({ resultType: 'vector', result: [] })
    expect(r).toBeNull()
  })

  it('handles scalar results', () => {
    const r = extractRatio({ resultType: 'scalar', result: [1745000000, '1'] })
    expect(r).toBe(1)
  })

  it('clamps absurd values to [0,1]', () => {
    expect(extractRatio({ resultType: 'scalar', result: [0, '1.5'] })).toBe(1)
    expect(extractRatio({ resultType: 'scalar', result: [0, '-0.2'] })).toBe(0)
  })

  it('returns null for non-numeric values', () => {
    expect(extractRatio({ resultType: 'scalar', result: [0, 'NaN'] })).toBeNull()
  })
})

describe('deriveState', () => {
  const ok = (r: number) => ({ ok: true as const, ratio: r })
  const fail = { ok: false as const, error: 'x' }

  it('operational at >= 0.999', () => {
    expect(deriveState({ sevenDays: ok(0.9991), thirtyDays: ok(1), ninetyDays: ok(1) })).toBe(
      'operational'
    )
  })

  it('degraded between 0.95 and 0.999', () => {
    expect(deriveState({ sevenDays: ok(0.97), thirtyDays: ok(1), ninetyDays: ok(1) })).toBe(
      'degraded'
    )
  })

  it('down below 0.95', () => {
    expect(deriveState({ sevenDays: ok(0.5), thirtyDays: ok(1), ninetyDays: ok(1) })).toBe('down')
  })

  it('unknown when 7d query failed', () => {
    expect(deriveState({ sevenDays: fail, thirtyDays: ok(1), ninetyDays: ok(1) })).toBe('unknown')
  })

  it('unknown when 7d ratio is null', () => {
    expect(
      deriveState({ sevenDays: { ok: true, ratio: null }, thirtyDays: ok(1), ninetyDays: ok(1) })
    ).toBe('unknown')
  })
})

describe('mapGrafanaIncident', () => {
  it('maps a critical resolved incident with component label', () => {
    const inc = mapGrafanaIncident({
      incidentID: 'IRQ-42',
      title: 'DB outage',
      severity: 'sev1',
      status: 'resolved',
      createdTime: '2026-04-10T00:00:00.000Z',
      resolvedTime: '2026-04-10T01:00:00.000Z',
      summary: 'restored',
      labels: [{ label: 'component', value: 'database' }],
    })
    expect(inc).not.toBeNull()
    expect(inc!.id).toBe('grafana:IRQ-42')
    expect(inc!.severity).toBe('critical')
    expect(inc!.status).toBe('resolved')
    expect(inc!.components).toEqual(['database'])
  })

  it('drops invalid component labels', () => {
    const inc = mapGrafanaIncident({
      incidentID: 'IRQ-43',
      title: 'noise',
      severity: 'minor',
      status: 'investigating',
      createdTime: '2026-04-10T00:00:00.000Z',
      labels: [{ label: 'component', value: 'NOT-A-COMPONENT' }],
    })
    expect(inc!.components).toEqual([])
  })

  it('returns null when required fields are missing', () => {
    expect(mapGrafanaIncident({ title: 'no id' })).toBeNull()
    expect(mapGrafanaIncident({ incidentID: 'X', title: 'no time' })).toBeNull()
  })
})

describe('GrafanaCloudStatusSource.build', () => {
  it('composes a StatusSummary from successful Mimir + incident calls', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/query')) {
        return jsonResponse({
          status: 'success',
          data: { resultType: 'vector', result: [{ value: [0, '0.9995'] }] },
        })
      }
      if (url.includes('IncidentsService.QueryIncidents')) {
        return jsonResponse({
          incidents: [
            {
              incidentID: 'IRQ-1',
              title: 'Slow auth',
              severity: 'major',
              status: 'resolved',
              createdTime: new Date(now.getTime() - 86400_000).toISOString(),
              resolvedTime: new Date(now.getTime() - 80000_000).toISOString(),
              labels: [
                { label: 'public', value: 'true' },
                { label: 'component', value: 'auth' },
              ],
            },
          ],
        })
      }
      throw new Error('unexpected URL: ' + url)
    })

    const src = new GrafanaCloudStatusSource({
      promUrl: 'https://prom.example/',
      promUser: '12345',
      token: 'glc_token',
      incidentUrl: 'https://stack.example/api/plugins/grafana-incident-app/resources/api/v1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchImpl: fetchImpl as any,
    })

    const out = await src.build(now)
    expect(out.source).toBe('grafana-cloud')
    expect(out.degraded).toBe(false)
    expect(out.components.length).toBe(__internal.COMPONENT_SPECS.length)
    expect(out.components.every((c) => c.state === 'operational')).toBe(true)
    expect(out.incidents.length).toBe(1)
    expect(out.incidents[0]!.components).toEqual(['auth'])
    // 18 prom queries + 1 incident POST
    expect(fetchImpl).toHaveBeenCalledTimes(19)
  })

  it('marks degraded when Mimir partially fails', async () => {
    let n = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/query')) {
        n++
        if (n === 5) return new Response('boom', { status: 500 })
        return jsonResponse({
          status: 'success',
          data: { resultType: 'vector', result: [{ value: [0, '1'] }] },
        })
      }
      if (url.includes('IncidentsService.QueryIncidents')) {
        return jsonResponse({ incidents: [] })
      }
      throw new Error('unexpected URL: ' + url)
    })

    const src = new GrafanaCloudStatusSource({
      promUrl: 'https://prom.example',
      promUser: '12345',
      token: 'glc_token',
      incidentUrl: 'https://stack.example/api/plugins/grafana-incident-app/resources/api/v1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchImpl: fetchImpl as any,
    })

    const out = await src.build(now)
    expect(out.degraded).toBe(true)
    expect(out.degradedReason).toMatch(/Mimir/)
    // Components still rendered, missing ratios are nulls (or operational
    // for the 7d window if it succeeded for a given component).
    expect(out.components.length).toBe(__internal.COMPONENT_SPECS.length)
  })

  it('marks degraded when incident API fails but uptime succeeds', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/query')) {
        return jsonResponse({
          status: 'success',
          data: { resultType: 'vector', result: [{ value: [0, '1'] }] },
        })
      }
      return new Response('nope', { status: 503 })
    })

    const src = new GrafanaCloudStatusSource({
      promUrl: 'https://prom.example',
      promUser: '12345',
      token: 'glc_token',
      incidentUrl: 'https://stack.example/api/plugins/grafana-incident-app/resources/api/v1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchImpl: fetchImpl as any,
    })

    const out = await src.build(now)
    expect(out.degraded).toBe(true)
    expect(out.degradedReason).toMatch(/incidents/)
    expect(out.incidents).toEqual([])
  })
})

describe('GrafanaCloudStatusSource.fromEnv', () => {
  it('returns null when any required env is missing', () => {
    expect(GrafanaCloudStatusSource.fromEnv({})).toBeNull()
    expect(
      GrafanaCloudStatusSource.fromEnv({
        GRAFANA_CLOUD_PROM_URL: 'x',
        GRAFANA_CLOUD_PROM_USER: 'y',
      } as NodeJS.ProcessEnv)
    ).toBeNull()
  })

  it('returns an instance when all required envs are set', () => {
    const inst = GrafanaCloudStatusSource.fromEnv({
      GRAFANA_CLOUD_PROM_URL: 'https://prom.example',
      GRAFANA_CLOUD_PROM_USER: '1',
      GRAFANA_CLOUD_TOKEN: 'glc_x',
    } as NodeJS.ProcessEnv)
    expect(inst).toBeInstanceOf(GrafanaCloudStatusSource)
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
