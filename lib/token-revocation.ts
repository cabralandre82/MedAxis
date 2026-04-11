import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'

/**
 * Token revocation blacklist.
 *
 * Supabase JWTs carry a `jti` (JWT ID) claim — a unique identifier per token.
 * When a user is deactivated or their role changes, all their active tokens
 * are added here. The middleware checks this table on every authenticated request.
 *
 * The table is purged daily by /api/cron/purge-revoked-tokens.
 */

/** Add a single token to the blacklist. */
export async function revokeToken(jti: string, userId: string, expiresAt: Date): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('revoked_tokens')
    .upsert({ jti, user_id: userId, expires_at: expiresAt.toISOString() }, { onConflict: 'jti' })
  if (error) logger.error('[revokeToken] failed to insert blacklist entry', { jti, userId, error })
}

/**
 * Revoke ALL active Supabase sessions for a user.
 * Supabase does not expose individual JTIs via admin API, so we use
 * `signOut` with scope 'global' which invalidates all refresh tokens,
 * AND insert a sentinel row so the middleware can reject in-flight access tokens.
 *
 * The sentinel uses a special jti pattern: `user:{userId}:all`
 * The middleware checks both: individual jti AND the user-level sentinel.
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const admin = createAdminClient()

  // Invalidate all Supabase refresh tokens (server-side)
  await admin.auth.admin.signOut(userId, 'global').catch(() => {
    // Non-fatal: user may already be logged out
  })

  // Insert sentinel so middleware rejects any in-flight access tokens
  // Sentinel expires in 2 hours (max Supabase access token TTL)
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const { error: sentinelErr } = await admin
    .from('revoked_tokens')
    .upsert(
      { jti: `user:${userId}:all`, user_id: userId, expires_at: expiresAt.toISOString() },
      { onConflict: 'jti' }
    )
  if (sentinelErr)
    logger.error('[revokeAllUserTokens] failed to insert sentinel', { userId, error: sentinelErr })
}

/**
 * Check if a token is revoked.
 * Returns true if:
 *  - The specific jti is in the blacklist, OR
 *  - A user-level sentinel (`user:{userId}:all`) exists and is not expired
 */
export async function isTokenRevoked(jti: string, userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data } = await admin
      .from('revoked_tokens')
      .select('jti')
      .or(`jti.eq.${jti},jti.eq.user:${userId}:all`)
      .gt('expires_at', now)
      .limit(1)

    return (data?.length ?? 0) > 0
  } catch {
    // Fail open — if blacklist check fails, don't block legitimate users
    return false
  }
}

/** Delete expired rows — called by daily cron. */
export async function purgeExpiredTokens(): Promise<{ deleted: number }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('revoked_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('jti')

  if (error) throw new Error(`purgeExpiredTokens failed: ${error.message}`)
  return { deleted: data?.length ?? 0 }
}
