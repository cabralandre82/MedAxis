import { Metadata } from 'next'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ChurnContactButton } from '@/components/churn/churn-contact-button'

export const metadata: Metadata = { title: 'Risco de Churn | Clinipharma' }

const RISK_BADGE: Record<string, string> = {
  HIGH: 'bg-red-100 text-red-800',
  MODERATE: 'bg-amber-100 text-amber-800',
  LOW: 'bg-slate-100 text-slate-600',
}
const RISK_LABEL: Record<string, string> = {
  HIGH: 'Alto',
  MODERATE: 'Moderado',
  LOW: 'Baixo',
}

export default async function ChurnPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SALES_CONSULTANT'])

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('clinic_churn_scores')
    .select(
      `id, score, risk_level, days_since_last_order, avg_cycle_days,
       open_tickets, failed_payments, computed_at, contacted_at, contact_notes,
       clinics ( id, trade_name, email, city, state )`
    )
    .order('score', { ascending: false })

  const list = rows ?? []
  const high = list.filter((r) => r.risk_level === 'HIGH').length
  const moderate = list.filter((r) => r.risk_level === 'MODERATE').length
  const notContacted = list.filter((r) => !r.contacted_at).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Risco de Churn</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Clínicas com sinais de abandono — atualizado diariamente.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total monitoradas', value: list.length, color: 'text-gray-900' },
          { label: 'Risco alto', value: high, color: 'text-red-600' },
          { label: 'Risco moderado', value: moderate, color: 'text-amber-600' },
          { label: 'Sem contato', value: notContacted, color: 'text-slate-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border bg-white p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-500">
          Nenhuma clínica em risco no momento. O job de detecção roda diariamente.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {[
                  'Clínica',
                  'Risco',
                  'Score',
                  'Dias sem pedido',
                  'Ciclo médio',
                  'Tickets abertos',
                  'Pagamentos falhos',
                  'Última análise',
                  'Contato',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((row) => {
                const clinic = row.clinics as unknown as {
                  id: string
                  trade_name: string
                  email: string
                  city: string
                  state: string
                } | null
                return (
                  <tr
                    key={row.id}
                    className={row.contacted_at ? 'bg-gray-50 opacity-70' : 'hover:bg-slate-50'}
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`/clinics/${clinic?.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {clinic?.trade_name ?? '—'}
                      </a>
                      <p className="text-xs text-gray-400">
                        {clinic?.city} / {clinic?.state}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={RISK_BADGE[row.risk_level]}>
                        {RISK_LABEL[row.risk_level] ?? row.risk_level}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800">{row.score}</td>
                    <td className="px-4 py-3 text-gray-700">{row.days_since_last_order}d</td>
                    <td className="px-4 py-3 text-gray-500">{row.avg_cycle_days}d</td>
                    <td className="px-4 py-3 text-gray-500">{row.open_tickets}</td>
                    <td className="px-4 py-3 text-gray-500">{row.failed_payments}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {row.computed_at ? formatDate(row.computed_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {row.contacted_at ? (
                        <span className="text-green-700">
                          {formatDate(row.contacted_at)}
                          {row.contact_notes && (
                            <span className="block text-gray-400">{row.contact_notes}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChurnContactButton
                        clinicId={clinic?.id ?? ''}
                        clinicName={clinic?.trade_name ?? ''}
                        alreadyContacted={!!row.contacted_at}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
