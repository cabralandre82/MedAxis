import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { formatCurrency, formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'
import { parseCursorParams, sliceCursorResult } from '@/lib/cursor-pagination'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import { ConsultantTransferDialog } from '@/components/consultants/consultant-transfer-dialog'
import { ExportButton } from '@/components/shared/export-button'
import type { SalesConsultant, ConsultantCommission } from '@/types'

export const metadata = { title: 'Repasses a Consultores — Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

export default async function ConsultantTransfersPage({ searchParams }: Props) {
  const currentUser = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN')
  const { after, before } = await searchParams
  const supabase = createAdminClient()

  const cursor = parseCursorParams({ after, before, pageSize: PAGE_SIZE })

  // Consultores com comissões pendentes
  const { data: pendingRaw } = await supabase
    .from('consultant_commissions')
    .select('consultant_id, commission_amount, consultant_id')
    .eq('status', 'PENDING')

  const pendingByConsultant: Record<string, number> = {}
  for (const row of pendingRaw ?? []) {
    pendingByConsultant[row.consultant_id] =
      (pendingByConsultant[row.consultant_id] ?? 0) + Number(row.commission_amount)
  }

  const consultantIds = Object.keys(pendingByConsultant)

  const { data: consultantsRaw } = await supabase
    .from('sales_consultants')
    .select('id, full_name, email, pix_key, bank_name, bank_account, status')
    .in('id', consultantIds.length ? consultantIds : ['00000000-0000-0000-0000-000000000000'])
    .order('full_name')

  const consultants = (consultantsRaw ?? []) as unknown as SalesConsultant[]

  // Pending commissions per consultant (for the dialog)
  const { data: allPendingComm } = await supabase
    .from('consultant_commissions')
    .select('id, consultant_id, commission_amount, order_id, orders(code)')
    .eq('status', 'PENDING')

  const commByConsultant: Record<
    string,
    Array<ConsultantCommission & { orders: { code: string } | null }>
  > = {}
  for (const c of (allPendingComm ?? []) as unknown as Array<
    ConsultantCommission & { orders: { code: string } | null }
  >) {
    if (!commByConsultant[c.consultant_id]) commByConsultant[c.consultant_id] = []
    commByConsultant[c.consultant_id].push(c)
  }

  // Transfer history — cursor pagination (high-growth table)
  type HistoryRow = {
    id: string
    consultant_id: string
    gross_amount: number
    transfer_reference: string | null
    status: string
    confirmed_at: string | null
    created_at: string
    sales_consultants: { full_name: string } | null
  }

  let hq = supabase
    .from('consultant_transfers')
    .select('*, sales_consultants(full_name)')
    .order('created_at', { ascending: cursor.ascending })

  if (cursor.after) hq = hq.lt('created_at', cursor.after)
  if (cursor.before) hq = hq.gt('created_at', cursor.before)

  const { data: historyRaw } = await hq.limit(cursor.fetchSize)

  const {
    rows: history,
    nextCursor,
    prevCursor,
    isFirstPage,
  } = sliceCursorResult<HistoryRow>((historyRaw ?? []) as unknown as HistoryRow[], cursor)

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Repasses a Consultores</h1>
          <p className="mt-1 text-sm text-slate-500">
            Registre pagamentos de comissões aos consultores de vendas
          </p>
        </div>
        <ExportButton type="commissions" label="Exportar comissões" />
      </div>

      {/* A pagar */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Comissões pendentes de repasse</h2>
        {!consultants.length ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center">
            <p className="text-slate-500">Nenhuma comissão pendente no momento.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Consultor
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    PIX / Conta
                  </th>
                  <th className="px-5 py-3.5 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Pedidos pendentes
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Total a pagar
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consultants.map((c) => {
                  const comms = commByConsultant[c.id] ?? []
                  const total = pendingByConsultant[c.id] ?? 0
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-slate-900">{c.full_name}</p>
                        <p className="text-xs text-slate-500">{c.email}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        {c.pix_key ?? c.bank_account ?? '—'}
                      </td>
                      <td className="px-5 py-4 text-center text-sm text-slate-700">
                        {comms.length}
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-bold text-amber-600">
                        {formatCurrency(total)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {isSuperAdmin ? (
                          <ConsultantTransferDialog
                            consultantId={c.id}
                            consultantName={c.full_name}
                            commissions={comms}
                            totalAmount={total}
                          />
                        ) : (
                          <span className="text-xs text-slate-400">Sem permissão</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Histórico */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Histórico de repasses</h2>
        {!history.length ? (
          <p className="text-sm text-slate-500">Nenhum repasse registrado ainda.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Consultor
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Referência
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Valor
                  </th>
                  <th className="px-5 py-3 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Status
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm text-slate-800">
                      {h.sales_consultants?.full_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 font-mono text-sm text-slate-600">
                      {h.transfer_reference ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                      {formatCurrency(Number(h.gross_amount))}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          h.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {h.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-slate-500">
                      {h.confirmed_at
                        ? formatDateTime(h.confirmed_at)
                        : formatDateTime(h.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CursorPagination
          nextCursor={nextCursor}
          prevCursor={isFirstPage ? null : prevCursor}
          pageSize={PAGE_SIZE}
          resultCount={history.length}
        />
      </section>
    </div>
  )
}
