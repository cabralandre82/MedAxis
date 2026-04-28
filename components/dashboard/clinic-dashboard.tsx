import { createClient } from '@/lib/db/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ButtonLink } from '@/components/ui/button-link'
import { ClipboardList, ShoppingBag, FileWarning } from 'lucide-react'
import type { ProfileWithRoles } from '@/types'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { statusLabel, statusBadgeClass } from '@/lib/orders/status-machine'

export async function ClinicDashboard({ user }: { user: ProfileWithRoles }) {
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from('orders')
    .select('id, code, order_status, total_price, created_at')
    .order('created_at', { ascending: false })
    .limit(8)

  const pendingDocs = orders?.filter((o) => o.order_status === 'AWAITING_DOCUMENTS') ?? []
  const awaitingPayment = orders?.filter((o) => o.order_status === 'AWAITING_PAYMENT') ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Olá, {user.full_name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-sm text-gray-500">Gerencie os pedidos da sua clínica</p>
        </div>
        <ButtonLink href="/catalog">
          <ShoppingBag className="mr-2 h-4 w-4" />
          Novo pedido
        </ButtonLink>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2.5">
                <ClipboardList className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Total de pedidos</p>
                <p className="text-2xl font-bold text-gray-900">{orders?.length ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2.5">
                <FileWarning className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Docs pendentes</p>
                <p className="text-2xl font-bold text-gray-900">{pendingDocs.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-50 p-2.5">
                <ClipboardList className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs tracking-wide text-gray-500 uppercase">Aguard. pagamento</p>
                <p className="text-2xl font-bold text-gray-900">{awaitingPayment.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Pedidos recentes</CardTitle>
          <Link href="/orders" className="text-sm text-[hsl(196,91%,33%)] hover:underline">
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {(orders?.length ?? 0) === 0 ? (
            <div className="py-8 text-center">
              <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">Nenhum pedido ainda</p>
              <ButtonLink href="/catalog" size="sm" className="mt-3">
                Acessar catálogo
              </ButtonLink>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders?.map((order) => (
                <div key={order.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-[hsl(196,91%,33%)]"
                    >
                      {order.code}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {formatDate(order.created_at)} · {formatCurrency(order.total_price)}
                    </p>
                  </div>
                  {/* Status pill — i18n + cor canônicas vindas de
                      lib/orders/status-machine.ts. Antes renderizava
                      `order_status.replace(/_/g, ' ')` que cuspia o enum
                      em inglês cru. */}
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(order.order_status)}`}
                  >
                    {statusLabel(order.order_status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
