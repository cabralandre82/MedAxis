import { Suspense } from 'react'
import { getAdminDashboardData } from '@/lib/dashboard'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ClipboardList,
  CreditCard,
  ArrowLeftRight,
  ShoppingBag,
  Building2,
  Pill,
  TrendingUp,
  Tag,
} from 'lucide-react'
import type { ProfileWithRoles } from '@/types'
import Link from 'next/link'
import { StaleOrdersWidget } from '@/components/dashboard/stale-orders-widget'

interface AdminDashboardProps {
  user: ProfileWithRoles
}

// getDashboardData is now cached in lib/dashboard.ts (5min TTL, revalidated on mutations)

export async function AdminDashboard({ user }: AdminDashboardProps) {
  const data = await getAdminDashboardData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Bom dia, {user.full_name.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">Aqui está um resumo da operação</p>
      </div>

      <Suspense fallback={null}>
        <StaleOrdersWidget />
      </Suspense>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Pedidos em aberto"
          value={data.openOrdersCount.toString()}
          icon={ClipboardList}
          color="blue"
          href="/orders"
        />
        <KpiCard
          title="Pagamentos pendentes"
          value={data.pendingPaymentsCount.toString()}
          sub={formatCurrency(data.pendingPaymentsAmount)}
          icon={CreditCard}
          color={data.pendingPaymentsCount > 0 ? 'amber' : 'green'}
          href="/payments"
          alert={data.pendingPaymentsCount > 0}
        />
        <KpiCard
          title="Repasses pendentes"
          value={data.pendingTransfersCount.toString()}
          sub={formatCurrency(data.pendingTransfersAmount)}
          icon={ArrowLeftRight}
          color={data.pendingTransfersCount > 0 ? 'amber' : 'green'}
          href="/transfers"
          alert={data.pendingTransfersCount > 0}
        />
        <KpiCard
          title="Receita confirmada"
          value={formatCurrency(data.totalRevenue)}
          icon={TrendingUp}
          color="green"
          href="/reports"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Produtos ativos"
          value={data.activeProductsCount.toString()}
          icon={ShoppingBag}
          color="indigo"
          href="/products"
          small
        />
        <KpiCard
          title="Aguardando preço"
          value={data.awaitingPricingCount.toString()}
          icon={Tag}
          color={data.awaitingPricingCount > 0 ? 'amber' : 'green'}
          href="/products"
          alert={data.awaitingPricingCount > 0}
          small
        />
        <KpiCard
          title="Clínicas ativas"
          value={data.activeClinicsCount.toString()}
          icon={Building2}
          color="teal"
          href="/clinics"
          small
        />
        <KpiCard
          title="Farmácias ativas"
          value={data.activePharmaciesCount.toString()}
          icon={Pill}
          color="cyan"
          href="/pharmacies"
          small
        />
      </div>

      {/* Recent Orders */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Pedidos recentes</CardTitle>
          <Link href="/orders" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {data.recentOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Nenhum pedido ainda</p>
          ) : (
            <div className="space-y-3">
              {data.recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pedido recente</p>
                    <p className="text-xs text-gray-500">{formatCurrency(order.total_price)}</p>
                  </div>
                  <OrderStatusBadge status={order.order_status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const COLOR_CLASSES: Record<string, { bg: string; icon: string; border: string }> = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', border: 'border-blue-100' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-100' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', border: 'border-green-100' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', border: 'border-indigo-100' },
  teal: { bg: 'bg-teal-50', icon: 'text-teal-600', border: 'border-teal-100' },
  cyan: { bg: 'bg-cyan-50', icon: 'text-cyan-600', border: 'border-cyan-100' },
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  href,
  alert,
  small,
}: {
  title: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  href: string
  alert?: boolean
  small?: boolean
}) {
  const colors = COLOR_CLASSES[color] ?? COLOR_CLASSES.blue

  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-shadow hover:shadow-md">
        <CardContent className={small ? 'p-4' : 'p-5'}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{title}</p>
              <p className={`mt-1 font-bold text-gray-900 ${small ? 'text-xl' : 'text-2xl'}`}>
                {value}
              </p>
              {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
            </div>
            <div className={`${colors.bg} relative flex-shrink-0 rounded-lg p-2.5`}>
              <Icon className={`${colors.icon} ${small ? 'h-4 w-4' : 'h-5 w-5'}`} />
              {alert && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

const ORDER_STATUS_LABELS: Record<string, { label: string; variant: string }> = {
  DRAFT: { label: 'Rascunho', variant: 'secondary' },
  AWAITING_DOCUMENTS: { label: 'Aguard. Docs', variant: 'outline' },
  AWAITING_PAYMENT: { label: 'Aguard. Pagamento', variant: 'outline' },
  PAYMENT_CONFIRMED: { label: 'Pago', variant: 'default' },
  RELEASED_FOR_EXECUTION: { label: 'Liberado', variant: 'default' },
  IN_EXECUTION: { label: 'Em execução', variant: 'default' },
  SHIPPED: { label: 'Enviado', variant: 'default' },
  DELIVERED: { label: 'Entregue', variant: 'default' },
  COMPLETED: { label: 'Concluído', variant: 'default' },
  CANCELED: { label: 'Cancelado', variant: 'destructive' },
  WITH_ISSUE: { label: 'Com Problema', variant: 'destructive' },
}

function OrderStatusBadge({ status }: { status: string }) {
  const info = ORDER_STATUS_LABELS[status] ?? { label: status, variant: 'secondary' }
  return (
    <Badge variant={info.variant as 'default' | 'secondary' | 'outline' | 'destructive'}>
      {info.label}
    </Badge>
  )
}
