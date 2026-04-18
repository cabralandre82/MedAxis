/**
 * GET /api/cron/rls-canary — Wave 14.
 *
 * Daily proof that an unaffiliated authenticated user cannot read
 * any row of any tenant-scoped table. Reads `lib/rls-canary` for
 * the orchestration. Two distinct outcomes:
 *
 *   - 0 violations  → log info, emit metrics, return early.
 *   - ≥1 violation → log error, page on-call (severity depends on
 *                     the `rls_canary.page_on_violation` flag).
 *
 * The canary itself runs against PRODUCTION — there is no other
 * place where the policy graph being audited actually lives. We
 * deliberately do not seed any data: the assertion is "stranger
 * sees zero rows", which is true for any UUID not bound to a
 * membership table.
 *
 * Schedule: `40 7 * * *` in `vercel.json` (UTC = 04:40 BRT — quiet
 * hours, runs after the daily backup but before business start).
 */

import { withCronGuard } from '@/lib/cron/guarded'
import { runCanary } from '@/lib/rls-canary'
import { isFeatureEnabled } from '@/lib/features'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export const GET = withCronGuard('rls-canary', async () => {
  let run
  try {
    run = await runCanary()
  } catch (err) {
    // runCanary handles RPC errors internally; this catches missing
    // env vars (SUPABASE_JWT_SECRET) at boot time. Treat as a hard
    // breach so the operator notices the misconfiguration.
    logger.error('[cron/rls-canary] canary failed to start', {
      module: 'cron/rls-canary',
      error: (err as Error).message,
    })
    try {
      const { triggerAlert } = await import('@/lib/alerts')
      await triggerAlert({
        severity: 'critical',
        title: 'RLS canary did not run',
        message:
          `RLS canary failed to start: ${(err as Error).message}. ` +
          `See docs/runbooks/rls-violation.md.`,
        dedupKey: 'rls-canary:misconfigured',
        component: 'cron/rls-canary',
      })
    } catch {
      // alert dispatch failure is logged by alerts module
    }
    return { status: 'misconfigured', error: (err as Error).message }
  }

  if (run.violations === 0) {
    logger.info('[cron/rls-canary] all tables sealed', {
      module: 'cron/rls-canary',
      tables: run.tablesChecked,
      duration_ms: run.durationMs,
    })
    return {
      tables_checked: run.tablesChecked,
      violations: 0,
      duration_ms: run.durationMs,
    }
  }

  // Violations exist. Decide severity based on the rollout flag.
  const enforce = await isFeatureEnabled('rls_canary.page_on_violation', {}).catch(() => false)
  const severity: 'critical' | 'warning' = enforce ? 'critical' : 'warning'

  const violatingSummary = run.assertions
    .filter((a) => a.violated)
    .slice(0, 20)
    .map(
      (a) =>
        `- ${a.table_name} (${a.bucket}): visible=${a.visible_rows}` +
        (a.error_message ? ` err="${a.error_message}"` : '')
    )
    .join('\n')

  logger.error('[cron/rls-canary] RLS VIOLATIONS DETECTED', {
    module: 'cron/rls-canary',
    severity,
    violations: run.violations,
    tables: run.tablesChecked,
    duration_ms: run.durationMs,
  })

  try {
    const { triggerAlert } = await import('@/lib/alerts')
    await triggerAlert({
      severity,
      title: `RLS canary detected ${run.violations} violation(s)`,
      message:
        `An unaffiliated user could read rows from tenant-scoped ` +
        `tables. See docs/runbooks/rls-violation.md.\n\n` +
        violatingSummary,
      dedupKey: 'rls:canary:violation',
      component: 'cron/rls-canary',
      customDetails: {
        enforce,
        subject: run.subject,
        violations: run.violations,
        tables_checked: run.tablesChecked,
      },
    })
  } catch (err) {
    logger.error('[cron/rls-canary] alert dispatch failed', {
      module: 'cron/rls-canary',
      error: (err as Error).message,
    })
  }

  return {
    tables_checked: run.tablesChecked,
    violations: run.violations,
    duration_ms: run.durationMs,
    severity,
    enforce,
  }
})
