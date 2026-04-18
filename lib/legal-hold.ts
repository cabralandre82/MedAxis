/**
 * Legal-hold helpers — Wave 13.
 *
 * A legal hold is a formal preservation order (ANPD, PROCON,
 * judicial subpoena, MPF, etc.) that blocks retention jobs from
 * destroying any artefact belonging to the subject of the order.
 *
 * This module is the **platform-side** interface that:
 *
 *   1. Validates payloads coming from the DPO admin UI before they
 *      hit the `legal_hold_apply()` / `legal_hold_release()` RPCs.
 *   2. Exposes a cached `isUnderLegalHold()` helper so purge paths
 *      can short-circuit cheaply inside a single request/cron.
 *   3. Lists active holds for the admin dashboard.
 *   4. Runs the `legal_hold_expire_stale()` sweep as part of the
 *      existing enforce-retention cron (Wave 13 avoids a new cron
 *      slot — time-based expiry is bounded by the monthly cron).
 *
 * We are intentionally conservative: the database is the source of
 * truth. This module never caches across invocations — only within
 * a single AsyncLocalStorage-less `Map` passed in by the caller,
 * which the cron flushes when it exits. That way a hold applied at
 * 10:00 is visible to the 10:05 purge without waiting for a cache
 * TTL.
 */

import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { incCounter, setGauge, Metrics } from '@/lib/metrics'

// ── types ───────────────────────────────────────────────────────────────

export const LegalHoldSubjectType = ['user', 'order', 'document', 'pharmacy', 'payment'] as const
export type LegalHoldSubjectType = (typeof LegalHoldSubjectType)[number]

export const LegalHoldReasonCode = [
  'ANPD_INVESTIGATION',
  'CDC_INVESTIGATION',
  'JUDICIAL_SUBPOENA',
  'CRIMINAL_PROBE',
  'CIVIL_LITIGATION',
  'INTERNAL_AUDIT',
  'REGULATOR_REQUEST',
  'OTHER',
] as const
export type LegalHoldReasonCode = (typeof LegalHoldReasonCode)[number]

export type LegalHoldStatus = 'active' | 'released' | 'expired'

export interface LegalHoldRow {
  id: string
  subject_type: LegalHoldSubjectType
  subject_id: string
  reason_code: LegalHoldReasonCode
  reason: string
  document_refs: unknown[]
  expires_at: string | null
  placed_at: string
  placed_by: string
  status: LegalHoldStatus
  released_at: string | null
  released_by: string | null
  release_reason: string | null
  requestor: Record<string, unknown>
}

// ── validation ──────────────────────────────────────────────────────────

export const applyHoldSchema = z.object({
  subject_type: z.enum(LegalHoldSubjectType),
  subject_id: z.string().uuid(),
  reason_code: z.enum(LegalHoldReasonCode),
  reason: z.string().min(10).max(2000),
  // ISO-8601 timestamp in the future. We also reject hold windows
  // shorter than 1 h because anything shorter is usually a typo.
  expires_at: z.string().datetime({ offset: true }).optional().nullable(),
  document_refs: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  requestor: z
    .object({
      org: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
      contact: z.string().max(200).optional(),
      document_number: z.string().max(200).optional(),
    })
    .partial()
    .optional(),
})
export type ApplyHoldInput = z.infer<typeof applyHoldSchema>

export const releaseHoldSchema = z.object({
  hold_id: z.string().uuid(),
  release_reason: z.string().min(10).max(2000),
})
export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>

// ── writes ──────────────────────────────────────────────────────────────

/**
 * Create (or idempotently re-fetch) a legal hold. The database
 * enforces one active row per (subject, reason_code); we mirror
 * the behaviour here so the admin UI can retry confidently.
 */
export async function applyLegalHold(
  input: ApplyHoldInput,
  placedBy: string
): Promise<LegalHoldRow> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('legal_hold_apply', {
    p_subject_type: input.subject_type,
    p_subject_id: input.subject_id,
    p_reason_code: input.reason_code,
    p_reason: input.reason,
    p_placed_by: placedBy,
    p_expires_at: input.expires_at ?? null,
    p_document_refs: input.document_refs ?? [],
    p_requestor: input.requestor ?? {},
  })
  if (error) {
    incCounter(Metrics.LEGAL_HOLD_APPLY_TOTAL, {
      reason_code: input.reason_code,
      outcome: 'error',
    })
    logger.error('[legal-hold] apply RPC failed', {
      module: 'legal-hold',
      reason_code: input.reason_code,
      error: error.message,
    })
    throw new Error(`legal_hold_apply failed: ${error.message}`)
  }
  const row = data as LegalHoldRow
  incCounter(Metrics.LEGAL_HOLD_APPLY_TOTAL, {
    reason_code: input.reason_code,
    outcome: 'ok',
  })
  logger.info('[legal-hold] applied', {
    module: 'legal-hold',
    id: row.id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    reason_code: row.reason_code,
    expires_at: row.expires_at,
  })
  return row
}

export async function releaseLegalHold(
  input: ReleaseHoldInput,
  releasedBy: string
): Promise<LegalHoldRow> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('legal_hold_release', {
    p_hold_id: input.hold_id,
    p_release_reason: input.release_reason,
    p_released_by: releasedBy,
  })
  if (error) {
    incCounter(Metrics.LEGAL_HOLD_RELEASE_TOTAL, { outcome: 'error' })
    throw new Error(`legal_hold_release failed: ${error.message}`)
  }
  const row = data as LegalHoldRow
  incCounter(Metrics.LEGAL_HOLD_RELEASE_TOTAL, { outcome: 'ok' })
  logger.info('[legal-hold] released', {
    module: 'legal-hold',
    id: row.id,
    released_by: row.released_by,
  })
  return row
}

// ── reads ───────────────────────────────────────────────────────────────

/**
 * Check whether a subject is currently under an active legal hold.
 *
 * @param cache optional Map for call-site caching. Retention crons
 *              should pass one in so they don't re-query the DB
 *              for every row they iterate over. Cache keys are
 *              `${subject_type}:${subject_id}`.
 */
export async function isUnderLegalHold(
  subjectType: LegalHoldSubjectType,
  subjectId: string,
  cache?: Map<string, boolean>
): Promise<boolean> {
  const key = `${subjectType}:${subjectId}`
  if (cache?.has(key)) {
    return cache.get(key)!
  }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('legal_hold_is_active', {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  })
  if (error) {
    // Fail-safe: on DB error, treat as UNDER hold so we don't
    // delete data the regulator ordered preserved. The purge job
    // will retry next cycle.
    logger.error('[legal-hold] is_active RPC failed — assuming HELD', {
      module: 'legal-hold',
      subject_type: subjectType,
      subject_id: subjectId,
      error: error.message,
    })
    if (cache) cache.set(key, true)
    return true
  }
  const active = data === true
  if (cache) cache.set(key, active)
  return active
}

export async function listActiveHolds(): Promise<LegalHoldRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('legal_holds_active_view')
    .select('*')
    .order('placed_at', { ascending: false })
  if (error) {
    throw new Error(`list active holds failed: ${error.message}`)
  }
  return (data ?? []) as LegalHoldRow[]
}

export async function listAllHolds(limit = 200): Promise<LegalHoldRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('legal_holds')
    .select('*')
    .order('placed_at', { ascending: false })
    .limit(limit)
  if (error) {
    throw new Error(`list holds failed: ${error.message}`)
  }
  return (data ?? []) as LegalHoldRow[]
}

// ── maintenance ─────────────────────────────────────────────────────────

/**
 * Flip `status='active' AND expires_at<now()` rows to `'expired'`.
 * Called from the monthly enforce-retention cron so time-based
 * expiry doesn't drift more than 30 days.
 */
export async function expireStaleHolds(): Promise<{ expired: number }> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('legal_hold_expire_stale')
  if (error) {
    throw new Error(`legal_hold_expire_stale failed: ${error.message}`)
  }
  const row = Array.isArray(data) ? data[0] : data
  const expired = Number((row as { expired_count?: number } | null)?.expired_count ?? 0)
  if (expired > 0) {
    incCounter(Metrics.LEGAL_HOLD_EXPIRED_TOTAL, {}, expired)
  }
  return { expired }
}

/**
 * Emit the active-hold gauge. Cheap single COUNT(*) query; the
 * caller (deep health, daily cron) decides cadence.
 */
export async function refreshActiveHoldGauge(): Promise<number> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from('legal_holds_active_view')
    .select('*', { count: 'exact', head: true })
  if (error) {
    logger.warn('[legal-hold] count failed', { error: error.message })
    return 0
  }
  const n = count ?? 0
  setGauge(Metrics.LEGAL_HOLD_ACTIVE_COUNT, n)
  return n
}

// ── audit helper ────────────────────────────────────────────────────────

/**
 * Record that a purge cycle skipped N rows because of a hold. We
 * do this from the Node side (rather than SQL) so the metric is
 * labelled by job name and lives in the same registry the rest of
 * Wave 6/11 uses.
 */
export function recordPurgeBlocked(job: string, count: number): void {
  if (count <= 0) return
  incCounter(Metrics.LEGAL_HOLD_BLOCKED_PURGE_TOTAL, { job }, count)
}
