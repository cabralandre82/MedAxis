import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { notFound } from 'next/navigation'
import { ProductDetail } from '@/components/catalog/product-detail'
import { ProductRecommendations } from '@/components/catalog/product-recommendations'
import { BackButton } from '@/components/ui/back-button'
import { getCurrentUser } from '@/lib/auth/session'
import { resolveBuyerCouponPreview } from '@/lib/orders/buyer-coupon-context'

interface ProductPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params
  const admin = createAdminClient()
  const { data } = await admin.from('products').select('name').eq('slug', slug).single()
  return { title: data?.name ?? 'Produto' }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params
  const admin = createAdminClient()

  const { data: product } = await admin
    .from('products')
    .select(
      `
      *,
      product_categories (id, name, slug),
      pharmacies (id, trade_name, city, state),
      product_images (id, public_url, alt_text, sort_order),
      product_price_history (id, old_price, new_price, reason, created_at)
    `
    )
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (!product) notFound()

  // Fetch recommendations (server-side, no extra waterfall)
  const { data: assocData } = await admin
    .from('product_associations')
    .select(
      `product_b_id, support, confidence,
       product:product_b_id (id, name, slug, price_current, status,
         category:category_id (name))`
    )
    .eq('product_a_id', product.id)
    .gte('confidence', 0.1)
    .order('confidence', { ascending: false })
    .limit(4)

  const recommendations = (assocData ?? [])
    .map((row) => {
      const p = row.product as unknown as {
        id: string
        name: string
        slug: string
        price_current: number
        status: string
        category: { name: string } | null
      } | null
      if (!p || p.status !== 'active') return null
      return { ...p, confidence: row.confidence, support: row.support, category: p.category?.name }
    })
    .filter(Boolean)

  // Buyer-side coupon preview — clinic/doctor see the discounted price
  // here too, not just on the catalogue grid. Pharmacies never see it.
  // (regression-audit-2026-04-28 follow-up: fix #1 covered the grid but
  // missed this page and /orders/new — both fixed in the same wave.)
  const currentUser = await getCurrentUser()
  const couponMap = await resolveBuyerCouponPreview(currentUser, [product.id])
  const coupon = couponMap[product.id] ?? null

  return (
    <div className="space-y-6">
      <BackButton href="/catalog" label="Catálogo" />
      <ProductDetail product={product} coupon={coupon} />
      {recommendations.length > 0 && (
        <ProductRecommendations
          recommendations={
            recommendations as Parameters<typeof ProductRecommendations>[0]['recommendations']
          }
        />
      )}
    </div>
  )
}
