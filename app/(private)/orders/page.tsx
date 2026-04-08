import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { getCurrentUser } from '@/lib/auth/session'
import { OrdersTable, type OrderRow } from '@/components/orders/orders-table'
import { ButtonLink } from '@/components/ui/button-link'
import { Plus } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Pedidos',
}

export default async function OrdersPage() {
  const user = await getCurrentUser()
  const supabase = await createClient()

  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  const { data: orders } = await supabase
    .from('orders')
    .select(
      `
      id, code, order_status, payment_status, transfer_status,
      total_price, quantity, created_at,
      clinics (trade_name),
      doctors (full_name),
      pharmacies (trade_name),
      products (name)
    `
    )
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {orders?.length ?? 0} pedido(s) encontrado(s)
          </p>
        </div>
        {!isAdmin && (
          <ButtonLink href="/catalog">
            <Plus className="mr-2 h-4 w-4" />
            Novo pedido
          </ButtonLink>
        )}
      </div>

      <OrdersTable orders={(orders ?? []) as unknown as OrderRow[]} isAdmin={!!isAdmin} />
    </div>
  )
}
