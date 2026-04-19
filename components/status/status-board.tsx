'use client'

/**
 * Public status board — Wave Hardening II #7.
 *
 * Combines two data sources:
 *
 *   1. `/api/health`           — refreshed every 30 s. Drives the
 *                                 "now" banner and the per-component
 *                                 *current* state.
 *   2. `/api/status/summary`   — refreshed every 60 s. Drives the
 *                                 uptime ratios (7/30/90 d) and the
 *                                 90-day incident timeline.
 *
 * Decoupling them keeps the page useful even when one source is down:
 * a Grafana Cloud outage still leaves the live `/api/health` ticker
 * working; a database hiccup still leaves `/api/status/summary`
 * (Edge-cached) responding.
 *
 * The component is intentionally `'use client'`-only because it
 * polls the two endpoints on an interval and lives outside the
 * authenticated app shell.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type {
  ComponentId,
  ComponentState,
  ComponentUptime,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  StatusSummary,
} from '@/lib/status/types'

type CheckResult = {
  ok: boolean
  latencyMs?: number
  error?: string
}

type HealthResponse = {
  status: 'ok' | 'degraded' | 'down'
  version?: string
  timestamp: string
  totalLatencyMs?: number
  checks: Record<string, CheckResult>
  circuitStatus?: string
}

const HEALTH_REFRESH_MS = 30_000
const SUMMARY_REFRESH_MS = 60_000

export function StatusBoard() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [healthRes, summaryRes] = await Promise.allSettled([
      fetch('/api/health', { cache: 'no-store' }).then((r) => r.json() as Promise<HealthResponse>),
      fetch('/api/status/summary', { cache: 'no-store' }).then(
        (r) => r.json() as Promise<StatusSummary>
      ),
    ])

    if (healthRes.status === 'fulfilled') {
      setHealth(healthRes.value)
      setHealthError(null)
    } else {
      setHealthError(String(healthRes.reason))
    }
    if (summaryRes.status === 'fulfilled') {
      setSummary(summaryRes.value)
      setSummaryError(null)
    } else {
      setSummaryError(String(summaryRes.reason))
    }

    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const healthId = setInterval(() => {
      void fetch('/api/health', { cache: 'no-store' })
        .then((r) => r.json() as Promise<HealthResponse>)
        .then((h) => {
          setHealth(h)
          setHealthError(null)
          setLastUpdated(new Date())
        })
        .catch((err) => setHealthError(String(err)))
    }, HEALTH_REFRESH_MS)
    const summaryId = setInterval(() => {
      void fetch('/api/status/summary', { cache: 'no-store' })
        .then((r) => r.json() as Promise<StatusSummary>)
        .then((s) => {
          setSummary(s)
          setSummaryError(null)
        })
        .catch((err) => setSummaryError(String(err)))
    }, SUMMARY_REFRESH_MS)
    return () => {
      clearInterval(healthId)
      clearInterval(summaryId)
    }
  }, [refresh])

  const overallState: ComponentState = useMemo(() => {
    if (!health) return 'unknown'
    if (health.status === 'ok') return 'operational'
    if (health.status === 'degraded') return 'degraded'
    return 'down'
  }, [health])

  // Merge: per-component, prefer live state from /api/health for the
  // "current" column; uptime ratios always come from /api/status/summary.
  const components = useMemo<ComponentUptime[]>(() => {
    const fromSummary = summary?.components ?? []
    if (fromSummary.length === 0) {
      // No summary yet — render a skeleton so the page is never empty.
      return SKELETON_COMPONENTS
    }
    return fromSummary.map((c) => {
      const live = liveStateFor(c.id, health)
      return live ? { ...c, state: live.state, detail: live.detail ?? c.detail } : c
    })
  }, [summary, health])

  const incidents = summary?.incidents ?? []

  return (
    <div>
      <OverallBanner state={overallState} loading={loading && !health} />

      {summary?.degraded && <DegradedNotice reason={summary.degradedReason} />}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Componentes</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-xs text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
          aria-label="Atualizar status agora"
        >
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border bg-white">
        <ul className="divide-y" aria-label="Lista de componentes monitorados">
          {components.map((c) => (
            <ComponentRow key={c.id} component={c} />
          ))}
        </ul>
      </div>

      {(healthError || summaryError) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Não foi possível obter parte dos dados de saúde no momento. Tentaremos novamente em{' '}
          {Math.round(Math.min(HEALTH_REFRESH_MS, SUMMARY_REFRESH_MS) / 1000)} segundos.
        </div>
      )}

      <IncidentTimeline incidents={incidents} />

      <Legend />

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          Última atualização:{' '}
          {lastUpdated ? lastUpdated.toLocaleString('pt-BR') : 'aguardando primeira leitura…'}
          {summary && (
            <>
              {' · '}
              <span title={`generatedAt: ${summary.generatedAt}`}>
                fonte: <strong>{summary.source}</strong>
              </span>
            </>
          )}
        </span>
        <div className="flex gap-4">
          <Link href="/trust" className="hover:text-slate-700">
            Trust Center
          </Link>
          <Link href="/dpo" className="hover:text-slate-700">
            DPO
          </Link>
          <Link href="/privacy" className="hover:text-slate-700">
            Privacidade
          </Link>
          <Link href="/terms" className="hover:text-slate-700">
            Termos
          </Link>
        </div>
      </footer>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OverallBanner({ state, loading }: { state: ComponentState; loading: boolean }) {
  const meta = STATE_META[state]
  return (
    <div className={`rounded-2xl border-2 p-6 ${meta.banner}`} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Dot state={state} large />
        <div>
          <p className={`text-lg font-semibold ${meta.title}`}>
            {loading ? 'Carregando…' : meta.headline}
          </p>
          <p className="text-sm text-slate-600">{meta.subhead}</p>
        </div>
      </div>
    </div>
  )
}

function DegradedNotice({ reason }: { reason?: string }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <strong className="font-semibold">Coleta parcial:</strong> Alguns indicadores históricos podem
      estar incompletos.
      {reason && <span className="ml-1 text-xs text-amber-700">({reason})</span>}
    </div>
  )
}

function ComponentRow({ component }: { component: ComponentUptime }) {
  const meta = STATE_META[component.state]
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Dot state={component.state} />
          <span className="text-sm font-medium text-slate-900">{component.label}</span>
        </div>
        <p className="mt-1 ml-5 text-xs text-slate-500">{component.description}</p>
        {component.detail && <p className="mt-1 ml-5 text-xs text-amber-700">{component.detail}</p>}
      </div>
      <div className="text-right text-xs">
        <p className={`font-medium ${meta.title}`}>{meta.label}</p>
        <p className="mt-0.5 text-slate-500">
          7d: {formatPct(component.uptime.sevenDays)} · 30d:{' '}
          {formatPct(component.uptime.thirtyDays)} · 90d: {formatPct(component.uptime.ninetyDays)}
        </p>
      </div>
    </li>
  )
}

function IncidentTimeline({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-slate-900">Histórico de incidentes (90 dias)</h2>
      {incidents.length === 0 ? (
        <div className="mt-3 rounded-xl border bg-white p-6 text-sm text-slate-600">
          Nenhum incidente público registrado nos últimos 90 dias.
        </div>
      ) : (
        <ol className="mt-3 space-y-3">
          {incidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))}
        </ol>
      )}
    </section>
  )
}

function IncidentCard({ incident }: { incident: Incident }) {
  const sev = SEVERITY_META[incident.severity]
  const stat = STATUS_META[incident.status]
  return (
    <li className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">{incident.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Início: {formatDateTime(incident.startedAt)}
            {incident.resolvedAt && <> · Resolvido: {formatDateTime(incident.resolvedAt)}</>}
            {incident.components.length > 0 && (
              <> · Componentes: {incident.components.join(', ')}</>
            )}
          </p>
          {incident.summary && <p className="mt-2 text-xs text-slate-600">{incident.summary}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sev.badge}`}>
            {sev.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stat.badge}`}>
            {stat.label}
          </span>
        </div>
      </div>
    </li>
  )
}

function Legend() {
  return (
    <section className="mt-10 rounded-xl border bg-white p-6 text-sm text-slate-600">
      <h2 className="text-base font-semibold text-slate-900">Como interpretamos os estados</h2>
      <ul className="mt-3 space-y-2">
        <li className="flex items-start gap-3">
          <Dot state="operational" />
          <span>
            <strong className="text-slate-800">Operacional:</strong> serviço respondendo
            normalmente, sem degradação observada.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Dot state="degraded" />
          <span>
            <strong className="text-slate-800">Degradado:</strong> serviço acessível porém com
            latência elevada, taxa de erro acima do normal ou um circuit breaker aberto.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Dot state="down" />
          <span>
            <strong className="text-slate-800">Indisponível:</strong> serviço inacessível para a
            maioria dos usuários — equipe acionada via on-call.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Dot state="unknown" />
          <span>
            <strong className="text-slate-800">Desconhecido:</strong> falha temporária na coleta de
            saúde — não significa, por si só, indisponibilidade.
          </span>
        </li>
      </ul>
    </section>
  )
}

function Dot({ state, large = false }: { state: ComponentState; large?: boolean }) {
  const size = large ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const color = STATE_META[state].dot
  return <span aria-hidden className={`inline-block ${size} shrink-0 rounded-full ${color}`} />
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  if (v >= 0.9999) return '100,00%'
  return (
    (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + '%'
  )
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function liveStateFor(
  id: ComponentId,
  health: HealthResponse | null
): { state: ComponentState; detail?: string } | null {
  if (!health) return null

  // Map our generic component ids to specific health checks.
  const map: Partial<Record<ComponentId, keyof HealthResponse['checks'] | 'overall'>> = {
    app: 'overall',
    database: 'database',
    auth: 'env',
    integrations: 'circuits',
  }
  const key = map[id]
  if (!key) return null
  if (key === 'overall') {
    return {
      state:
        health.status === 'ok' ? 'operational' : health.status === 'degraded' ? 'degraded' : 'down',
    }
  }
  const check = health.checks[key]
  if (!check) return null
  return {
    state: check.ok ? 'operational' : 'degraded',
    detail: check.error,
  }
}

// ── Static metadata ───────────────────────────────────────────────────────────

const SKELETON_COMPONENTS: ComponentUptime[] = [
  {
    id: 'app',
    label: 'Aplicação Web',
    description: 'Front-end e API REST',
    state: 'unknown',
    uptime: { sevenDays: null, thirtyDays: null, ninetyDays: null },
  },
  {
    id: 'database',
    label: 'Banco de Dados',
    description: 'Postgres (Supabase)',
    state: 'unknown',
    uptime: { sevenDays: null, thirtyDays: null, ninetyDays: null },
  },
  {
    id: 'auth',
    label: 'Autenticação',
    description: 'JWT, refresh, MFA',
    state: 'unknown',
    uptime: { sevenDays: null, thirtyDays: null, ninetyDays: null },
  },
  {
    id: 'integrations',
    label: 'Integrações externas',
    description: 'Pagamentos, e-mail, SMS, IA',
    state: 'unknown',
    uptime: { sevenDays: null, thirtyDays: null, ninetyDays: null },
  },
]

const STATE_META: Record<
  ComponentState,
  { label: string; headline: string; subhead: string; title: string; banner: string; dot: string }
> = {
  operational: {
    label: 'Operacional',
    headline: 'Todos os sistemas operacionais',
    subhead: 'Nenhum incidente em curso. Última leitura saudável.',
    title: 'text-emerald-700',
    banner: 'border-emerald-200 bg-emerald-50',
    dot: 'bg-emerald-500',
  },
  degraded: {
    label: 'Degradado',
    headline: 'Operação parcialmente degradada',
    subhead: 'Algum componente apresentando lentidão ou erros intermitentes.',
    title: 'text-amber-700',
    banner: 'border-amber-200 bg-amber-50',
    dot: 'bg-amber-500',
  },
  down: {
    label: 'Indisponível',
    headline: 'Indisponibilidade detectada',
    subhead: 'Equipe técnica acionada e investigação em curso.',
    title: 'text-red-700',
    banner: 'border-red-200 bg-red-50',
    dot: 'bg-red-500',
  },
  unknown: {
    label: 'Desconhecido',
    headline: 'Aguardando dados de saúde',
    subhead: 'Tentando coletar a primeira leitura do health check.',
    title: 'text-slate-600',
    banner: 'border-slate-200 bg-slate-50',
    dot: 'bg-slate-400',
  },
}

const SEVERITY_META: Record<IncidentSeverity, { label: string; badge: string }> = {
  minor: { label: 'Menor', badge: 'bg-slate-100 text-slate-700' },
  major: { label: 'Maior', badge: 'bg-amber-100 text-amber-800' },
  critical: { label: 'Crítico', badge: 'bg-red-100 text-red-800' },
}

const STATUS_META: Record<IncidentStatus, { label: string; badge: string }> = {
  investigating: { label: 'Investigando', badge: 'bg-amber-100 text-amber-800' },
  identified: { label: 'Identificado', badge: 'bg-blue-100 text-blue-800' },
  monitoring: { label: 'Monitorando', badge: 'bg-indigo-100 text-indigo-800' },
  resolved: { label: 'Resolvido', badge: 'bg-emerald-100 text-emerald-800' },
}
