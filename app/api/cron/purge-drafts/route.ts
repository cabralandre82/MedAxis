import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * GET /api/cron/purge-drafts
 * Daily cron: remove registration drafts past their expiration date.
 * Schedule: every day at 03:30 UTC (see vercel.json)
 *
 * Drafts are anonymous (no auth user created) so deletion is safe and
 * requires no cascade cleanup.
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 */
export const GET = withCronGuard('purge-drafts', async () => {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('registration_drafts')
    .delete()
    .lt('expires_at', now)
    .select('id')

  if (error) {
    logger.error('failed to delete expired drafts', { action: 'purge-drafts', error })
    throw new Error(`delete failed: ${error.message}`)
  }

  const purged = data?.length ?? 0
  logger.info('purged expired drafts', { action: 'purge-drafts', purged, ran_at: now })

  return { ran_at: now, purged }
})
