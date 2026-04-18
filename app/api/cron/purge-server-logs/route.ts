import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * GET /api/cron/purge-server-logs
 * Weekly cron: delete server_logs entries older than 90 days.
 * Schedule: every Monday at 03:00 UTC (see vercel.json)
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 */
export const GET = withCronGuard('purge-server-logs', async () => {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('server_logs')
    .delete()
    .lt('created_at', cutoff)
    .select('id')

  if (error) {
    logger.error('purge failed', { action: 'purge-server-logs', error })
    throw new Error(`delete failed: ${error.message}`)
  }

  const purged = data?.length ?? 0
  logger.info('purged old logs', { action: 'purge-server-logs', purged, cutoff })

  return { purged, cutoff }
})
