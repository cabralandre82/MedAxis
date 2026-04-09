import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { getCurrentUser } from '@/lib/auth/session'
import { OrdersTable, type OrderRow } from '@/components/orders/orders-table'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Pedidos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function OrdersPage({ searchParams }: Props) {
  const { page: pageRaw } = await searchParams
  const user = await getCurrentUser()
  const supabase = await createClient()
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: orders, count } = await supabase
    .from('orders')
    .select(
      `id, code, order_status, payment_status, transfer_status,
       total_price, created_at,
       clinics (trade_name), doctors (full_name), pharmacies (trade_name),
       order_items (product_id, products (name))`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} pedido(s) no total</p>
        </div>
        {!isAdmin && (
          <ButtonLink href="/catalog">
            <Plus className="mr-2 h-4 w-4" />
            Novo pedido
          </ButtonLink>
        )}
      </div>

      <OrdersTable orders={(orders ?? []) as unknown as OrderRow[]} isAdmin={!!isAdmin} />

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
