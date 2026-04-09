import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExportButton } from '@/components/shared/export-button'
import {
  TrendingUp,
  ShoppingBag,
  CreditCard,
  ArrowLeftRight,
  Building2,
  Package,
  Clock,
  AlertCircle,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Relatórios | Clinipharma' }

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  AWAITING_DOCUMENTS: 'Aguard. Docs',
  READY_FOR_REVIEW: 'Em revisão',
  AWAITING_PAYMENT: 'Aguard. Pagto',
  PAYMENT_UNDER_REVIEW: 'Pagto em análise',
  PAYMENT_CONFIRMED: 'Pagto confirmado',
  COMMISSION_CALCULATED: 'Comissão calc.',
  TRANSFER_PENDING: 'Repasse pendente',
  TRANSFER_COMPLETED: 'Repasse concluído',
  READY: 'Pronto',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com problema',
}

export default async function ReportsPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const [
    ordersRes,
    paymentsRes,
    transfersRes,
    clinicsRes,
    productsRes,
    consultantsRes,
    commissionRes,
  ] = await Promise.all([
    supabase.from('orders').select('id, order_status, total_price, created_at').order('created_at'),
    supabase.from('payments').select('id, status, gross_amount'),
    supabase.from('transfers').select('id, status, net_amount, commission_amount'),
    supabase.from('clinics').select('id, trade_name, status'),
    supabase.from('products').select('id, name, active'),
    supabase.from('sales_consultants').select('id, status'),
    supabase.from('consultant_commissions').select('id, status, commission_amount'),
  ])

  const orders = ordersRes.data ?? []
  const payments = paymentsRes.data ?? []
  const transfers = transfersRes.data ?? []

  // ── KPIs ──────────────────────────────────────────────
  const totalOrders = orders.length
  const completedOrders = orders.filter((o) => o.order_status === 'COMPLETED').length
  const canceledOrders = orders.filter((o) => o.order_status === 'CANCELED').length
  const openOrders = orders.filter(
    (o) => !['COMPLETED', 'CANCELED'].includes(o.order_status)
  ).length

  const confirmedPayments = payments.filter((p) => p.status === 'CONFIRMED')
  const pendingPayments = payments.filter((p) => p.status === 'PENDING').length
  const totalRevenue = confirmedPayments.reduce((s, p) => s + Number(p.gross_amount), 0)
  const avgTicket = confirmedPayments.length ? totalRevenue / confirmedPayments.length : 0

  const completedTransfers = transfers.filter((t) => t.status === 'COMPLETED')
  const pendingTransfers = transfers.filter((t) => t.status === 'PENDING').length
  const totalTransferred = completedTransfers.reduce((s, t) => s + Number(t.net_amount), 0)
  const totalCommission = completedTransfers.reduce((s, t) => s + Number(t.commission_amount), 0)

  const pendingConsultantComm = (commissionRes.data ?? [])
    .filter((c) => c.status === 'PENDING')
    .reduce((s, c) => s + Number(c.commission_amount), 0)

  // ── Orders by month (last 6 months) ──────────────────
  const byMonth: Record<string, { count: number; total: number }> = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth[key] = { count: 0, total: 0 }
  }
  for (const o of orders) {
    const key = o.created_at?.slice(0, 7)
    if (key && byMonth[key]) {
      byMonth[key].count++
      byMonth[key].total += Number(o.total_price)
    }
  }
  const monthEntries = Object.entries(byMonth)
  const maxCount = Math.max(1, ...monthEntries.map(([, v]) => v.count))

  // ── Status breakdown ──────────────────────────────────
  const statusBreakdown = Object.entries(
    orders.reduce<Record<string, number>>((acc, o) => {
      acc[o.order_status] = (acc[o.order_status] ?? 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
          <p className="mt-0.5 text-sm text-gray-500">Visão gerencial da operação</p>
        </div>
        <div className="flex gap-2">
          <ExportButton type="orders" label="Pedidos" />
          <ExportButton type="payments" label="Pagamentos" />
        </div>
      </div>

      {/* Pendências urgentes */}
      {(pendingPayments > 0 || pendingTransfers > 0 || pendingConsultantComm > 0) && (
        <div className="flex flex-wrap gap-3">
          {pendingPayments > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800">
                {pendingPayments} pagamento(s) pendente(s)
              </span>
            </div>
          )}
          {pendingTransfers > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-orange-600" />
              <span className="text-sm font-medium text-orange-800">
                {pendingTransfers} repasse(s) pendente(s)
              </span>
            </div>
          )}
          {pendingConsultantComm > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2.5">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-purple-600" />
              <span className="text-sm font-medium text-purple-800">
                {formatCurrency(pendingConsultantComm)} em comissões de consultores
              </span>
            </div>
          )}
        </div>
      )}

      {/* KPIs Row 1 — Pedidos */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<ShoppingBag className="h-5 w-5 text-blue-600" />}
          label="Total de pedidos"
          value={totalOrders.toString()}
          bg="blue"
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label="Pedidos concluídos"
          value={completedOrders.toString()}
          bg="green"
        />
        <KpiCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          label="Pedidos em aberto"
          value={openOrders.toString()}
          bg="amber"
        />
        <KpiCard
          icon={<AlertCircle className="h-5 w-5 text-red-500" />}
          label="Pedidos cancelados"
          value={canceledOrders.toString()}
          bg="red"
        />
      </div>

      {/* KPIs Row 2 — Financeiro */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<CreditCard className="h-5 w-5 text-green-600" />}
          label="Receita confirmada"
          value={formatCurrency(totalRevenue)}
          bg="green"
          large
        />
        <KpiCard
          icon={<ArrowLeftRight className="h-5 w-5 text-blue-600" />}
          label="Total repassado"
          value={formatCurrency(totalTransferred)}
          bg="blue"
          large
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
          label="Comissão plataforma"
          value={formatCurrency(totalCommission)}
          bg="indigo"
          large
        />
        <KpiCard
          icon={<ShoppingBag className="h-5 w-5 text-teal-600" />}
          label="Ticket médio"
          value={formatCurrency(avgTicket)}
          bg="teal"
          large
        />
      </div>

      {/* Chart: pedidos por mês + status breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos nos últimos 6 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-3">
              {monthEntries.map(([month, { count, total }]) => {
                const heightPct = Math.round((count / maxCount) * 100)
                const label = new Date(month + '-01').toLocaleDateString('pt-BR', {
                  month: 'short',
                  year: '2-digit',
                })
                return (
                  <div
                    key={month}
                    className="group relative flex flex-1 flex-col items-center gap-1"
                  >
                    <div
                      className="w-full rounded-t bg-[hsl(213,75%,24%)] transition-all hover:bg-[hsl(196,91%,36%)]"
                      style={{ height: `${heightPct}%`, minHeight: count > 0 ? '4px' : '2px' }}
                      title={`${count} pedidos · ${formatCurrency(total)}`}
                    />
                    <p className="text-[10px] text-gray-500">{label}</p>
                    {count > 0 && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {count}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos por status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {statusBreakdown.slice(0, 8).map(([status, count]) => {
                const pct = Math.round((count / totalOrders) * 100)
                return (
                  <div key={status}>
                    <div className="mb-0.5 flex items-center justify-between text-xs text-gray-600">
                      <span>{STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}</span>
                      <span className="font-semibold text-gray-900">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-[hsl(213,75%,24%)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Entidades */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Clínicas ativas</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(clinicsRes.data ?? []).filter((c) => c.status === 'ACTIVE').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50">
                <Package className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Produtos ativos</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(productsRes.data ?? []).filter((p) => p.active).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
                <CreditCard className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Pgtos confirmados</p>
                <p className="text-2xl font-bold text-gray-900">{confirmedPayments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Consultores ativos</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(consultantsRes.data ?? []).filter((c) => c.status === 'ACTIVE').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  bg,
  large = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  bg: string
  large?: boolean
}) {
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50',
    green: 'bg-green-50',
    amber: 'bg-amber-50',
    red: 'bg-red-50',
    indigo: 'bg-indigo-50',
    teal: 'bg-teal-50',
  }
  return (
    <Card>
      <CardContent className="p-5">
        <div
          className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${bgMap[bg] ?? 'bg-gray-50'}`}
        >
          {icon}
        </div>
        <p className="text-xs tracking-wide text-gray-500 uppercase">{label}</p>
        <p className={`mt-1 font-bold text-gray-900 ${large ? 'text-xl' : 'text-2xl'}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
