import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { OrdersTable, type OrderRow } from '@/components/orders/orders-table'
import { ButtonLink } from '@/components/ui/button-link'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import { ExportButton } from '@/components/shared/export-button'
import { Plus } from 'lucide-react'
import { TemplatesList } from '@/components/orders/templates/templates-list'

export const metadata: Metadata = { title: 'Pedidos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

export default async function OrdersPage({ searchParams }: Props) {
  const { after, before } = await searchParams
  const user = await getCurrentUser()
  const supabase = await createClient()
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  let clinicId: string | null = null
  if (!isAdmin && user) {
    const admin = createAdminClient()
    const { data: membership } = await admin
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', user.id)
      .limit(1)
      .single()
    clinicId = membership?.clinic_id ?? null
  }

  // ── Cursor-based pagination ─────────────────────────────────────────────
  // Replaces OFFSET/LIMIT to avoid full-table scans at large page numbers.
  //
  // "after"  cursor → fetch records created BEFORE this ISO timestamp (next page)
  // "before" cursor → fetch records created AFTER this ISO timestamp, ASC, then reverse (prev page)
  //
  // We fetch PAGE_SIZE + 1 to detect whether a next/prev page exists.
  let query = supabase.from('orders').select(
    `id, code, order_status, payment_status, transfer_status,
       total_price, created_at,
       clinics (trade_name), doctors (full_name), pharmacies (trade_name),
       order_items (product_id, products (name))`
  )

  if (after) {
    query = query.lt('created_at', after).order('created_at', { ascending: false })
  } else if (before) {
    query = query.gt('created_at', before).order('created_at', { ascending: true })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  const { data: rawOrders } = await query.limit(PAGE_SIZE + 1)

  let orders = rawOrders ?? []

  // If paginating backwards, reverse so newest-first again
  if (before) orders = [...orders].reverse()

  const hasMore = orders.length > PAGE_SIZE
  if (hasMore) orders = orders.slice(0, PAGE_SIZE)

  const nextCursor = hasMore ? (orders[orders.length - 1]?.created_at ?? null) : null
  const prevCursor = after || before ? (orders[0]?.created_at ?? null) : null
  // On first page there's no "previous"
  const isFirstPage = !after && !before
  const displayPrevCursor = isFirstPage ? null : prevCursor

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {orders.length} pedido{orders.length !== 1 ? 's' : ''} nesta página
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <ExportButton type="orders" />}
          {!isAdmin && (
            <ButtonLink href="/catalog">
              <Plus className="mr-2 h-4 w-4" />
              Novo pedido
            </ButtonLink>
          )}
        </div>
      </div>

      {!isAdmin && clinicId && <TemplatesList clinicId={clinicId} />}

      <OrdersTable orders={orders as unknown as OrderRow[]} isAdmin={!!isAdmin} />

      <CursorPagination
        nextCursor={nextCursor}
        prevCursor={displayPrevCursor}
        pageSize={PAGE_SIZE}
        resultCount={orders.length}
      />
    </div>
  )
}
