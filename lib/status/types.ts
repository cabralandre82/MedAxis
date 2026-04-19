/**
 * Public status page types — Wave Hardening II #7.
 *
 * These types are the **public API contract** of the status page:
 *   • the `/api/status/summary` endpoint returns a `StatusSummary`,
 *   • the React `<StatusBoard>` component consumes one,
 *   • every data-source implementation (internal, Grafana Cloud, …)
 *     MUST produce one with the exact same shape.
 *
 * Keep this file dependency-free: it is imported from both client and
 * server bundles. NO `server-only`, NO `node:*` imports.
 *
 * Related artefacts:
 *   - `lib/status/internal-source.ts`     — derives summary from cron_runs + server_logs
 *   - `lib/status/grafana-cloud-source.ts`— derives summary from Mimir + Incident API
 *   - `lib/status/data-source.ts`         — factory + cache
 *   - `app/api/status/summary/route.ts`   — HTTP proxy, edge-cached 60s
 *   - `app/status/page.tsx`               — public render
 *   - `docs/observability/status-page.md` — architecture & ops guide
 *
 * @module lib/status/types
 */

/** State of a single component on the public status board. */
export type ComponentState = 'operational' | 'degraded' | 'down' | 'unknown'

/** Severity of a public incident. Mirrors the alert severities used in
 *  `monitoring/prometheus/alerts.yml`. */
export type IncidentSeverity = 'minor' | 'major' | 'critical'

/** Lifecycle stage of an incident as exposed publicly. We deliberately
 *  collapse internal triage stages (acknowledged, mitigated, …) to keep
 *  the public timeline simple and auditable. */
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

/** Stable identifier for one logical service the user cares about. The
 *  same id MUST appear in `components` regardless of data source so the
 *  UI can render a consistent table. */
export type ComponentId = 'app' | 'database' | 'auth' | 'payments' | 'integrations' | 'cron'

export interface ComponentUptime {
  id: ComponentId
  /** User-friendly label (pt-BR). */
  label: string
  /** One-line description displayed under the label. */
  description: string
  /** Current state derived from the chosen data source. `unknown` when
   *  the source is offline or the component is not measurable in the
   *  current configuration. */
  state: ComponentState
  /** Optional human-readable reason when state is degraded/down. */
  detail?: string
  /** Uptime ratios in the [0, 1] range. NaN when not enough samples. */
  uptime: {
    sevenDays: number | null
    thirtyDays: number | null
    ninetyDays: number | null
  }
}

export interface Incident {
  /** Stable id (UUID, snowflake, alertname+timestamp slug). */
  id: string
  /** Short headline rendered in the public timeline. */
  title: string
  severity: IncidentSeverity
  status: IncidentStatus
  /** Affected component ids — must reference `components[].id`. */
  components: ComponentId[]
  /** ISO-8601 UTC timestamp when the incident first started. */
  startedAt: string
  /** ISO-8601 UTC timestamp when the incident was resolved. `null`
   *  while the incident is still active. */
  resolvedAt: string | null
  /** Optional public summary written for tenants. Markdown is NOT
   *  rendered: kept as plain text to keep the surface attack-free. */
  summary?: string
}

/** The complete payload `/api/status/summary` returns. */
export interface StatusSummary {
  /** When the summary was generated. ISO-8601 UTC. */
  generatedAt: string
  /** Which backend produced the summary. Surfaced in the UI footer so
   *  operators can confirm the wiring after a Grafana Cloud cutover. */
  source: 'internal' | 'grafana-cloud'
  /** Window the uptime ratios were calculated over. */
  window: {
    sevenDays: { fromIso: string; toIso: string }
    thirtyDays: { fromIso: string; toIso: string }
    ninetyDays: { fromIso: string; toIso: string }
  }
  components: ComponentUptime[]
  /** Incidents in the last 90 days, newest first. Empty array means
   *  exactly that — no incidents — NOT "data unavailable". For the
   *  unavailable case, source-level errors propagate via `degraded`. */
  incidents: Incident[]
  /** Source-level health. When true, the UI surfaces a small banner
   *  ("Histórico parcial — coleta degradada") so users know the figures
   *  may be incomplete. */
  degraded: boolean
  /** Optional message displayed alongside the degraded banner. */
  degradedReason?: string
}

/** Thin wrapper any data-source implementation MUST satisfy. Pure
 *  function-of-time so it is trivial to memoise / cache. */
export interface StatusDataSource {
  readonly name: StatusSummary['source']
  /** Build a fresh `StatusSummary`. May throw — the caller is expected
   *  to translate exceptions into a degraded summary so the public
   *  endpoint never returns 5xx. */
  build(now?: Date): Promise<StatusSummary>
}
