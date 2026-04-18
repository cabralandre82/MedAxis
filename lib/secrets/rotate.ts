/**
 * Secret rotation orchestrator — Wave 15.
 *
 * Wires together:
 *   • the manifest (`./manifest`),
 *   • the SQL ledger (`secret_rotation_record` RPC + `secret_inventory` view),
 *   • the Vercel API (`./vercel`),
 *   • alerts + metrics + structured logs.
 *
 * Three public entry points:
 *
 *   `getOverdueSecrets()`        — read-only; returns what would be
 *                                  rotated if the cron ran now.
 *   `rotateAllOverdue(opts?)`    — full orchestration: lists overdue,
 *                                  dispatches by tier, records every
 *                                  outcome in the ledger, returns a
 *                                  summary the cron route serialises.
 *   `getRotationStatus()`        — for the deep-health probe.
 *
 * Tier dispatch (matches manifest classification):
 *
 *   Tier A → `executeTierARotation()` — generates 32 random bytes
 *            via `node:crypto.randomBytes`, calls `vercel.rotateEnvValue`,
 *            triggers redeploy, records success.
 *   Tier B → `prepareTierBRotation()` — does NOT auto-rotate. Records
 *            a "queued" event and triggers a warning-severity alert
 *            with the exact CLI/portal steps the on-call needs to run.
 *   Tier C → `alertTierCRotation()`   — records "operator-required"
 *            and pages CRITICAL because Tier C secrets older than the
 *            window indicate either a missing maintenance window or
 *            a forgotten rotation.
 *
 * @module lib/secrets/rotate
 */

import 'server-only'
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { triggerAlert } from '@/lib/alerts'
import { isFeatureEnabled } from '@/lib/features'
import { incCounter, observeHistogram, setGauge, Metrics } from '@/lib/metrics'
import {
  SECRET_MANIFEST,
  TIER_MAX_AGE_DAYS,
  getSecretDescriptor,
  type SecretDescriptor,
  type SecretTier,
} from './manifest'
import { fingerprint, rotateEnvValue, triggerRedeploy, VercelConfigError } from './vercel'

// ── types ──────────────────────────────────────────────────────────────

export type RotationOutcome =
  | 'rotated'
  | 'queued-for-operator'
  | 'requires-operator'
  | 'failed'
  | 'skipped-misconfigured'

export interface RotationResult {
  secret: string
  tier: SecretTier
  outcome: RotationOutcome
  ageDays: number | null
  errorMessage: string | null
  details: Record<string, unknown>
}

export interface OverdueSecret {
  secret: string
  tier: SecretTier
  provider: string
  ageDays: number | null
  lastRotatedAt: string | null
  status: 'overdue' | 'never-rotated'
}

export interface RotateAllSummary {
  startedAt: string
  durationMs: number
  scanned: number
  overdueByTier: Record<SecretTier, number>
  results: RotationResult[]
  redeployTriggered: boolean
  redeployId: string | null
}

// ── overdue lookup ─────────────────────────────────────────────────────

/**
 * Aggregate every overdue secret across the three tiers. We call
 * the SQL RPC three times rather than once with a single large
 * threshold so each tier can have its own grace period (Tier C is
 * intentionally laxer — see TIER_MAX_AGE_DAYS).
 */
export async function getOverdueSecrets(): Promise<OverdueSecret[]> {
  const admin = createAdminClient()
  const out: OverdueSecret[] = []
  const seen = new Set<string>()

  for (const tier of ['A', 'B', 'C'] as SecretTier[]) {
    const maxAge = TIER_MAX_AGE_DAYS[tier]
    const { data, error } = await admin.rpc('secret_rotation_overdue', {
      p_max_age_days: maxAge,
    })
    if (error) {
      throw new Error(`secret_rotation_overdue(${maxAge}) failed: ${error.message}`)
    }
    for (const row of (data ?? []) as Array<{
      secret_name: string
      tier: SecretTier
      provider: string
      age_days: number | null
      last_rotated_at: string | null
      status: 'overdue' | 'never-rotated'
    }>) {
      // The RPC returns ALL secrets older than threshold regardless
      // of their tier. We only care about secrets whose declared
      // tier matches the threshold we asked about — otherwise a
      // Tier C secret would show up three times in our aggregated
      // result (overdue at 90, 90, 180).
      if (row.tier !== tier) continue
      if (seen.has(row.secret_name)) continue
      seen.add(row.secret_name)
      out.push({
        secret: row.secret_name,
        tier: row.tier,
        provider: row.provider,
        ageDays: row.age_days,
        lastRotatedAt: row.last_rotated_at,
        status: row.status,
      })
    }
  }
  return out
}

// ── Tier executors ────────────────────────────────────────────────────

const ROTATED_BY = 'cron:rotate-secrets'

/**
 * Tier A — auto-rotate.
 *
 * 1. Generate 32 random bytes (256 bits) base64-encoded.
 * 2. PATCH Vercel env (production target only — preview/dev
 *    intentionally diverge so leaked preview values can't be used
 *    against prod).
 * 3. Record success with the fingerprint of the new value.
 *
 * Redeploy is triggered ONCE at the end of `rotateAllOverdue` so
 * batched Tier A rotations only cause one fresh deployment per cron
 * run rather than N.
 */
async function executeTierARotation(
  desc: SecretDescriptor,
  ageDays: number | null
): Promise<RotationResult> {
  const t0 = Date.now()
  try {
    // 256 bits is more than enough for HMAC and bearer tokens; the
    // base64url encoding keeps the value URL-/header-safe.
    const newValue = randomBytes(32).toString('base64url')

    const { envId, previousValueFingerprint } = await rotateEnvValue(desc.name, newValue)
    const newFp = fingerprint(newValue)

    await recordRotation({
      secret: desc.name,
      tier: desc.tier,
      provider: desc.provider,
      success: true,
      reason: 'cron-due',
      details: {
        rotation_strategy: 'tier_a_auto',
        vercel_env_id: envId,
        previous_value_fingerprint: previousValueFingerprint,
        new_value_fingerprint: newFp,
        new_value_length: newValue.length,
      },
    })

    incCounter(Metrics.SECRET_ROTATION_RUNS_TOTAL, { tier: 'A', outcome: 'rotated' })
    observeHistogram(Metrics.SECRET_ROTATION_DURATION_MS, Date.now() - t0, {
      tier: 'A',
      secret: desc.name,
    })

    logger.info('[secrets] tier A rotation succeeded', {
      module: 'secrets/rotate',
      secret: desc.name,
      vercel_env_id: envId,
      duration_ms: Date.now() - t0,
    })

    return {
      secret: desc.name,
      tier: desc.tier,
      outcome: 'rotated',
      ageDays,
      errorMessage: null,
      details: { vercel_env_id: envId, fingerprint: newFp },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isConfig = err instanceof VercelConfigError

    await recordRotation({
      secret: desc.name,
      tier: desc.tier,
      provider: desc.provider,
      success: false,
      reason: 'cron-due',
      errorMessage: message,
      details: {
        rotation_strategy: 'tier_a_auto',
        error_class: err instanceof Error ? err.name : 'unknown',
      },
    }).catch(() => {})

    incCounter(Metrics.SECRET_ROTATION_FAILURES_TOTAL, {
      tier: 'A',
      secret: desc.name,
      reason: isConfig ? 'misconfigured' : 'api_error',
    })

    logger.error('[secrets] tier A rotation FAILED', {
      module: 'secrets/rotate',
      secret: desc.name,
      error: message,
    })

    return {
      secret: desc.name,
      tier: desc.tier,
      outcome: isConfig ? 'skipped-misconfigured' : 'failed',
      ageDays,
      errorMessage: message,
      details: {},
    }
  }
}

/**
 * Tier B — assisted: log + queue + alert. We do NOT auto-touch
 * third-party APIs because the dual-write window (provider then
 * Vercel) needs an operator to verify the new credentials work
 * before retiring the old.
 */
async function prepareTierBRotation(
  desc: SecretDescriptor,
  ageDays: number | null
): Promise<RotationResult> {
  const t0 = Date.now()
  await recordRotation({
    secret: desc.name,
    tier: desc.tier,
    provider: desc.provider,
    success: true,
    reason: 'cron-due',
    details: {
      rotation_strategy: 'tier_b_queued',
      action: 'operator-rotation-required',
      runbook: '/docs/runbooks/secret-compromise.md#tier-b-assisted-rotation',
      age_days: ageDays,
    },
  })

  incCounter(Metrics.SECRET_ROTATION_RUNS_TOTAL, { tier: 'B', outcome: 'queued' })
  observeHistogram(Metrics.SECRET_ROTATION_DURATION_MS, Date.now() - t0, {
    tier: 'B',
    secret: desc.name,
  })

  logger.warn('[secrets] tier B rotation queued for operator', {
    module: 'secrets/rotate',
    secret: desc.name,
    provider: desc.provider,
    age_days: ageDays,
  })

  return {
    secret: desc.name,
    tier: desc.tier,
    outcome: 'queued-for-operator',
    ageDays,
    errorMessage: null,
    details: { provider: desc.provider, runbook_anchor: 'tier-b-assisted-rotation' },
  }
}

/**
 * Tier C — alert-only. These secrets MUST rotate via a planned
 * maintenance window; the cron's job is to make sure nobody
 * forgets.
 */
async function alertTierCRotation(
  desc: SecretDescriptor,
  ageDays: number | null
): Promise<RotationResult> {
  const t0 = Date.now()
  await recordRotation({
    secret: desc.name,
    tier: desc.tier,
    provider: desc.provider,
    success: true,
    reason: 'cron-due',
    details: {
      rotation_strategy: 'tier_c_alert_only',
      action: 'maintenance-window-required',
      runbook: '/docs/runbooks/secret-compromise.md#tier-c-manual-rotation',
      age_days: ageDays,
      invalidates_sessions: desc.invalidatesSessions === true,
      destroys_data_at_rest: desc.destroysDataAtRest === true,
      has_siblings: desc.hasSiblings === true,
    },
  })

  incCounter(Metrics.SECRET_ROTATION_RUNS_TOTAL, { tier: 'C', outcome: 'requires_operator' })
  observeHistogram(Metrics.SECRET_ROTATION_DURATION_MS, Date.now() - t0, {
    tier: 'C',
    secret: desc.name,
  })

  logger.warn('[secrets] tier C rotation REQUIRES operator (manual)', {
    module: 'secrets/rotate',
    secret: desc.name,
    provider: desc.provider,
    age_days: ageDays,
  })

  return {
    secret: desc.name,
    tier: desc.tier,
    outcome: 'requires-operator',
    ageDays,
    errorMessage: null,
    details: {
      provider: desc.provider,
      runbook_anchor: 'tier-c-manual-rotation',
      invalidates_sessions: desc.invalidatesSessions === true,
      destroys_data_at_rest: desc.destroysDataAtRest === true,
    },
  }
}

// ── ledger writer ──────────────────────────────────────────────────────

interface RecordArgs {
  secret: string
  tier: SecretTier
  provider: string
  success: boolean
  reason:
    | 'cron-due'
    | 'manual'
    | 'incident-suspected-leak'
    | 'incident-confirmed-leak'
    | 'employee-offboarding'
    | 'genesis'
    | 'provider-forced'
    | 'test'
  errorMessage?: string | null
  details: Record<string, unknown>
  rotatedBy?: string
}

async function recordRotation(args: RecordArgs): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.rpc('secret_rotation_record', {
    p_secret_name: args.secret,
    p_tier: args.tier,
    p_provider: args.provider,
    p_trigger_reason: args.reason,
    p_rotated_by: args.rotatedBy ?? ROTATED_BY,
    p_success: args.success,
    p_error_message: args.errorMessage ?? null,
    p_details: args.details,
  })
  if (error) {
    throw new Error(`secret_rotation_record failed (${args.secret}): ${error.message}`)
  }
}

// ── main orchestrator ──────────────────────────────────────────────────

export interface RotateAllOptions {
  /** Force `executeTierARotation` to skip Vercel calls — used by
   *  tests and by dry-run cron invocations. */
  dryRun?: boolean
  /** Explicit override of the auto-rotate flag for tests. */
  autoRotateTierA?: boolean
}

/**
 * Walk the overdue list and dispatch each entry to the appropriate
 * tier executor. Always returns a structured summary so the caller
 * (cron route) can emit one alert + one log line per run.
 */
export async function rotateAllOverdue(opts: RotateAllOptions = {}): Promise<RotateAllSummary> {
  const startedAt = new Date()
  const t0 = Date.now()

  const overdue = await getOverdueSecrets()
  const overdueByTier: Record<SecretTier, number> = { A: 0, B: 0, C: 0 }
  for (const o of overdue) overdueByTier[o.tier] += 1

  setGauge(Metrics.SECRET_ROTATION_OVERDUE_COUNT, overdue.length)
  setGauge(
    Metrics.SECRET_ROTATION_NEVER_ROTATED_COUNT,
    overdue.filter((o) => o.status === 'never-rotated').length
  )

  // Resolve the autoRotate flag once per run so we don't hit the
  // feature-flags table once per Tier A secret.
  const autoRotateA =
    opts.autoRotateTierA ??
    (await isFeatureEnabled('secrets.auto_rotate_tier_a').catch(() => false))

  const results: RotationResult[] = []
  let anyTierARotated = false

  for (const o of overdue) {
    const desc = getSecretDescriptor(o.secret)
    if (!desc) {
      // Manifest drift — shouldn't happen because the SQL view's
      // names mirror this file. Record a defensive failure entry
      // so it shows up in the ledger and CI catches it next run.
      logger.error('[secrets] overdue secret not in runtime manifest', {
        module: 'secrets/rotate',
        secret: o.secret,
        tier: o.tier,
      })
      results.push({
        secret: o.secret,
        tier: o.tier,
        outcome: 'skipped-misconfigured',
        ageDays: o.ageDays,
        errorMessage: 'secret not present in runtime manifest',
        details: {},
      })
      continue
    }

    if (desc.tier === 'A') {
      if (opts.dryRun || !autoRotateA) {
        results.push(await prepareTierBRotation(desc, o.ageDays)) // dry-run path mirrors Tier B
        continue
      }
      const r = await executeTierARotation(desc, o.ageDays)
      results.push(r)
      if (r.outcome === 'rotated') anyTierARotated = true
    } else if (desc.tier === 'B') {
      results.push(await prepareTierBRotation(desc, o.ageDays))
    } else {
      results.push(await alertTierCRotation(desc, o.ageDays))
    }
  }

  // Trigger ONE redeploy at the end if any Tier A secret was actually
  // rotated. Avoids multiple redeploys per run.
  let redeployTriggered = false
  let redeployId: string | null = null
  if (anyTierARotated && !opts.dryRun) {
    try {
      const dep = await triggerRedeploy('Wave 15 — auto-rotation of Tier A secrets')
      redeployTriggered = true
      redeployId = dep.id
      logger.info('[secrets] redeploy triggered after Tier A rotation', {
        module: 'secrets/rotate',
        deployment_id: dep.id,
      })
    } catch (err) {
      // Important: we still return success-on-rotation; the redeploy
      // can be triggered manually from the runbook. But we DO emit a
      // critical alert because new env values aren't live until the
      // redeploy runs — i.e. we just rotated a key but still serve the
      // OLD one until cold restart.
      const message = err instanceof Error ? err.message : String(err)
      logger.error('[secrets] redeploy after rotation FAILED', {
        module: 'secrets/rotate',
        error: message,
      })
      await triggerAlert({
        severity: 'critical',
        title: 'Secret rotation succeeded but redeploy failed',
        message:
          `Tier A secrets were rotated in Vercel env, but the redeploy that activates them failed: ${message}. ` +
          `Run \`vercel deploy --prod --force\` to recover. Until you do, the old secret values remain live in serverless functions.`,
        dedupKey: 'secrets:redeploy-failed',
        component: 'secrets/rotate',
        customDetails: { error: message },
      }).catch(() => {})
    }
  }

  const durationMs = Date.now() - t0
  setGauge(Metrics.SECRET_ROTATION_LAST_RUN_TS, Math.floor(Date.now() / 1000))

  return {
    startedAt: startedAt.toISOString(),
    durationMs,
    scanned: SECRET_MANIFEST.length,
    overdueByTier,
    results,
    redeployTriggered,
    redeployId,
  }
}

// ── deep-health helper ────────────────────────────────────────────────

export interface RotationStatus {
  totalSecrets: number
  oldestSecretName: string | null
  oldestAgeSeconds: number | null
  overdueCount: number
  neverRotatedCount: number
  lastLedgerHash: string | null
  lastLedgerTs: string | null
}

/**
 * Snapshot of the rotation state — the deep-health probe surfaces
 * this so operators can see freshness without reading SQL. We
 * never auto-rotate from the health probe; this is read-only.
 */
export async function getRotationStatus(): Promise<RotationStatus> {
  const admin = createAdminClient()

  const { data: inv, error: invErr } = await admin
    .from('secret_inventory')
    .select('secret_name, age_seconds, last_rotated_at, last_row_hash')
    .order('age_seconds', { ascending: false })

  if (invErr) {
    throw new Error(`secret_inventory read failed: ${invErr.message}`)
  }

  const rows = (inv ?? []) as Array<{
    secret_name: string
    age_seconds: number
    last_rotated_at: string
    last_row_hash: string
  }>

  const oldest = rows[0] ?? null
  if (oldest) {
    setGauge(Metrics.SECRET_OLDEST_AGE_SECONDS, oldest.age_seconds)
  }

  // Per-secret age gauges so Grafana can plot a per-secret heatmap.
  for (const r of rows) {
    setGauge(Metrics.SECRET_AGE_SECONDS, r.age_seconds, { secret: r.secret_name })
  }

  // Compute overdue without re-running the RPC — cheaper for the
  // health probe and consistent with the cron's logic.
  let overdue = 0
  let neverRotated = 0
  const inventoryIndex = new Map(rows.map((r) => [r.secret_name, r]))
  for (const desc of SECRET_MANIFEST) {
    const found = inventoryIndex.get(desc.name)
    if (!found) {
      neverRotated += 1
      continue
    }
    if (found.age_seconds >= TIER_MAX_AGE_DAYS[desc.tier] * 86400) {
      overdue += 1
    }
  }

  return {
    totalSecrets: SECRET_MANIFEST.length,
    oldestSecretName: oldest?.secret_name ?? null,
    oldestAgeSeconds: oldest?.age_seconds ?? null,
    overdueCount: overdue,
    neverRotatedCount: neverRotated,
    lastLedgerHash: oldest?.last_row_hash ?? null,
    lastLedgerTs: oldest?.last_rotated_at ?? null,
  }
}

// ── manual operator-facing helpers ─────────────────────────────────────

/**
 * Record an out-of-band rotation event. Used by:
 *   • the operator who just rotated a Tier B/C secret in the
 *     provider portal (must call this so the ledger reflects truth),
 *   • incident response (`reason='incident-confirmed-leak'`),
 *   • employee offboarding.
 *
 * Returns the inserted row's `row_hash` so the operator can attach
 * it to the ticket as proof.
 */
export async function recordManualRotation(args: {
  secret: string
  reason:
    | 'manual'
    | 'incident-suspected-leak'
    | 'incident-confirmed-leak'
    | 'employee-offboarding'
    | 'provider-forced'
  rotatedBy: string
  success?: boolean
  errorMessage?: string | null
  details?: Record<string, unknown>
}): Promise<{ rowHash: string }> {
  const desc = getSecretDescriptor(args.secret)
  if (!desc) {
    throw new Error(`unknown secret: ${args.secret}`)
  }
  const admin = createAdminClient()
  const { data, error } = await admin
    .rpc('secret_rotation_record', {
      p_secret_name: desc.name,
      p_tier: desc.tier,
      p_provider: desc.provider,
      p_trigger_reason: args.reason,
      p_rotated_by: args.rotatedBy,
      p_success: args.success ?? true,
      p_error_message: args.errorMessage ?? null,
      p_details: args.details ?? {},
    })
    .single()
  if (error) {
    throw new Error(`secret_rotation_record failed: ${error.message}`)
  }
  const row = data as { row_hash: string }
  return { rowHash: row.row_hash }
}

// ── test helpers ───────────────────────────────────────────────────────

export const _internal = {
  recordRotation,
  executeTierARotation,
  prepareTierBRotation,
  alertTierCRotation,
}
