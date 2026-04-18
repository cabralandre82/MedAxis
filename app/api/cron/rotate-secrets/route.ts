/**
 * GET /api/cron/rotate-secrets — Wave 15.
 *
 * Weekly job (Sunday 04:00 BRT) that scans the secret ledger for
 * rotations older than the per-tier threshold and dispatches by
 * tier:
 *
 *   Tier A → auto-rotate via `lib/secrets` (only when feature flag
 *            `secrets.auto_rotate_tier_a` is ON; else queued like B).
 *   Tier B → record "queued for operator", emit warning alert with
 *            the runbook anchor.
 *   Tier C → record "requires operator", emit warning OR critical
 *            depending on `secrets.rotation_enforce`.
 *
 * Also paged: any unexpected error during the scan, and any failed
 * rotation attempt (Vercel API / SQL / etc).
 *
 * Idempotent: cron-guard ensures only one instance runs at a time;
 * if Vercel retries, the second invocation skips with 'lock-busy'.
 *
 * Schedule: `0 4 * * 0` in `vercel.json` (UTC = 01:00 BRT Sunday —
 * lowest user activity, longest gap before next backup).
 */

import { withCronGuard } from '@/lib/cron/guarded'
import { logger } from '@/lib/logger'
import { triggerAlert } from '@/lib/alerts'
import { isFeatureEnabled } from '@/lib/features'
import { rotateAllOverdue } from '@/lib/secrets'
import { incCounter, Metrics } from '@/lib/metrics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Tier A rotation chains: Vercel env PATCH (~1s) + redeploy trigger
// (~2s). Worst case 19 secrets × 1s = 19s plus a 2s redeploy. We
// give it 60s of headroom.
export const maxDuration = 60

export const GET = withCronGuard('rotate-secrets', async () => {
  let summary
  try {
    summary = await rotateAllOverdue({})
  } catch (err) {
    // The orchestrator handles individual rotation failures itself
    // and records them in the ledger. Reaching this catch means
    // something earlier broke (DB unreachable, RPC missing). Treat
    // as a hard misconfiguration so the on-call notices.
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[cron/rotate-secrets] orchestrator failed to start', {
      module: 'cron/rotate-secrets',
      error: message,
    })
    incCounter(Metrics.SECRET_ROTATION_FAILURES_TOTAL, {
      tier: 'cron',
      reason: 'orchestrator_failure',
    })
    await triggerAlert({
      severity: 'critical',
      title: 'Secret rotation cron did not run',
      message:
        `Wave 15 secret rotation cron failed to start: ${message}. ` +
        `See docs/runbooks/secret-compromise.md.`,
      dedupKey: 'secrets:cron:misconfigured',
      component: 'cron/rotate-secrets',
      customDetails: { error: message },
    }).catch(() => {})
    return { status: 'misconfigured', error: message }
  }

  // Happy path: nothing overdue, no rotations attempted.
  if (summary.results.length === 0) {
    logger.info('[cron/rotate-secrets] no secrets overdue', {
      module: 'cron/rotate-secrets',
      scanned: summary.scanned,
      duration_ms: summary.durationMs,
    })
    return {
      scanned: summary.scanned,
      overdue: 0,
      duration_ms: summary.durationMs,
    }
  }

  // Summarise outcomes.
  const counts = {
    rotated: 0,
    queued: 0,
    requiresOperator: 0,
    failed: 0,
    skipped: 0,
  }
  for (const r of summary.results) {
    if (r.outcome === 'rotated') counts.rotated += 1
    else if (r.outcome === 'queued-for-operator') counts.queued += 1
    else if (r.outcome === 'requires-operator') counts.requiresOperator += 1
    else if (r.outcome === 'failed') counts.failed += 1
    else if (r.outcome === 'skipped-misconfigured') counts.skipped += 1
  }

  const enforce = await isFeatureEnabled('secrets.rotation_enforce').catch(() => false)
  const severity: 'critical' | 'warning' | 'error' =
    counts.failed > 0
      ? 'critical' // rotation that should have worked, didn't
      : counts.requiresOperator > 0 && enforce
        ? 'critical'
        : 'warning'

  const operatorList = summary.results
    .filter(
      (r) =>
        r.outcome === 'queued-for-operator' ||
        r.outcome === 'requires-operator' ||
        r.outcome === 'failed'
    )
    .slice(0, 30)
    .map(
      (r) =>
        `- ${r.secret} [${r.tier}] → ${r.outcome}` +
        (r.errorMessage ? ` (${r.errorMessage.slice(0, 200)})` : '')
    )
    .join('\n')

  logger.error('[cron/rotate-secrets] rotation pass summary', {
    module: 'cron/rotate-secrets',
    severity,
    enforce,
    duration_ms: summary.durationMs,
    overdue_total: summary.results.length,
    overdue_by_tier: summary.overdueByTier,
    counts,
    redeploy_triggered: summary.redeployTriggered,
    redeploy_id: summary.redeployId,
  })

  await triggerAlert({
    severity,
    title:
      counts.failed > 0
        ? `Secret rotation: ${counts.failed} failed, ${summary.results.length - counts.failed} processed`
        : `Secret rotation: ${summary.results.length} secret(s) need attention`,
    message:
      `Weekly rotation pass found ${summary.results.length} overdue secret(s). ` +
      `See docs/runbooks/secret-compromise.md.\n\n${operatorList}`,
    dedupKey: 'secrets:rotation:overdue',
    component: 'cron/rotate-secrets',
    customDetails: {
      enforce,
      counts,
      overdue_by_tier: summary.overdueByTier,
      redeploy_triggered: summary.redeployTriggered,
      redeploy_id: summary.redeployId,
    },
  }).catch((err) => {
    logger.error('[cron/rotate-secrets] alert dispatch failed', {
      module: 'cron/rotate-secrets',
      error: (err as Error).message,
    })
  })

  return {
    scanned: summary.scanned,
    overdue: summary.results.length,
    counts,
    overdue_by_tier: summary.overdueByTier,
    duration_ms: summary.durationMs,
    severity,
    enforce,
    redeploy_triggered: summary.redeployTriggered,
    redeploy_id: summary.redeployId,
  }
})
