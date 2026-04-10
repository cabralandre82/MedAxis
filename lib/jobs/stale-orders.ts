import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { createNotificationForRole } from '@/lib/notifications'

const STALE_THRESHOLD_HOURS = 48

type StaleOrder = {
  id: string
  code: string
  order_status: string
  updated_at: string
}

/**
 * Background job: Alert admins about stale orders.
 * Replaces the previous cron-only implementation with a resilient
 * background job that retries on failure.
 */
export const staleOrdersJob = inngest.createFunction(
  {
    id: 'check-stale-orders',
    name: 'Check Stale Orders',
    triggers: [{ event: 'cron/stale-orders.check' as const }],
    retries: 3,
    timeouts: { finish: '5m' },
  },
  async ({ step }) => {
    const staleOrders = await step.run('fetch-stale-orders', async () => {
      const admin = createAdminClient()
      const threshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString()

      const { data, error } = await admin
        .from('orders')
        .select('id, code, order_status, updated_at')
        .not('order_status', 'in', '("COMPLETED","CANCELLED","REJECTED")')
        .lt('updated_at', threshold)
        .order('updated_at', { ascending: true })
        .limit(50)

      if (error) throw new Error(`Stale orders query failed: ${error.message}`)
      return (data ?? []) as StaleOrder[]
    })

    if (staleOrders.length === 0) return { stale: 0 }

    await step.run('send-notifications', async () => {
      const orderList = staleOrders
        .map(
          (o) =>
            `• Pedido ${o.code} (status: ${o.order_status}) — parado desde ${new Date(o.updated_at).toLocaleDateString('pt-BR')}`
        )
        .join('\n')

      await createNotificationForRole('SUPER_ADMIN', {
        type: 'GENERIC',
        title: `⚠️ ${staleOrders.length} pedido(s) parado(s) por +${STALE_THRESHOLD_HOURS}h`,
        message: `Os seguintes pedidos não tiveram movimentação:\n${orderList}`,
        link: '/admin/orders?filter=stale',
      })
    })

    return { stale: staleOrders.length }
  }
)
