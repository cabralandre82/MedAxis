import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'

/**
 * Admin dashboard metrics — cached for 5 minutes (300s).
 *
 * Revalidation tags:
 *   - 'dashboard'         → revalidated on any significant state change
 *   - 'dashboard-orders'  → revalidated when orders change
 *   - 'dashboard-finance' → revalidated when payments/transfers change
 *
 * Call revalidateTag('dashboard') in:
 *   - createOrder, updateOrderStatus
 *   - confirmPayment, completeTransfer
 */
export const getAdminDashboardData = unstable_cache(
  async () => {
    // Use admin client — unstable_cache cannot use cookies() (request-scoped).
    // Dashboard data is aggregate/non-sensitive; page-level auth guards access.
    const supabase = createAdminClient()

    // All 6 queries run in parallel — single round-trip to DB per cache miss
    const [orders, payments, transfers, products, clinics, pharmacies] = await Promise.all([
      supabase
        .from('orders')
        .select('id, order_status, total_price, created_at, code')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('payments').select('id, status, gross_amount'),
      supabase.from('transfers').select('id, status, net_amount'),
      supabase.from('products').select('id, active, price_current'),
      supabase.from('clinics').select('id, status'),
      supabase.from('pharmacies').select('id, status'),
    ])

    const pendingPayments = (payments.data ?? []).filter((p) => p.status === 'PENDING')
    const pendingTransfers = (transfers.data ?? []).filter((t) => t.status === 'PENDING')
    const activeProducts = (products.data ?? []).filter((p) => p.active)
    const awaitingPricing = (products.data ?? []).filter((p) => Number(p.price_current) === 0)
    const activeClinics = (clinics.data ?? []).filter((c) => c.status === 'ACTIVE')
    const activePharmacies = (pharmacies.data ?? []).filter((p) => p.status === 'ACTIVE')

    const openOrders = (orders.data ?? []).filter(
      (o) => !['COMPLETED', 'CANCELED'].includes(o.order_status)
    )

    const recentOrders = (orders.data ?? []).slice(0, 5)

    const totalRevenue = (payments.data ?? [])
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((s, p) => s + Number(p.gross_amount), 0)

    return {
      pendingPaymentsCount: pendingPayments.length,
      pendingPaymentsAmount: pendingPayments.reduce((s, p) => s + Number(p.gross_amount), 0),
      pendingTransfersCount: pendingTransfers.length,
      pendingTransfersAmount: pendingTransfers.reduce((s, t) => s + Number(t.net_amount), 0),
      activeProductsCount: activeProducts.length,
      awaitingPricingCount: awaitingPricing.length,
      activeClinicsCount: activeClinics.length,
      activePharmaciesCount: activePharmacies.length,
      openOrdersCount: openOrders.length,
      totalRevenue,
      recentOrders,
    }
  },
  ['admin-dashboard-metrics'],
  {
    revalidate: 300, // 5 minutes
    tags: ['dashboard', 'dashboard-orders', 'dashboard-finance'],
  }
)
