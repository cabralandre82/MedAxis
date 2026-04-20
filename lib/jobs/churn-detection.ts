import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { logger } from '@/lib/logger'

/**
 * Churn detection signals (internal only — not shown to clinics).
 *
 * Score thresholds:
 *  >= 60 → HIGH risk  (notify consultant + SUPER_ADMIN)
 *  >= 30 → MODERATE risk (notify consultant only)
 *  <  30 → low risk (no notification)
 */

interface ClinicChurnSignal {
  clinic_id: string
  clinic_name: string
  consultant_user_id: string | null
  avg_cycle_days: number
  days_since_last_order: number
  open_tickets: number
  failed_payments: number
  score: number
}

export const churnDetectionJob = inngest.createFunction(
  {
    id: 'churn-detection',
    name: 'Clinic Churn Detection',
    triggers: [{ event: 'cron/churn.check' as const }],
    retries: 3,
    timeouts: { finish: '10m' },
  },
  async ({ step }) => {
    const atRisk = await step.run('compute-churn-scores', async () => {
      const admin = createAdminClient()

      // Clinics with at least 1 completed order — compute avg cycle + days since last order.
      // @rpc-speculative: this RPC is an optional optimisation; if absent, the inline query
      // below covers the full functional path. Intentionally unmigrated because the inline
      // path is already within SLO and a DB-side version adds cache-invalidation complexity.
      const { error: cycleErr } = await admin.rpc('compute_clinic_order_cycles')

      if (cycleErr) {
        logger.warn('[churn] RPC not available, using inline query')
      }

      // Direct query approach (works without RPC)
      const { data: clinicsRaw, error } = await admin
        .from('clinics')
        .select(
          `id, trade_name, status,
           consultant:consultant_id (
             id,
             user_id
           )`
        )
        .eq('status', 'ACTIVE')

      if (error) throw new Error(`[churn] clinic query failed: ${error.message}`)

      const results: ClinicChurnSignal[] = []

      for (const clinic of clinicsRaw ?? []) {
        // Get order history for cycle calculation
        const { data: orderDates } = await admin
          .from('orders')
          .select('created_at')
          .eq('clinic_id', clinic.id)
          .in('order_status', ['COMPLETED', 'DELIVERED', 'SHIPPED'])
          .order('created_at', { ascending: false })
          .limit(20)

        if (!orderDates || orderDates.length < 2) continue

        const lastOrderAt = new Date(orderDates[0].created_at)
        const daysSinceLast = Math.floor(
          (Date.now() - lastOrderAt.getTime()) / (1000 * 60 * 60 * 24)
        )

        // Calculate average cycle (days between consecutive orders)
        const intervals: number[] = []
        for (let i = 0; i < orderDates.length - 1; i++) {
          const diff =
            (new Date(orderDates[i].created_at).getTime() -
              new Date(orderDates[i + 1].created_at).getTime()) /
            (1000 * 60 * 60 * 24)
          intervals.push(diff)
        }
        const avgCycle = intervals.reduce((a, b) => a + b, 0) / intervals.length

        // Open support tickets
        const { count: openTickets } = await admin
          .from('support_tickets')
          .select('id', { count: 'exact', head: true })
          .eq('created_by_user_id', clinic.id) // approximate — clinic member tickets
          .in('status', ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT'])

        // Failed payments (last 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { count: failedPayments } = await admin
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .eq('clinic_id', clinic.id)
          .eq('status', 'FAILED')
          .gte('created_at', thirtyDaysAgo)

        // Score calculation
        let score = 0

        // Main signal: days vs avg cycle
        const cycleRatio = daysSinceLast / Math.max(avgCycle, 7)
        if (cycleRatio >= 2.0) score += 40
        else if (cycleRatio >= 1.5) score += 25
        else if (cycleRatio >= 1.2) score += 10

        // Open tickets
        if ((openTickets ?? 0) >= 3) score += 20
        else if ((openTickets ?? 0) >= 1) score += 10

        // Failed payments
        if ((failedPayments ?? 0) >= 2) score += 20
        else if ((failedPayments ?? 0) >= 1) score += 10

        if (score < 30) continue

        const consultantRaw = clinic.consultant as unknown as {
          id: string
          user_id: string | null
        } | null

        results.push({
          clinic_id: clinic.id,
          clinic_name: clinic.trade_name,
          consultant_user_id: consultantRaw?.user_id ?? null,
          avg_cycle_days: Math.round(avgCycle),
          days_since_last_order: daysSinceLast,
          open_tickets: openTickets ?? 0,
          failed_payments: failedPayments ?? 0,
          score,
        })
      }

      return results
    })

    // Persist scores to DB (upsert — keeps contacted_at/notes if already set)
    await step.run('persist-churn-scores', async () => {
      const admin = createAdminClient()
      const now = new Date().toISOString()

      for (const signal of atRisk) {
        const riskLevel: 'HIGH' | 'MODERATE' | 'LOW' =
          signal.score >= 60 ? 'HIGH' : signal.score >= 30 ? 'MODERATE' : 'LOW'

        await admin
          .from('clinic_churn_scores')
          .upsert(
            {
              clinic_id: signal.clinic_id,
              score: signal.score,
              risk_level: riskLevel,
              days_since_last_order: signal.days_since_last_order,
              avg_cycle_days: signal.avg_cycle_days,
              open_tickets: signal.open_tickets,
              failed_payments: signal.failed_payments,
              computed_at: now,
            },
            {
              onConflict: 'clinic_id',
              // Do NOT overwrite contacted_at / contact_notes if already set
              ignoreDuplicates: false,
            }
          )
          // Preserve contacted_at/notes: only update score columns
          .select()
      }
    })

    if (atRisk.length === 0) {
      logger.info('[churn] No at-risk clinics today')
      return { processed: 0 }
    }

    // Notify for each at-risk clinic
    await step.run('send-churn-notifications', async () => {
      for (const signal of atRisk) {
        const riskLabel = signal.score >= 60 ? 'ALTO' : 'MODERADO'
        const message =
          `${signal.clinic_name} — ${signal.days_since_last_order} dias sem pedido ` +
          `(ciclo médio: ${signal.avg_cycle_days} dias). Score de risco: ${signal.score}/100.`

        // Notify consultant (if assigned)
        if (signal.consultant_user_id) {
          await createNotification({
            userId: signal.consultant_user_id,
            type: 'CHURN_RISK',
            title: `⚠️ Risco de churn ${riskLabel}: ${signal.clinic_name}`,
            body: message,
            link: `/churn`,
          })
        }

        // Notify SUPER_ADMIN for high risk
        if (signal.score >= 60) {
          await createNotificationForRole('SUPER_ADMIN', {
            type: 'CHURN_RISK',
            title: `🔴 Churn ${riskLabel}: ${signal.clinic_name}`,
            message,
            link: `/churn`,
          })
        }
      }

      logger.info(`[churn] Notified for ${atRisk.length} at-risk clinics`)
    })

    return { processed: atRisk.length }
  }
)
