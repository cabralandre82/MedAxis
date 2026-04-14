import { Suspense } from 'react'
import { createAdminClient } from '@/lib/db/admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  Truck,
  AlertTriangle,
  Clock,
  FlaskConical,
  FileSearch,
  PackageCheck,
} from 'lucide-react'
import type { ProfileWithRoles } from '@/types'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getDaysDiff, getStaleThreshold } from '@/lib/stale-orders'
import { STATUS_LABELS } from '@/lib/orders/status-machine'

async function PharmacyStaleOrders({ pharmacyId }: { pharmacyId: string }) {
  const admin = createAdminClient()
  const { data: orders } = await admin
    .from('orders')
    .select('id, code, order_status, updated_at, clinics(trade_name)')
    .eq('pharmacy_id', pharmacyId)
    .not('order_status', 'in', '("COMPLETED","DELIVERED","CANCELED","DRAFT")')

  const stale = (orders ?? [])
    .map((o) => ({
      ...o,
      threshold: getStaleThreshold(o.order_status),
      daysStale: getDaysDiff(o.updated_at),
      clinic: (o.clinics as { trade_name?: string } | null)?.trade_name ?? '—',
    }))
    .filter((o) => o.threshold !== null && o.daysStale >= (o.threshold ?? 0))
    .sort((a, b) => b.daysStale - a.daysStale)

  if (stale.length === 0) return null

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-red-500" />
        <h2 className="font-semibold text-red-900">
          {stale.length} pedido{stale.length > 1 ? 's' : ''} parado{stale.length > 1 ? 's' : ''}
        </h2>
      </div>
      <div className="space-y-2">
        {stale.slice(0, 5).map((o) => (
          <Link
            key={o.id}
            href={`/orders/${o.id}`}
            className="flex items-center justify-between rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm transition-colors hover:bg-red-50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <code className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-700">
                {o.code}
              </code>
              <span className="truncate text-gray-600">{o.clinic}</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-600">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">{o.daysStale}d</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export async function PharmacyDashboard({ user }: { user: ProfileWithRoles }) {
  const admin = createAdminClient()

  // Resolve pharmacy membership — use adminClient for reliability
  const { data: memberRow } = await admin
    .from('pharmacy_members')
    .select('pharmacy_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  const myPharmacyId = memberRow?.pharmacy_id ?? null

  // Scoped order query — always filter by pharmacy_id
  const { data: orders } = myPharmacyId
    ? await admin
        .from('orders')
        .select('id, code, order_status, total_price, created_at, clinics(trade_name)')
        .eq('pharmacy_id', myPharmacyId)
        .in('order_status', [
          'READY_FOR_REVIEW',
          'RELEASED_FOR_EXECUTION',
          'RECEIVED_BY_PHARMACY',
          'IN_EXECUTION',
          'READY',
          'SHIPPED',
        ])
        .order('created_at', { ascending: false })
        .limit(20)
    : { data: [] }

  // Scoped transfer query — always filter by pharmacy_id
  const { data: transfers } = myPharmacyId
    ? await admin
        .from('transfers')
        .select('id, status, net_amount, created_at')
        .eq('pharmacy_id', myPharmacyId)
        .order('created_at', { ascending: false })
        .limit(5)
    : { data: [] }

  const allOrders = orders ?? []
  const allTransfers = transfers ?? []

  const pendingReview = allOrders.filter((o) => o.order_status === 'READY_FOR_REVIEW')
  const toStart = allOrders.filter((o) => o.order_status === 'RELEASED_FOR_EXECUTION')
  const inProgress = allOrders.filter((o) =>
    ['RECEIVED_BY_PHARMACY', 'IN_EXECUTION'].includes(o.order_status)
  )
  const inTransit = allOrders.filter((o) => ['READY', 'SHIPPED'].includes(o.order_status))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Olá, {user.full_name.split(' ')[0]}</h1>
        <p className="mt-0.5 text-sm text-gray-500">Painel operacional da farmácia</p>
      </div>

      {myPharmacyId && (
        <Suspense fallback={null}>
          <PharmacyStaleOrders pharmacyId={myPharmacyId} />
        </Suspense>
      )}

      {/* Status counters */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link href="/orders" className="block">
          <Card
            className={`transition-shadow hover:shadow-md ${pendingReview.length > 0 ? 'border-amber-300 bg-amber-50' : ''}`}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-lg p-2.5 ${pendingReview.length > 0 ? 'bg-amber-100' : 'bg-gray-100'}`}
                >
                  <FileSearch
                    className={`h-5 w-5 ${pendingReview.length > 0 ? 'text-amber-600' : 'text-gray-400'}`}
                  />
                </div>
                <div>
                  <p className="text-xs tracking-wide text-gray-500 uppercase">
                    Revisar documentos
                  </p>
                  <p
                    className={`text-2xl font-bold ${pendingReview.length > 0 ? 'text-amber-700' : 'text-gray-900'}`}
                  >
                    {pendingReview.length}
                  </p>
                </div>
              </div>
              {pendingReview.length > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-700">Ação necessária →</p>
              )}
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2.5">
                <PackageCheck className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Para iniciar</p>
                <p className="text-2xl font-bold text-gray-900">{toStart.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2.5">
                <FlaskConical className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Em manipulação</p>
                <p className="text-2xl font-bold text-gray-900">{inProgress.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-50 p-2.5">
                <Truck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Em transporte</p>
                <p className="text-2xl font-bold text-gray-900">{inTransit.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Pedidos ativos</CardTitle>
            <Link href="/orders" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {allOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">Sem pedidos no momento</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {allOrders.slice(0, 10).map((order) => {
                  const clinic = (order.clinics as { trade_name?: string } | null)?.trade_name
                  return (
                    <div key={order.id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/orders/${order.id}`}
                          className="text-sm font-medium text-gray-900 hover:text-[hsl(196,91%,36%)]"
                        >
                          {order.code}
                        </Link>
                        {clinic && <p className="truncate text-xs text-gray-500">{clinic}</p>}
                      </div>
                      <Badge
                        variant={
                          order.order_status === 'READY_FOR_REVIEW' ? 'destructive' : 'outline'
                        }
                        className="ml-2 shrink-0 text-xs"
                      >
                        {STATUS_LABELS[order.order_status] ?? order.order_status}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Repasses recentes</CardTitle>
            <Link href="/transfers" className="text-sm text-[hsl(196,91%,36%)] hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {allTransfers.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">Sem repasses ainda</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {allTransfers.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatCurrency(t.net_amount)}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(t.created_at)}</p>
                    </div>
                    <Badge
                      variant={t.status === 'COMPLETED' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {t.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
