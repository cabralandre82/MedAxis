import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'

import { OrdersTable, type OrderRow } from '@/components/orders/orders-table'
import { ButtonLink } from '@/components/ui/button-link'
import { CursorPagination } from '@/components/ui/cursor-pagination'
import { ExportButton } from '@/components/shared/export-button'
import { Plus } from 'lucide-react'
import { TemplatesList } from '@/components/orders/templates/templates-list'
import { resolveViewMode } from '@/lib/orders/view-mode'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Pedidos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ after?: string; before?: string }>
}

export default async function OrdersPage({ searchParams }: Props) {
  const { after, before } = await searchParams
  const user = await getCurrentUser()
  const admin = createAdminClient()
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isPharmacy = user?.roles.includes('PHARMACY_ADMIN')

  // Resolve scope filter: clinic or pharmacy membership
  let clinicId: string | null = null
  let pharmacyId: string | null = null

  if (!isAdmin && user) {
    if (isPharmacy) {
      const { data: membership } = await admin
        .from('pharmacy_members')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()
      pharmacyId = membership?.pharmacy_id ?? null
    } else {
      const { data: membership } = await admin
        .from('clinic_members')
        .select('clinic_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()
      clinicId = membership?.clinic_id ?? null
    }
  }

  // ── Cursor-based pagination ─────────────────────────────────────────────
  // Use adminClient with explicit scope filter so CLINIC_ADMIN and PHARMACY_ADMIN
  // always see their own orders regardless of RLS bootstrap state.
  // Note: pharmacy_cost_per_unit is selected on order_items so the table can
  // render the *repasse total* per row for PHARMACY_ADMIN — the canonical
  // sales price (`total_price`) is filtered out by `resolveViewMode` below
  // before rendering. See lib/orders/view-mode.ts for the rule.
  let query = admin.from('orders').select(
    `id, code, order_status, payment_status, transfer_status,
       total_price, created_at,
       clinics (trade_name), doctors (full_name), pharmacies (trade_name),
       order_items (product_id, quantity, pharmacy_cost_per_unit, products (name))`
  )

  if (clinicId) query = query.eq('clinic_id', clinicId)
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId)

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
          {/* "Novo pedido" só faz sentido para quem **compra** — clínica ou
              médico. Farmácia executa pedidos, não cria. */}
          {!isAdmin && !isPharmacy && (
            <ButtonLink href="/catalog">
              <Plus className="mr-2 h-4 w-4" />
              Novo pedido
            </ButtonLink>
          )}
        </div>
      </div>

      {!isAdmin && clinicId && <TemplatesList clinicId={clinicId} />}

      <OrdersTable
        orders={orders as unknown as OrderRow[]}
        viewMode={resolveViewMode(user?.roles)}
      />

      <CursorPagination
        nextCursor={nextCursor}
        prevCursor={displayPrevCursor}
        pageSize={PAGE_SIZE}
        resultCount={orders.length}
      />
    </div>
  )
}
