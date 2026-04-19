/**
 * Grafana Cloud status data source — Wave Hardening II #7.
 *
 * Translates a `StatusSummary` from two Grafana Cloud APIs:
 *
 *   1. Mimir / Prometheus query API     → uptime ratios per component
 *      (we run `avg_over_time(probe_success{job="<component>"}[7d])`
 *      style queries, one per (component × window) pair).
 *
 *   2. Grafana Incident API             → public incident timeline
 *      (we list non-internal incidents in the 90-day window and map
 *      severity/labels into our lightweight schema).
 *
 * Designed for an "off by default" deployment:
 *
 *   - All credentials are read from env vars at construction time.
 *     Use `GrafanaCloudStatusSource.fromEnv()` which returns `null`
 *     when any required env var is missing — the factory in
 *     `data-source.ts` then falls back to `InternalStatusSource`.
 *   - Network failures NEVER throw: each query fans out and we
 *     compose a `degraded=true` summary on partial failure.
 *
 * Required env vars:
 *   GRAFANA_CLOUD_PROM_URL    e.g. https://prometheus-prod-xx.grafana.net
 *   GRAFANA_CLOUD_PROM_USER   numeric tenant id
 *   GRAFANA_CLOUD_TOKEN       service account token with
 *                             `metrics:read` and `incident:read`
 * Optional:
 *   GRAFANA_CLOUD_INCIDENT_URL   default https://<stack>.grafana.net/api/plugins/grafana-incident-app/resources/api/v1
 *   GRAFANA_CLOUD_PROBE_LABEL    default "service"
 *
 * Fetch budget: 1 incident-list call + 6 component × 3 window = 18
 * range queries. We send those 18 in parallel with a 5-second client
 * timeout each — enough headroom for a 3-second Mimir worst case.
 *
 * @module lib/status/grafana-cloud-source
 */

import 'server-only'
import {
  type ComponentId,
  type ComponentUptime,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type StatusDataSource,
  type StatusSummary,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 90
const FETCH_TIMEOUT_MS = 5_000

/** Public components surfaced by this source. Order matches
 *  `internal-source.ts` so the UI stays consistent across cutovers. */
interface ComponentSpec {
  id: ComponentId
  label: string
  description: string
  /** Value used in the Prom label `{<probeLabel>="<probeJob>"}`. */
  probeJob: string
}

const COMPONENT_SPECS: readonly ComponentSpec[] = [
  {
    id: 'app',
    label: 'Aplicação Web',
    description: 'Front-end Next.js + API REST',
    probeJob: 'app',
  },
  {
    id: 'database',
    label: 'Banco de Dados',
    description: 'Postgres (Supabase)',
    probeJob: 'database',
  },
  { id: 'auth', label: 'Autenticação', description: 'JWT, refresh, MFA, RBAC', probeJob: 'auth' },
  {
    id: 'payments',
    label: 'Pagamentos',
    description: 'Asaas + reconciliação financeira',
    probeJob: 'payments',
  },
  {
    id: 'integrations',
    label: 'Integrações externas',
    description: 'Webhooks, IA, e-mail, SMS',
    probeJob: 'integrations',
  },
  {
    id: 'cron',
    label: 'Jobs agendados',
    description: 'Crons de retenção, RLS canary, backups',
    probeJob: 'cron',
  },
] as const

export interface GrafanaCloudConfig {
  promUrl: string
  promUser: string
  token: string
  incidentUrl?: string
  probeLabel?: string
  fetchImpl?: typeof fetch
}

/** Tagged-union return from Prom query helper. */
type PromResult = { ok: true; ratio: number | null } | { ok: false; error: string }

/** Tagged-union return from Incident list helper. */
type IncidentResult = { ok: true; incidents: Incident[] } | { ok: false; error: string }

export class GrafanaCloudStatusSource implements StatusDataSource {
  readonly name = 'grafana-cloud' as const

  constructor(private readonly cfg: GrafanaCloudConfig) {
    if (!cfg.promUrl) throw new Error('grafana-cloud: promUrl required')
    if (!cfg.promUser) throw new Error('grafana-cloud: promUser required')
    if (!cfg.token) throw new Error('grafana-cloud: token required')
  }

  /** Construct from environment vars or return `null` if any are
   *  missing. Used by `lib/status/data-source.ts`. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GrafanaCloudStatusSource | null {
    const promUrl = env.GRAFANA_CLOUD_PROM_URL
    const promUser = env.GRAFANA_CLOUD_PROM_USER
    const token = env.GRAFANA_CLOUD_TOKEN
    if (!promUrl || !promUser || !token) return null
    return new GrafanaCloudStatusSource({
      promUrl,
      promUser,
      token,
      incidentUrl: env.GRAFANA_CLOUD_INCIDENT_URL,
      probeLabel: env.GRAFANA_CLOUD_PROBE_LABEL,
    })
  }

  async build(now: Date = new Date()): Promise<StatusSummary> {
    const generatedAt = now.toISOString()

    // 1. Fan out all uptime queries.
    const componentResults = await Promise.all(
      COMPONENT_SPECS.map((spec) => this.queryComponent(spec, now))
    )

    // 2. Incidents (non-blocking: failure → empty list + degraded flag)
    const incidentRes = await this.listIncidents(now)

    const components: ComponentUptime[] = componentResults.map(({ spec, results }) => ({
      id: spec.id,
      label: spec.label,
      description: spec.description,
      state: deriveState(results),
      uptime: {
        sevenDays: results.sevenDays.ok ? results.sevenDays.ratio : null,
        thirtyDays: results.thirtyDays.ok ? results.thirtyDays.ratio : null,
        ninetyDays: results.ninetyDays.ok ? results.ninetyDays.ratio : null,
      },
      detail: collectComponentErrors(results),
    }))

    const componentDegraded = componentResults.some(({ results }) =>
      [results.sevenDays, results.thirtyDays, results.ninetyDays].some((r) => !r.ok)
    )
    const degraded = componentDegraded || !incidentRes.ok
    const reasons: string[] = []
    if (componentDegraded) reasons.push('uma ou mais consultas Mimir falharam')
    if (!incidentRes.ok) reasons.push(`incidents: ${incidentRes.error}`)

    return {
      generatedAt,
      source: this.name,
      window: {
        sevenDays: window(now, 7),
        thirtyDays: window(now, 30),
        ninetyDays: window(now, 90),
      },
      components,
      incidents: incidentRes.ok ? incidentRes.incidents : [],
      degraded,
      degradedReason: reasons.length > 0 ? reasons.join('; ') : undefined,
    }
  }

  // ── Prometheus / Mimir ─────────────────────────────────────────────────────

  private async queryComponent(
    spec: ComponentSpec,
    now: Date
  ): Promise<{
    spec: ComponentSpec
    results: { sevenDays: PromResult; thirtyDays: PromResult; ninetyDays: PromResult }
  }> {
    const [seven, thirty, ninety] = await Promise.all([
      this.promInstant(uptimeQuery(spec, this.cfg.probeLabel, '7d'), now),
      this.promInstant(uptimeQuery(spec, this.cfg.probeLabel, '30d'), now),
      this.promInstant(uptimeQuery(spec, this.cfg.probeLabel, '90d'), now),
    ])
    return {
      spec,
      results: { sevenDays: seven, thirtyDays: thirty, ninetyDays: ninety },
    }
  }

  /** Run a Prom instant query and extract the first scalar/vector value
   *  as a 0..1 ratio. Returns `ok:false` on transport errors. */
  async promInstant(promql: string, at: Date): Promise<PromResult> {
    const url = new URL(`${trimSlash(this.cfg.promUrl)}/api/v1/query`)
    url.searchParams.set('query', promql)
    url.searchParams.set('time', String(Math.floor(at.getTime() / 1000)))

    const fetchImpl = this.cfg.fetchImpl ?? fetch
    let res: Response
    try {
      res = await withTimeout(
        fetchImpl(url.toString(), {
          method: 'GET',
          headers: this.headers(),
          // Don't cache: status-page summary already caches downstream.
          cache: 'no-store',
        }),
        FETCH_TIMEOUT_MS
      )
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

    let json: PromInstantResponse
    try {
      json = (await res.json()) as PromInstantResponse
    } catch (err) {
      return { ok: false, error: `parse: ${err instanceof Error ? err.message : String(err)}` }
    }

    if (json.status !== 'success') {
      return { ok: false, error: json.error ?? 'mimir returned non-success' }
    }
    const ratio = extractRatio(json.data)
    return { ok: true, ratio }
  }

  // ── Incidents ──────────────────────────────────────────────────────────────

  private async listIncidents(now: Date): Promise<IncidentResult> {
    const incidentBase = this.cfg.incidentUrl ?? deriveIncidentUrl(this.cfg.promUrl)
    if (!incidentBase) {
      return { ok: false, error: 'incident URL not configured' }
    }

    const url = `${trimSlash(incidentBase)}/IncidentsService.QueryIncidents`
    const fromIso = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString()
    const body = JSON.stringify({
      query: {
        // Public incidents only — the operator must tag with `public:true`
        // in Grafana so internal post-mortems don't leak.
        labelMatchers: [{ name: 'public', values: ['true'], operation: '=' }],
        startedAfter: fromIso,
      },
    })

    const fetchImpl = this.cfg.fetchImpl ?? fetch
    let res: Response
    try {
      res = await withTimeout(
        fetchImpl(url, {
          method: 'POST',
          headers: { ...this.headers(), 'content-type': 'application/json' },
          body,
          cache: 'no-store',
        }),
        FETCH_TIMEOUT_MS
      )
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

    let json: GrafanaIncidentsResponse
    try {
      json = (await res.json()) as GrafanaIncidentsResponse
    } catch (err) {
      return { ok: false, error: `parse: ${err instanceof Error ? err.message : String(err)}` }
    }

    const incidents: Incident[] = (json.incidents ?? [])
      .map(mapGrafanaIncident)
      .filter((i): i is Incident => i !== null)
    incidents.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    return { ok: true, incidents }
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.cfg.promUser}:${this.cfg.token}`).toString('base64')
    return {
      authorization: `Basic ${basic}`,
      accept: 'application/json',
      'user-agent': 'clinipharma-status/1.0',
    }
  }
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

interface PromInstantResponse {
  status: 'success' | 'error'
  error?: string
  data?: {
    resultType: 'vector' | 'scalar' | 'matrix' | 'string'
    result: Array<{ metric?: Record<string, string>; value?: [number, string] }> | [number, string]
  }
}

interface GrafanaIncidentsResponse {
  incidents?: Array<{
    incidentID?: string
    title?: string
    severity?: string
    severityLabel?: string
    status?: string
    createdTime?: string
    modifiedTime?: string
    resolvedTime?: string | null
    summary?: string
    labels?: Array<{ label?: string; value?: string }>
  }>
}

export function uptimeQuery(
  spec: ComponentSpec,
  probeLabel: string | undefined,
  window: string
): string {
  const lab = probeLabel || 'service'
  // Convention: an exporter publishes `clinipharma_probe_success{<lab>="<probeJob>"}`
  // as 1 (ok) / 0 (down). avg_over_time gives the success ratio in the
  // window, identical to what Synthetic Monitoring exposes.
  return `avg_over_time(clinipharma_probe_success{${lab}="${spec.probeJob}"}[${window}])`
}

export function extractRatio(data: PromInstantResponse['data']): number | null {
  if (!data) return null
  if (data.resultType === 'vector') {
    const arr = data.result as Array<{ value?: [number, string] }>
    const v = arr[0]?.value?.[1]
    if (v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? clamp01(n) : null
  }
  if (data.resultType === 'scalar') {
    const tuple = data.result as [number, string]
    const v = tuple?.[1]
    if (v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? clamp01(n) : null
  }
  return null
}

export function deriveState(results: {
  sevenDays: PromResult
  thirtyDays: PromResult
  ninetyDays: PromResult
}): ComponentUptime['state'] {
  if (!results.sevenDays.ok) return 'unknown'
  const r = results.sevenDays.ratio
  if (r === null) return 'unknown'
  if (r >= 0.999) return 'operational'
  if (r >= 0.95) return 'degraded'
  return 'down'
}

function collectComponentErrors(results: {
  sevenDays: PromResult
  thirtyDays: PromResult
  ninetyDays: PromResult
}): string | undefined {
  const errs = [results.sevenDays, results.thirtyDays, results.ninetyDays]
    .filter((r): r is { ok: false; error: string } => !r.ok)
    .map((r) => r.error)
  return errs.length === 0 ? undefined : `Mimir: ${errs.join(', ')}`
}

export function mapGrafanaIncident(
  raw: NonNullable<GrafanaIncidentsResponse['incidents']>[number]
): Incident | null {
  if (!raw.incidentID || !raw.title || !raw.createdTime) return null

  const severity = mapSeverity(raw.severity ?? raw.severityLabel ?? '')
  const status = mapStatus(raw.status ?? '')
  const componentLabel = raw.labels?.find((l) => l.label === 'component')?.value
  const components: ComponentId[] =
    componentLabel && isComponentId(componentLabel) ? [componentLabel] : []

  return {
    id: `grafana:${raw.incidentID}`,
    title: raw.title,
    severity,
    status,
    components,
    startedAt: raw.createdTime,
    resolvedAt: raw.resolvedTime ?? null,
    summary: raw.summary,
  }
}

function mapSeverity(s: string): IncidentSeverity {
  const lower = s.toLowerCase()
  if (lower.includes('critical') || lower.includes('sev1')) return 'critical'
  if (lower.includes('major') || lower.includes('sev2') || lower.includes('high')) return 'major'
  return 'minor'
}

function mapStatus(s: string): IncidentStatus {
  const lower = s.toLowerCase()
  if (lower.includes('resolv') || lower.includes('closed')) return 'resolved'
  if (lower.includes('monitor')) return 'monitoring'
  if (lower.includes('identif') || lower.includes('mitig')) return 'identified'
  return 'investigating'
}

function isComponentId(s: string): s is ComponentId {
  return COMPONENT_SPECS.some((c) => c.id === s)
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

function deriveIncidentUrl(promUrl: string): string | null {
  // Mimir URLs look like: https://prometheus-prod-xx.grafana.net
  // We can NOT auto-derive the stack-domain incident URL from that —
  // operators must supply GRAFANA_CLOUD_INCIDENT_URL explicitly.
  void promUrl
  return null
}

function window(now: Date, days: number): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(now.getTime() - days * DAY_MS).toISOString(),
    toIso: now.toISOString(),
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      }
    )
  })
}

/** Exported only for the unit-test suite. */
export const __internal = {
  COMPONENT_SPECS,
}
