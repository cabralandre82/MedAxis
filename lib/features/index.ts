/**
 * Feature flags — server-side toggles with per-subject targeting, rollout, and
 * kill-switch. Backed by `public.feature_flags` (migration 044).
 *
 * Design:
 *   - `isFeatureEnabled(key, ctx?)` is the only public API used by call sites.
 *   - In-memory cache with TTL avoids hammering the database on hot paths.
 *   - Cache can be invalidated explicitly via `invalidateFeatureFlagCache(key?)`
 *     (called from the admin UI after a flag update).
 *   - When the database is unreachable or returns no row, the flag resolves to
 *     `false` (fail-closed). This is the safest default: new code paths stay
 *     disabled until an operator explicitly turns them on.
 *
 * Evaluation order (first rule that decides wins):
 *   1. If `enabled = false` → return false (kill-switch).
 *   2. If `target_user_ids` contains `ctx.userId` → return true.
 *   3. If `target_clinic_ids` contains `ctx.clinicId` → return true.
 *   4. If `target_pharmacy_ids` contains `ctx.pharmacyId` → return true.
 *   5. If `target_roles` non-empty and does NOT contain `ctx.role` → return false.
 *   6. If `rollout_percent >= 100` → return true.
 *   7. Stable hash(key + subjectId) modulo 100 < rollout_percent → return true.
 *   8. Otherwise → return false.
 *
 * @module lib/features
 */

import 'server-only'
import { createAdminClient } from '@/lib/db/admin'

export type FeatureFlagKey =
  | 'rbac.fine_grained'
  | 'orders.atomic_rpc'
  | 'coupons.atomic_rpc'
  | 'payments.atomic_confirm'
  | 'money.cents_read'
  | 'observability.deep_health'
  | 'security.csrf_enforce'
  | 'security.turnstile_enforce'
  | 'backup.freshness_enforce'
  | 'dsar.sla_enforce'
  | 'legal_hold.block_purge'
  | 'legal_hold.block_dsar_erasure'
  | 'rls_canary.page_on_violation'
  | 'secrets.rotation_enforce'
  | 'secrets.auto_rotate_tier_a'
  // Future waves extend this union. String literal `string & {}` keeps callers
  // type-safe while allowing new keys without churning this file.
  | (string & {})

export interface FeatureFlagContext {
  /** Authenticated user id (auth.users.id). */
  userId?: string | null
  /** Role of the current user. */
  role?: string | null
  /** Clinic the user is acting on behalf of (if any). */
  clinicId?: string | null
  /** Pharmacy the user is acting on behalf of (if any). */
  pharmacyId?: string | null
  /** Explicit subject id overriding default (defaults to userId). */
  subjectId?: string | null
}

interface FeatureFlagRow {
  key: string
  enabled: boolean
  rollout_percent: number
  target_roles: string[] | null
  target_user_ids: string[] | null
  target_clinic_ids: string[] | null
  target_pharmacy_ids: string[] | null
  variants: Record<string, number> | null
}

interface CacheEntry {
  value: FeatureFlagRow | null
  expiresAt: number
}

const DEFAULT_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

function readTtl(): number {
  const override = Number(process.env.FEATURE_FLAG_CACHE_TTL_MS)
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_TTL_MS
}

async function loadFlag(key: string): Promise<FeatureFlagRow | null> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('feature_flags')
      .select(
        'key, enabled, rollout_percent, target_roles, target_user_ids, target_clinic_ids, target_pharmacy_ids, variants'
      )
      .eq('key', key)
      .maybeSingle<FeatureFlagRow>()

    if (error) {
      cache.set(key, { value: null, expiresAt: now + 1_000 })
      return null
    }

    cache.set(key, { value: data ?? null, expiresAt: now + readTtl() })
    return data ?? null
  } catch {
    cache.set(key, { value: null, expiresAt: now + 1_000 })
    return null
  }
}

/**
 * FNV-1a 32-bit hash — tiny, deterministic, non-cryptographic.
 * Used for stable per-subject percentage rollouts.
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash
}

function inAllowlist(list: string[] | null | undefined, value: string | null | undefined): boolean {
  if (!list || list.length === 0) return false
  if (!value) return false
  return list.includes(value)
}

/**
 * Evaluate a single flag for a given context.
 *
 * Pure synchronous logic over a row — exported for tests and for other
 * evaluators (e.g. `getFeatureVariant`) to share the decision tree.
 */
export function evaluateFlag(row: FeatureFlagRow | null, ctx: FeatureFlagContext = {}): boolean {
  if (!row) return false
  if (!row.enabled) return false

  if (inAllowlist(row.target_user_ids, ctx.userId)) return true
  if (inAllowlist(row.target_clinic_ids, ctx.clinicId)) return true
  if (inAllowlist(row.target_pharmacy_ids, ctx.pharmacyId)) return true

  if (row.target_roles && row.target_roles.length > 0) {
    if (!ctx.role || !row.target_roles.includes(ctx.role)) return false
  }

  const rollout = row.rollout_percent
  if (rollout <= 0) return false
  if (rollout >= 100) return true

  const subject = ctx.subjectId ?? ctx.userId ?? ctx.clinicId ?? ctx.pharmacyId
  if (!subject) {
    // No stable subject → fall back to deterministic "flag key only" hash so
    // process-level features still get a consistent verdict.
    return stableHash(row.key) % 100 < rollout
  }

  return stableHash(`${row.key}:${subject}`) % 100 < rollout
}

/**
 * Top-level check: is the flag enabled for this context?
 * Resolves to `false` when the flag is missing, the DB is unreachable, or the
 * kill-switch is off.
 */
export async function isFeatureEnabled(
  key: FeatureFlagKey,
  ctx: FeatureFlagContext = {}
): Promise<boolean> {
  const row = await loadFlag(key)
  return evaluateFlag(row, ctx)
}

/**
 * A/B variant picker. Returns the variant name when the flag is enabled and
 * carries a `variants` payload, else `null`.
 */
export async function getFeatureVariant(
  key: FeatureFlagKey,
  ctx: FeatureFlagContext = {}
): Promise<string | null> {
  const row = await loadFlag(key)
  if (!evaluateFlag(row, ctx)) return null
  if (!row?.variants) return null

  const entries = Object.entries(row.variants).filter(([, weight]) => weight > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) return null

  const subject = ctx.subjectId ?? ctx.userId ?? ctx.clinicId ?? ctx.pharmacyId ?? row.key
  const bucket = stableHash(`${row.key}:variant:${subject}`) % total
  let acc = 0
  for (const [name, weight] of entries) {
    acc += weight
    if (bucket < acc) return name
  }
  return entries[entries.length - 1]?.[0] ?? null
}

/**
 * Invalidate cached value. Pass no argument to clear everything.
 * Called from the admin UI after an update.
 */
export function invalidateFeatureFlagCache(key?: FeatureFlagKey): void {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}

/** Test-only helper to bypass cache and reset state between cases. */
export const _internal = {
  cache,
  readTtl,
  loadFlag,
}
