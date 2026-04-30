import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { CatalogGrid, type ProductCard } from '@/components/catalog/catalog-grid'
import { CatalogFilters } from '@/components/catalog/catalog-filters'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { ButtonLink } from '@/components/ui/button-link'
import { Plus } from 'lucide-react'
import { Suspense } from 'react'
import { resolveBuyerCouponPreview } from '@/lib/orders/buyer-coupon-context'
import { getMinTierUnitCentsByProductIds } from '@/lib/pricing/buyer-tiers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Catálogo | Clinipharma' }

const PAGE_SIZE = 12

interface CatalogPageProps {
  searchParams: Promise<{
    category?: string
    pharmacy?: string
    search?: string
    sort?: string
    page?: string
  }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams
  const supabase = createAdminClient()
  const currentUser = await getCurrentUser()
  const isPharmacy = currentUser?.roles.includes('PHARMACY_ADMIN') ?? false

  // For pharmacy: find their pharmacy_id from pharmacy_members
  let pharmacyId: string | undefined
  if (isPharmacy && currentUser) {
    const { data: membership } = await supabase
      .from('pharmacy_members')
      .select('pharmacy_id')
      .eq('user_id', currentUser.id)
      .single()
    pharmacyId = membership?.pharmacy_id ?? undefined
  }

  const page = parsePage(params.page)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  // Resolve category slug → id
  let categoryId: string | undefined
  if (params.category) {
    const { data: cat } = await supabase
      .from('product_categories')
      .select('id')
      .eq('slug', params.category)
      .single()
    categoryId = cat?.id
  }

  // Build order
  const sort = params.sort ?? 'featured'
  const orderMap: Record<string, { col: string; asc: boolean }> = {
    featured: { col: 'featured', asc: false },
    name_asc: { col: 'name', asc: true },
    price_asc: { col: 'price_current', asc: true },
    price_desc: { col: 'price_current', asc: false },
    newest: { col: 'created_at', asc: false },
  }
  const { col: sortCol, asc: sortAsc } = orderMap[sort] ?? orderMap.featured

  // PR-D3: also pull `pricing_mode` and `is_manipulated` so the grid
  // can swap to "A partir de R$ X" + "Magistral" chip on TIERED
  // products. Both are cheap booleans/enum on the same row.
  const PRODUCT_COLUMNS = `id, name, slug, concentration, presentation,
       short_description, price_current, estimated_deadline_days,
       active, status, featured, pricing_mode, is_manipulated,
       product_categories (id, name, slug),
       pharmacies (id, trade_name),
       product_images (id, public_url, alt_text, sort_order)`

  let query = supabase
    .from('products')
    .select(PRODUCT_COLUMNS, { count: 'exact' })
    .in('status', ['active', 'unavailable'])

  // Pharmacy admins see only their own products (all statuses)
  if (isPharmacy && pharmacyId) {
    query = supabase
      .from('products')
      .select(PRODUCT_COLUMNS, { count: 'exact' })
      .eq('pharmacy_id', pharmacyId)
  }

  if (!isPharmacy) {
    if (categoryId) query = query.eq('category_id', categoryId)
    if (params.pharmacy) query = query.eq('pharmacy_id', params.pharmacy)
    if (params.search) query = query.ilike('name', `%${params.search}%`)
  } else {
    if (params.search) query = query.ilike('name', `%${params.search}%`)
  }

  if (sortCol === 'featured') {
    query = query.order('featured', { ascending: false }).order('name', { ascending: true })
  } else {
    query = query.order(sortCol, { ascending: sortAsc })
  }

  const { data: products, count } = await query.range(from, to)

  const [{ data: categories }, { data: pharmacies }] = await Promise.all([
    supabase
      .from('product_categories')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('pharmacies').select('id, trade_name').eq('status', 'ACTIVE').order('trade_name'),
  ])

  const productIds = (products ?? []).map((p) => String((p as { id: string }).id))

  // PR-D3: batch lookup the MIN tier unit price for each TIERED
  // product on the page. We only ask for products that need it —
  // FIXED rows skip the RPC.
  const tieredProductIds = (products ?? [])
    .filter((p) => (p as { pricing_mode?: string }).pricing_mode === 'TIERED_PROFILE')
    .map((p) => String((p as { id: string }).id))

  const [couponPreviewByProduct, minTierByProduct] = await Promise.all([
    // Buyer-side coupon preview — clinic or doctor sees a "with coupon"
    // chip on each card so they don't have to place an order to learn
    // whether the coupon is wired up. Pharmacies never see this.
    // (regression-audit-2026-04-28 item #1)
    //
    // Buyer resolution + RPC call live in `lib/orders/buyer-coupon-context.ts`
    // so /catalog, /catalog/[slug] and /orders/new all use the SAME
    // discount preview. (Same fix, three surfaces — see the 2026-04-28
    // follow-up note in regression-audit.)
    resolveBuyerCouponPreview(currentUser, productIds),
    tieredProductIds.length > 0
      ? getMinTierUnitCentsByProductIds(tieredProductIds)
      : Promise.resolve<Record<string, number>>({}),
  ])

  // Stitch min tier into each product. We mutate a shallow clone so
  // the typed cast below stays honest — we don't reach into the
  // Supabase result type, we re-shape it into ProductCard.
  const cards = (products ?? []).map((p) => {
    const id = String((p as { id: string }).id)
    const min = minTierByProduct[id]
    if (typeof min === 'number') {
      return { ...(p as object), min_tier_unit_cents: min }
    }
    return p
  })

  if (isPharmacy) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Meus produtos</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {count ?? 0} produto(s) cadastrado(s) pela sua farmácia
            </p>
          </div>
          <ButtonLink href="/products/new" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Novo produto
          </ButtonLink>
        </div>

        <CatalogGrid products={cards as unknown as ProductCard[]} pharmacyMode />

        <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catálogo de produtos</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} produto(s) encontrado(s)</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <CatalogFilters
          categories={categories ?? []}
          pharmacies={pharmacies ?? []}
          currentCategory={params.category}
          currentPharmacy={params.pharmacy}
          currentSearch={params.search}
          currentSort={sort}
        />
      </Suspense>

      <CatalogGrid
        products={cards as unknown as ProductCard[]}
        couponPreviewByProduct={couponPreviewByProduct}
      />

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
