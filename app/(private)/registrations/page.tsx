import { Metadata } from 'next'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'

import { formatDate } from '@/lib/utils'
import {
  Building2,
  Stethoscope,
  Clock,
  FileQuestion,
  Mail,
  Flame,
  Thermometer,
  Snowflake,
} from 'lucide-react'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import {
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUS_COLORS,
} from '@/lib/registration-constants'
import { calculateLeadScore, type LeadLevel } from '@/lib/lead-score'

export const dynamic = 'force-dynamic'

const LEAD_BADGE: Record<LeadLevel, { label: string; icon: React.ReactNode; className: string }> = {
  hot: {
    label: 'Quente',
    icon: <Flame className="h-3 w-3" />,
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  warm: {
    label: 'Morno',
    icon: <Thermometer className="h-3 w-3" />,
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  cold: {
    label: 'Frio',
    icon: <Snowflake className="h-3 w-3" />,
    className: 'bg-slate-50 text-slate-500 border border-slate-200',
  },
}

export const metadata: Metadata = { title: 'Solicitações de cadastro | Clinipharma' }

const PAGE_SIZE = 20

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string }>
}

export default async function RegistrationsPage({ searchParams }: PageProps) {
  await requireRolePage(['SUPER_ADMIN'])

  const params = await searchParams
  const page = parsePage(params.page)
  const { from, to } = paginationRange(page, PAGE_SIZE)
  const statusFilter = params.status

  const admin = createAdminClient()

  // Drafts (interesses incompletos — não chegaram a submeter)
  const { data: drafts, count: draftsCount } = await admin
    .from('registration_drafts')
    .select('id, type, form_data, created_at, expires_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(50)

  // Registration requests
  let query = admin
    .from('registration_requests')
    .select('id, type, status, form_data, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: requests, count } = await query

  // Counts for badges
  const [{ count: pendingCount }, { count: pendingDocsCount }] = await Promise.all([
    admin
      .from('registration_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING'),
    admin
      .from('registration_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING_DOCS'),
  ])

  const statuses = ['PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED']
  const showDrafts = !statusFilter || statusFilter === 'INCOMPLETE'

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cadastros</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Interesses, solicitações pendentes e histórico completo
          </p>
        </div>
        <div className="flex flex-col gap-2 text-right">
          {(pendingCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-medium text-amber-800">
                {pendingCount} aguardando análise
              </span>
            </div>
          )}
          {(pendingDocsCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5">
              <FileQuestion className="h-3.5 w-3.5 text-orange-600" />
              <span className="text-xs font-medium text-orange-800">
                {pendingDocsCount} sem documentos
              </span>
            </div>
          )}
          {(draftsCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <FileQuestion className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-600">
                {draftsCount} interesses incompletos
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/registrations"
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            !statusFilter
              ? 'bg-[hsl(213,75%,24%)] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Todos
        </Link>
        <Link
          href="/registrations?status=INCOMPLETE"
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            statusFilter === 'INCOMPLETE'
              ? 'bg-[hsl(213,75%,24%)] text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Interesses incompletos
          {(draftsCount ?? 0) > 0 && (
            <span className="ml-1.5 rounded-full bg-slate-500 px-1.5 py-0.5 text-[10px] text-white">
              {draftsCount}
            </span>
          )}
        </Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/registrations?status=${s}`}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-[hsl(213,75%,24%)] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {REGISTRATION_STATUS_LABELS[s]}
            {s === 'PENDING' && (pendingCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">
                {pendingCount}
              </span>
            )}
            {s === 'PENDING_DOCS' && (pendingDocsCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">
                {pendingDocsCount}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* ── Drafts section ─────────────────────────────────────────────────── */}
      {showDrafts && (drafts ?? []).length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Interesses incompletos — não chegaram a enviar
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              Expiram em 7 dias
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Interessado</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Lead score</th>
                  <th className="px-4 py-3 text-left">Iniciado em</th>
                  <th className="px-4 py-3 text-left">Expira em</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(drafts ?? [])
                  .map((draft) => ({
                    draft,
                    leadScore: calculateLeadScore(draft.form_data as Record<string, string>),
                  }))
                  .sort((a, b) => b.leadScore.score - a.leadScore.score)
                  .map(({ draft, leadScore }) => {
                    const fd = draft.form_data as Record<string, string>
                    const name = fd.full_name ?? '—'
                    const email = fd.email ?? ''
                    const sub =
                      draft.type === 'CLINIC'
                        ? fd.trade_name
                        : `CRM ${fd.crm ?? ''}/${fd.crm_state ?? ''}`
                    const badge = LEAD_BADGE[leadScore.level]
                    return (
                      <tr key={draft.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{name}</p>
                          <p className="text-xs text-gray-400">{sub || email}</p>
                          {email && sub && <p className="text-xs text-gray-400">{email}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {draft.type === 'CLINIC' ? (
                              <Building2 className="h-3.5 w-3.5 text-blue-500" />
                            ) : (
                              <Stethoscope className="h-3.5 w-3.5 text-purple-500" />
                            )}
                            <span className="text-xs text-gray-600">
                              {draft.type === 'CLINIC' ? 'Clínica' : 'Médico'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                              title={leadScore.reasons.join(' · ')}
                            >
                              {badge.icon}
                              {badge.label} · {leadScore.score}/100
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatDate(draft.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatDate(draft.expires_at)}
                        </td>
                        <td className="px-4 py-3">
                          {email && (
                            <a
                              href={`mailto:${email}?subject=Seu cadastro na Clinipharma&body=Olá ${name}, notamos que você iniciou um cadastro na Clinipharma mas não concluiu o envio. Podemos ajudá-lo?`}
                              className="flex items-center gap-1 text-xs font-medium text-[hsl(196,91%,33%)] hover:underline"
                            >
                              <Mail className="h-3 w-3" />
                              Contatar
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Registration requests section ──────────────────────────────────── */}
      {statusFilter !== 'INCOMPLETE' && (
        <section className="space-y-3">
          {!statusFilter && (
            <h2 className="text-sm font-semibold text-gray-700">Solicitações enviadas</h2>
          )}

          <p className="text-xs text-gray-400">
            {count ?? 0} solicitação(ões){' '}
            {statusFilter ? `com status "${REGISTRATION_STATUS_LABELS[statusFilter]}"` : 'no total'}
          </p>

          {(requests ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
              <Clock className="mb-4 h-10 w-10 text-gray-200" />
              <p className="text-sm text-gray-500">Nenhuma solicitação encontrada</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-semibold tracking-wider text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Solicitante</th>
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Data</th>
                    <th className="px-4 py-3 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(requests ?? []).map((req) => {
                    const fd = req.form_data as Record<string, string>
                    const name = fd.full_name ?? '—'
                    const sub =
                      req.type === 'CLINIC'
                        ? fd.trade_name
                        : `CRM ${fd.crm ?? ''}/${fd.crm_state ?? ''}`
                    return (
                      <tr key={req.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{name}</p>
                          <p className="text-xs text-gray-400">{sub}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {req.type === 'CLINIC' ? (
                              <Building2 className="h-3.5 w-3.5 text-blue-500" />
                            ) : (
                              <Stethoscope className="h-3.5 w-3.5 text-purple-500" />
                            )}
                            <span className="text-xs text-gray-600">
                              {req.type === 'CLINIC' ? 'Clínica' : 'Médico'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${REGISTRATION_STATUS_COLORS[req.status]}`}
                          >
                            {REGISTRATION_STATUS_LABELS[req.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatDate(req.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/registrations/${req.id}`}
                            className="text-xs font-medium text-[hsl(196,91%,33%)] hover:underline"
                          >
                            Analisar →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
        </section>
      )}

      {/* Empty state for incomplete tab */}
      {statusFilter === 'INCOMPLETE' && (drafts ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <FileQuestion className="mb-4 h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-500">Nenhum interesse incompleto no momento</p>
        </div>
      )}
    </div>
  )
}
