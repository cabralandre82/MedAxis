import { enforceRetentionPolicy } from '@/lib/retention-policy'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * GET /api/cron/enforce-retention
 * Monthly cron: enforces data retention policy per LGPD + CTN requirements.
 * Schedule: 1st of each month at 02:00 UTC (see vercel.json)
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 */
export const GET = withCronGuard('enforce-retention', async () => {
  const result = await enforceRetentionPolicy()

  if (result.errors.length > 0) {
    logger.error('partial errors', { action: 'enforce-retention', errors: result.errors })
  }

  return { ran_at: new Date().toISOString(), ...result }
})
