/**
 * GET /api/chaos/state — read-only inspector for the chaos
 * configuration. Surfaces the parsed env vars so on-call can confirm
 * a game-day is wired the way they expect WITHOUT having to ssh into
 * the runtime or trust local copies of `.env`.
 *
 * Read-only by design: there is intentionally no POST/PUT to flip
 * chaos at runtime. All toggles are env-var driven so they:
 *
 *   • survive a serverless cold-start in a known state;
 *   • cannot be flipped by a compromised admin session;
 *   • leave a clear audit trail in the deploy provider (Vercel env
 *     change events).
 *
 * Authorisation:
 *   • Must be authenticated.
 *   • Caller's roles MUST include `SUPER_ADMIN` or `PLATFORM_ADMIN`.
 *
 * @module app/api/chaos/state/route
 */

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { chaosConfigSnapshot, readChaosConfig } from '@/lib/chaos/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const roles = user.roles ?? []
  const allowed = roles.some((r) => ALLOWED_ROLES.has(r))
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Read fresh on every call — chaos config is cheap to parse and
  // we want the response to reflect reality even if the operator
  // just changed an env var (and the function was warm enough that
  // the cached value would otherwise be stale).
  const config = readChaosConfig()
  return NextResponse.json({
    config: chaosConfigSnapshot(config),
    note:
      'Chaos is configured exclusively via environment variables. ' +
      'See docs/runbooks/chaos.md for the vocabulary and game-day flow.',
  })
}
