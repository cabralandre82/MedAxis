import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { ButtonLink } from '@/components/ui/button-link'
import { formatCNPJ, formatCurrency } from '@/lib/utils'
import type { SalesConsultant, ConsultantCommission } from '@/types'

export const metadata = { title: 'Consultor — MedAxis' }

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-800',
}
const COMMISSION_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  TRANSFER_PENDING: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
}
const COMMISSION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  TRANSFER_PENDING: 'Em repasse',
  PAID: 'Pago',
}

export default async function ConsultantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { id } = await params
  const currentUser = await getCurrentUser()
  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN') ?? false
  const supabase = await createClient()

  const { data: consultant } = await supabase
    .from('sales_consultants')
    .select('*')
    .eq('id', id)
    .single()

  if (!consultant) notFound()

  const c = consultant as unknown as SalesConsultant

  const { data: clinics } = await supabase
    .from('clinics')
    .select('id, trade_name, corporate_name, status')
    .eq('consultant_id', id)
    .order('trade_name')

  const { data: commissions } = await supabase
    .from('consultant_commissions')
    .select('*, orders(code, total_price, created_at)')
    .eq('consultant_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  const commList = (commissions ?? []) as unknown as (ConsultantCommission & {
    orders: { code: string; total_price: number; created_at: string } | null
  })[]

  const totalPending = commList
    .filter((cc) => cc.status === 'PENDING')
    .reduce((sum, cc) => sum + Number(cc.commission_amount), 0)

  const totalPaid = commList
    .filter((cc) => cc.status === 'PAID')
    .reduce((sum, cc) => sum + Number(cc.commission_amount), 0)

  const totalGenerated = commList.reduce((sum, cc) => sum + Number(cc.commission_amount), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{c.full_name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {c.email} · CNPJ: {formatCNPJ(c.cnpj)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {c.status === 'ACTIVE' ? 'Ativo' : c.status === 'INACTIVE' ? 'Inativo' : 'Suspenso'}
          </span>
          {isSuperAdmin && (
            <ButtonLink href={`/consultants/${id}/edit`} variant="outline" size="sm">
              Editar
            </ButtonLink>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Taxa de comissão', value: `${c.commission_rate}%`, color: 'text-blue-700' },
          {
            label: 'Clínicas vinculadas',
            value: String(clinics?.length ?? 0),
            color: 'text-slate-700',
          },
          { label: 'A pagar', value: formatCurrency(totalPending), color: 'text-amber-600' },
          { label: 'Total pago', value: formatCurrency(totalPaid), color: 'text-green-600' },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Dados do consultor */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-900">Dados cadastrais</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Telefone</dt>
              <dd className="text-slate-800">{c.phone ?? '—'}</dd>
            </div>
            {c.bank_name && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Banco</dt>
                <dd className="text-slate-800">{c.bank_name}</dd>
              </div>
            )}
            {c.bank_agency && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Agência / Conta</dt>
                <dd className="text-slate-800">
                  {c.bank_agency} / {c.bank_account}
                </dd>
              </div>
            )}
            {c.pix_key && (
              <div className="flex justify-between">
                <dt className="text-slate-500">PIX</dt>
                <dd className="text-slate-800">{c.pix_key}</dd>
              </div>
            )}
            {c.notes && (
              <div>
                <dt className="mb-1 text-slate-500">Observações</dt>
                <dd className="text-xs leading-relaxed text-slate-700">{c.notes}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Clínicas vinculadas */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold text-slate-900">
            Clínicas vinculadas ({clinics?.length ?? 0})
          </h2>
          {!clinics?.length ? (
            <p className="text-sm text-slate-500">Nenhuma clínica vinculada ainda.</p>
          ) : (
            <ul className="space-y-2">
              {clinics.map((clinic) => (
                <li key={clinic.id} className="flex items-center justify-between text-sm">
                  <Link
                    href={`/clinics/${clinic.id}`}
                    className="font-medium text-slate-800 hover:text-blue-600"
                  >
                    {clinic.trade_name}
                  </Link>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      clinic.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {clinic.status === 'ACTIVE' ? 'Ativa' : clinic.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Comissões */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="font-semibold text-slate-900">Comissões ({commList.length})</h2>
          <span className="text-sm text-slate-500">
            Total gerado: <strong>{formatCurrency(totalGenerated)}</strong>
          </span>
        </div>
        {!commList.length ? (
          <p className="px-6 py-8 text-sm text-slate-500">
            Nenhuma comissão gerada ainda. As comissões são criadas automaticamente quando um
            pagamento é confirmado para uma clínica vinculada a este consultor.
          </p>
        ) : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Pedido
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Valor do pedido
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Taxa
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Comissão
                </th>
                <th className="px-5 py-3 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {commList.map((cc) => (
                <tr key={cc.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-sm">
                    <Link
                      href={`/orders/${cc.order_id}`}
                      className="font-mono text-blue-600 hover:underline"
                    >
                      {cc.orders?.code ?? cc.order_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right text-sm text-slate-700">
                    {formatCurrency(Number(cc.order_total))}
                  </td>
                  <td className="px-5 py-3 text-right text-sm text-slate-600">
                    {cc.commission_rate}%
                  </td>
                  <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                    {formatCurrency(Number(cc.commission_amount))}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${COMMISSION_STATUS_STYLES[cc.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {COMMISSION_STATUS_LABELS[cc.status] ?? cc.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
