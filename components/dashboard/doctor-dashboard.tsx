import { createClient } from '@/lib/db/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ButtonLink } from '@/components/ui/button-link'
import { Badge } from '@/components/ui/badge'
import { ShoppingBag, FileWarning } from 'lucide-react'
import type { ProfileWithRoles } from '@/types'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'

export async function DoctorDashboard({ user }: { user: ProfileWithRoles }) {
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from('orders')
    .select('id, code, order_status, total_price, created_at')
    .eq('created_by_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(8)

  const pendingDocs = orders?.filter((o) => o.order_status === 'AWAITING_DOCUMENTS') ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Olá, Dr(a). {user.full_name.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">Seus pedidos e documentações</p>
        </div>
        <ButtonLink href="/catalog">
          <ShoppingBag className="mr-2 h-4 w-4" />
          Solicitar produto
        </ButtonLink>
      </div>

      {pendingDocs.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <FileWarning className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {pendingDocs.length} pedido(s) aguardando documentação
            </p>
            <p className="mt-0.5 text-xs text-amber-600">
              Envie os documentos para avançar no processo.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base font-semibold">Meus pedidos</CardTitle>
          <Link href="/orders" className="text-sm text-[hsl(196,91%,33%)] hover:underline">
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {(orders?.length ?? 0) === 0 ? (
            <div className="py-8 text-center">
              <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">Você ainda não tem pedidos</p>
              <ButtonLink href="/catalog" size="sm" className="mt-3">
                Ver catálogo
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
                  <Badge variant="outline" className="text-xs">
                    {order.order_status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
