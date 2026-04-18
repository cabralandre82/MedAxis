import { purgeExpiredTokens } from '@/lib/token-revocation'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * Daily cron: removes expired rows from revoked_tokens.
 * Vercel cron schedule: every day at 03:00 UTC (configured in vercel.json).
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 */
export const GET = withCronGuard('purge-revoked-tokens', async () => {
  const { deleted } = await purgeExpiredTokens()
  return { deleted }
})
