import Link from 'next/link'
import { createAdminClient } from '@/lib/db/admin'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ProfileWithRoles } from '@/types'

interface ConsultantDashboardProps {
  user: ProfileWithRoles
}

export async function ConsultantDashboard({ user }: ConsultantDashboardProps) {
  const adminClient = createAdminClient()

  // `commission_rate` was dropped from `sales_consultants` in migration
  // 005 — it is now a single global value in `app_settings`. Reading
  // the dropped column was returning 42703 undefined_column on the
  // dashboard load. Pull the rate from `app_settings` instead.
  const [{ data: consultant }, { data: rateSetting }] = await Promise.all([
    adminClient.from('sales_consultants').select('id, full_name').eq('user_id', user.id).single(),
    adminClient
      .from('app_settings')
      .select('value_json')
      .eq('key', 'consultant_commission_rate')
      .single(),
  ])

  const commissionRate = (() => {
    const raw = rateSetting?.value_json
    if (raw === null || raw === undefined) return 5
    const parsed = Number(typeof raw === 'string' ? raw : JSON.stringify(raw))
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 5
  })()

  if (!consultant) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="font-medium text-amber-800">Conta de consultor não vinculada</p>
        <p className="mt-1 text-sm text-amber-700">
          Entre em contato com o administrador para vincular sua conta.
        </p>
      </div>
    )
  }

  // Commissions
  const { data: commissions } = await adminClient
    .from('consultant_commissions')
    .select(
      'id, commission_amount, status, created_at, order_id, orders(code, total_price, created_at, clinics(trade_name))'
    )
    .eq('consultant_id', consultant.id)
    .order('created_at', { ascending: false })

  const comms = (commissions ?? []) as unknown as Array<{
    id: string
    commission_amount: number
    status: string
    created_at: string
    order_id: string
    orders: {
      code: string
      total_price: number
      created_at: string
      clinics: { trade_name: string } | null
    } | null
  }>

  const totalPending = comms
    .filter((c) => c.status === 'PENDING')
    .reduce((sum, c) => sum + Number(c.commission_amount), 0)

  const totalPaid = comms
    .filter((c) => c.status === 'PAID')
    .reduce((sum, c) => sum + Number(c.commission_amount), 0)

  const totalGenerated = comms.reduce((sum, c) => sum + Number(c.commission_amount), 0)

  // Clinics
  const { data: clinics } = await adminClient
    .from('clinics')
    .select('id, trade_name, status')
    .eq('consultant_id', consultant.id)
    .order('trade_name')

  const STATUS_COMM: Record<string, string> = {
    PENDING: 'Pendente',
    TRANSFER_PENDING: 'Em repasse',
    PAID: 'Pago',
  }
  const STATUS_COMM_STYLE: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    TRANSFER_PENDING: 'bg-blue-100 text-blue-800',
    PAID: 'bg-green-100 text-green-800',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Olá, {consultant.full_name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Sua taxa de comissão: <strong>{commissionRate}%</strong> sobre cada pedido
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: 'A receber',
            value: formatCurrency(totalPending),
            color: 'text-amber-600',
            bg: 'bg-amber-50',
          },
          {
            label: 'Total recebido',
            value: formatCurrency(totalPaid),
            color: 'text-green-600',
            bg: 'bg-green-50',
          },
          {
            label: 'Total gerado',
            value: formatCurrency(totalGenerated),
            color: 'text-blue-700',
            bg: 'bg-blue-50',
          },
        ].map((kpi) => (
          <div key={kpi.label} className={`rounded-xl border border-slate-200 ${kpi.bg} p-5`}>
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className={`mt-1 text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Clinics */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Minhas clínicas ({clinics?.length ?? 0})</h2>
          {!clinics?.length ? (
            <p className="text-sm text-slate-500">Nenhuma clínica vinculada ainda.</p>
          ) : (
            <ul className="space-y-2">
              {clinics.map((clinic) => (
                <li key={clinic.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-800">{clinic.trade_name}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
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

        {/* Commission history */}
        <div className="rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">
              Histórico de comissões ({comms.length})
            </h2>
          </div>
          {!comms.length ? (
            <p className="px-5 py-8 text-sm text-slate-500">
              Nenhuma comissão gerada ainda. As comissões aparecem aqui quando pedidos de suas
              clínicas são pagos.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Pedido
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Clínica
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Comissão
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
                  {comms.slice(0, 20).map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-sm text-blue-600">
                        <Link href={`/orders/${c.order_id}`} className="hover:underline">
                          {c.orders?.code ?? c.order_id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {c.orders?.clinics?.trade_name ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-slate-900">
                        {formatCurrency(Number(c.commission_amount))}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COMM_STYLE[c.status] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {STATUS_COMM[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-slate-500">
                        {formatDate(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
