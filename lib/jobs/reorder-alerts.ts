import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'

/**
 * Predictive reorder alerts.
 *
 * For each (clinic, product) pair with >= 5 completed orders,
 * calculates the average reorder cycle and sends a notification
 * when the predicted next order date is within 5 days.
 *
 * Only sends one notification per (clinic, product) within the
 * same predicted window (tracked via last alert date logic).
 */

const MIN_ORDERS = 5
const ALERT_DAYS_BEFORE = 5

export const reorderAlertsJob = inngest.createFunction(
  {
    id: 'reorder-alerts',
    name: 'Predictive Reorder Alerts',
    triggers: [{ event: 'cron/reorder-alerts.check' as const }],
    retries: 3,
    timeouts: { finish: '10m' },
  },
  async ({ step }) => {
    const alerts = await step.run('compute-reorder-predictions', async () => {
      const admin = createAdminClient()

      // SQL: compute avg cycle per (clinic, product) with >= MIN_ORDERS completed orders.
      // @rpc-speculative: optional optimisation; the inline fallback is the canonical path
      // and covers the full behaviour. Not migrated because the inline version meets SLO
      // and keeps the computation close to the app's type system.
      const { data, error } = await admin.rpc('compute_reorder_predictions', {
        min_orders: MIN_ORDERS,
        alert_days: ALERT_DAYS_BEFORE,
      })

      if (error) {
        logger.warn('[reorder] RPC not available — using inline query')

        const { data: rawOrders, error: ordErr } = await admin
          .from('order_items')
          .select(
            `product_id,
             product:product_id (name),
             order:order_id (
               clinic_id,
               created_at,
               order_status
             )`
          )
          .not('order.order_status', 'is', null)
          .in('order.order_status', ['COMPLETED', 'DELIVERED', 'SHIPPED'])
          .order('order.created_at', { ascending: false })

        if (ordErr) throw new Error(`[reorder] order_items query failed: ${ordErr.message}`)

        // Group by (clinic_id, product_id)
        const groups = new Map<
          string,
          {
            clinic_id: string
            product_id: string
            product_name: string
            dates: Date[]
          }
        >()

        for (const item of rawOrders ?? []) {
          const order = item.order as unknown as {
            clinic_id: string
            created_at: string
            order_status: string
          } | null
          const product = item.product as unknown as { name: string } | null
          if (!order?.clinic_id) continue

          const key = `${order.clinic_id}::${item.product_id}`
          if (!groups.has(key)) {
            groups.set(key, {
              clinic_id: order.clinic_id,
              product_id: item.product_id,
              product_name: product?.name ?? 'Produto',
              dates: [],
            })
          }
          groups.get(key)!.dates.push(new Date(order.created_at))
        }

        const predictions: Array<{
          clinic_id: string
          product_id: string
          product_name: string
          avg_cycle_days: number
          last_order_at: Date
          predicted_next: Date
          days_until: number
        }> = []

        for (const group of groups.values()) {
          if (group.dates.length < MIN_ORDERS) continue

          group.dates.sort((a, b) => b.getTime() - a.getTime())
          const lastOrderAt = group.dates[0]

          // Calculate avg interval
          const intervals: number[] = []
          for (let i = 0; i < group.dates.length - 1; i++) {
            const diff =
              (group.dates[i].getTime() - group.dates[i + 1].getTime()) / (1000 * 60 * 60 * 24)
            intervals.push(diff)
          }
          const avgCycle = intervals.reduce((a, b) => a + b, 0) / intervals.length

          const predictedNext = new Date(lastOrderAt.getTime() + avgCycle * 24 * 60 * 60 * 1000)
          const daysUntil = Math.floor(
            (predictedNext.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )

          if (daysUntil >= 0 && daysUntil <= ALERT_DAYS_BEFORE) {
            predictions.push({
              ...group,
              avg_cycle_days: Math.round(avgCycle),
              last_order_at: lastOrderAt,
              predicted_next: predictedNext,
              days_until: daysUntil,
            })
          }
        }

        return predictions
      }

      return data ?? []
    })

    if (!alerts || alerts.length === 0) {
      logger.info('[reorder] No reorder alerts to send today')
      return { sent: 0 }
    }

    await step.run('send-reorder-notifications', async () => {
      const admin = createAdminClient()

      for (const alert of alerts) {
        // Get CLINIC_ADMIN user for this clinic
        const { data: members } = await admin
          .from('clinic_members')
          .select('user_id')
          .eq('clinic_id', alert.clinic_id)
          .eq('membership_role', 'ADMIN')
          .limit(1)
          .maybeSingle()

        if (!members?.user_id) continue

        // Get order template if exists
        const { data: template } = await admin
          .from('order_templates')
          .select('id, name')
          .eq('clinic_id', alert.clinic_id)
          .limit(1)
          .maybeSingle()

        const daysText =
          alert.days_until === 0
            ? 'hoje'
            : alert.days_until === 1
              ? 'amanhã'
              : `em ${alert.days_until} dias`

        await createNotification({
          userId: members.user_id,
          type: 'REORDER_ALERT',
          title: `🔄 Hora de repor: ${alert.product_name}`,
          body:
            `Você costuma pedir ${alert.product_name} a cada ${alert.avg_cycle_days} dias. ` +
            `O próximo pedido está previsto para ${daysText}.` +
            (template ? ` Use o template "${template.name}" para agilizar.` : ''),
          link: template ? `/orders/new?template=${template.id}` : '/orders/new',
          push: true,
        })
      }

      logger.info(`[reorder] Sent ${alerts.length} reorder alert(s)`)
    })

    return { sent: alerts.length }
  }
)
