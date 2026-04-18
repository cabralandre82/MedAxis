import { createAdminClient } from '@/lib/db/admin'
import { validateCNPJ } from '@/lib/compliance'
import { createNotificationForRole } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * Weekly cron: re-validates CNPJ of all active pharmacies.
 * Pharmacies with inactive CNPJs are suspended and admins are notified.
 *
 * Vercel cron: every Monday at 06:00 UTC (configured in vercel.json).
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 * Generous TTL (1800s) because this job is I/O-bound with 25s rate-limit
 * sleeps between ReceitaWS calls.
 */
export const GET = withCronGuard(
  'revalidate-pharmacies',
  async () => {
    const admin = createAdminClient()

    // Fetch all active pharmacies that haven't been validated in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: pharmacies, error } = await admin
      .from('pharmacies')
      .select('id, trade_name, cnpj, cnpj_situation')
      .eq('status', 'ACTIVE')
      .not('cnpj', 'is', null)
      .or(`cnpj_validated_at.is.null,cnpj_validated_at.lt.${sevenDaysAgo}`)

    if (error) {
      logger.error('fetch error', { action: 'revalidate-pharmacies', error })
      throw new Error(`pharmacies query failed: ${error.message}`)
    }

    const results = { checked: 0, suspended: 0, errors: 0 }

    for (const pharmacy of pharmacies ?? []) {
      if (!pharmacy.cnpj) continue

      try {
        const result = await validateCNPJ(pharmacy.cnpj)

        await admin
          .from('pharmacies')
          .update({
            cnpj_validated_at: new Date().toISOString(),
            cnpj_situation: result.situation ?? 'UNKNOWN',
          })
          .eq('id', pharmacy.id)

        results.checked++

        // If CNPJ is now inactive and it wasn't already flagged, suspend and notify
        const wasActive = !pharmacy.cnpj_situation || pharmacy.cnpj_situation === 'ATIVA'
        const isNowInactive =
          !result.valid && result.error !== 'rate_limited' && result.error !== 'timeout'

        if (wasActive && isNowInactive) {
          await admin.from('pharmacies').update({ status: 'SUSPENDED' }).eq('id', pharmacy.id)

          await createNotificationForRole('SUPER_ADMIN', {
            type: 'GENERIC',
            title: `⚠️ Farmácia suspensa — CNPJ irregular`,
            message: `${pharmacy.trade_name}: CNPJ ${pharmacy.cnpj} com situação "${result.situation}" na Receita Federal. Farmácia suspensa automaticamente.`,
            link: `/pharmacies/${pharmacy.id}`,
          })

          logger.warn('Suspended pharmacy — CNPJ irregular', {
            action: 'revalidate-pharmacies',
            entityType: 'PHARMACY',
            entityId: pharmacy.id,
            situation: result.situation,
          })

          results.suspended++
        }

        // Rate limit: 3 req/min to ReceitaWS — wait 25s between each call
        await new Promise((r) => setTimeout(r, 25_000))
      } catch (err) {
        logger.error('Error validating pharmacy', {
          action: 'revalidate-pharmacies',
          entityType: 'PHARMACY',
          entityId: pharmacy.id,
          error: err,
        })
        results.errors++
      }
    }

    return results
  },
  { ttlSeconds: 1800 }
)
