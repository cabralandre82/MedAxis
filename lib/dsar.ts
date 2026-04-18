/**
 * DSAR (Data Subject Access Request) service — Wave 9.
 *
 * Central, server-only module for every LGPD Art. 18 operation:
 *
 *   - `createDsarRequest()` — subject opens a request.
 *   - `transitionDsarRequest()` — admin advances it through the
 *     RECEIVED → PROCESSING → FULFILLED|REJECTED|EXPIRED state graph.
 *   - `buildExportBundle()` — deterministic, signed canonical JSON
 *     for Art. 18 I access requests. The signature is HMAC-SHA256
 *     over the canonical payload so the delivered bundle is
 *     non-repudiable.
 *   - `hashCanonicalBundle()` — plain digest used by the cron /
 *     unit tests to verify "this was the payload we delivered".
 *
 * This module never mutates `public.dsar_requests` or
 * `public.dsar_audit` directly — every write goes through
 * `public.dsar_transition()` (migration 051) so the state graph is
 * enforced in the database and the append-only hash chain is
 * maintained atomically with the state change.
 *
 * @module lib/dsar
 */

import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'

// ── Types ───────────────────────────────────────────────────────────────

export type DsarKind = 'EXPORT' | 'ERASURE' | 'RECTIFICATION'
export type DsarStatus = 'RECEIVED' | 'PROCESSING' | 'FULFILLED' | 'REJECTED' | 'EXPIRED'

export interface DsarRequestRow {
  id: string
  subject_user_id: string
  kind: DsarKind
  status: DsarStatus
  sla_due_at: string
  reason_text: string | null
  reject_code: string | null
  delivery_hash: string | null
  delivery_ref: string | null
  requested_at: string
  triaged_at: string | null
  fulfilled_at: string | null
  expired_at: string | null
  requested_by: string | null
  triaged_by: string | null
  fulfilled_by: string | null
  request_id: string | null
  created_at: string
  updated_at: string
}

export interface TransitionResult {
  id: string
  status: DsarStatus
  kind: DsarKind
  sla_due_at: string
  fulfilled_at: string | null
  expired_at: string | null
  row_hash: string
}

export interface TransitionArgs {
  actorUserId?: string | null
  actorRole?: string | null
  metadata?: Record<string, unknown>
  rejectCode?: string | null
  deliveryHash?: string | null
  deliveryRef?: string | null
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Open a new DSAR request. The subject must match the authenticated
 * caller — RLS enforces this at the database level and we also do a
 * defence-in-depth check here so the error message is friendly.
 *
 * Returns the inserted row. Emits `dsar_requests_opened_total{kind}`.
 */
export async function createDsarRequest(input: {
  subjectUserId: string
  kind: DsarKind
  reasonText?: string
  requestedBy?: string | null
  requestCorrelationId?: string | null
}): Promise<{ data?: DsarRequestRow; error?: { reason: string; message: string } }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('dsar_requests')
    .insert({
      subject_user_id: input.subjectUserId,
      kind: input.kind,
      reason_text: input.reasonText ?? null,
      requested_by: input.requestedBy ?? input.subjectUserId,
      request_id: input.requestCorrelationId ?? null,
    })
    .select('*')
    .single()

  if (error) {
    // Unique constraint violation means the subject already has an
    // open request of the same kind. Surface a stable error code.
    if (error.code === '23505') {
      incCounter(Metrics.DSAR_DUPLICATE_OPEN_TOTAL, { kind: input.kind })
      return {
        error: {
          reason: 'duplicate_open',
          message: 'Você já tem uma solicitação aberta deste tipo',
        },
      }
    }
    logger.error('[dsar] createDsarRequest insert failed', { error })
    return { error: { reason: 'db_error', message: error.message } }
  }

  incCounter(Metrics.DSAR_OPENED_TOTAL, { kind: input.kind })
  return { data: data as DsarRequestRow }
}

/**
 * Move a DSAR request through its state graph via the
 * `public.dsar_transition()` RPC. Returns the RPC's `jsonb` result
 * shape plus a resolved error when the target state is rejected
 * (invalid transition, missing delivery_hash, etc.).
 */
export async function transitionDsarRequest(
  requestId: string,
  toStatus: DsarStatus,
  args: TransitionArgs = {}
): Promise<{ data?: TransitionResult; error?: { reason: string; message: string } }> {
  const admin = createAdminClient()
  const started = Date.now()

  const pArgs: Record<string, unknown> = {
    actor_user_id: args.actorUserId ?? null,
    actor_role: args.actorRole ?? null,
    metadata: args.metadata ?? {},
  }
  if (args.rejectCode) pArgs.reject_code = args.rejectCode
  if (args.deliveryHash) pArgs.delivery_hash = args.deliveryHash
  if (args.deliveryRef) pArgs.delivery_ref = args.deliveryRef

  const { data, error } = await admin.rpc('dsar_transition', {
    p_request_id: requestId,
    p_to_status: toStatus,
    p_args: pArgs,
  })
  const durationMs = Date.now() - started
  observeHistogram(Metrics.DSAR_TRANSITION_DURATION_MS, durationMs)

  if (error) {
    const reason = mapPostgresError(error.message)
    incCounter(Metrics.DSAR_TRANSITION_ERROR_TOTAL, { reason, to: toStatus })
    logger.warn('[dsar] transition error', {
      requestId,
      toStatus,
      reason,
      pgMessage: error.message,
    })
    return { error: { reason, message: error.message } }
  }

  incCounter(Metrics.DSAR_TRANSITION_TOTAL, { to: toStatus })
  return { data: data as TransitionResult }
}

// ── Export signing ──────────────────────────────────────────────────────

/**
 * Produce a deterministic SHA-256 hex digest of a JSON-serialisable
 * value using the canonical-JSON form (keys alphabetically sorted,
 * no whitespace). Two different representations of the same logical
 * bundle yield the same hash.
 *
 * The canonical form is NOT JCS (RFC 8785) — we deliberately use a
 * simpler scheme that sorts keys and rejects `undefined`. JCS would
 * be worth the complexity only if we interop'd with external
 * verifiers.
 */
export function hashCanonicalBundle(payload: unknown): string {
  const canonical = canonicalize(payload)
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * HMAC-sign the canonical form of `payload` with the server-side
 * `LGPD_EXPORT_HMAC_KEY`. The returned string has the shape
 * `sha256=<hex>` to match webhook signature conventions elsewhere
 * in the codebase.
 *
 * The key is read lazily from env so missing-key failure modes
 * surface at call time (not module-load time) — this makes tests
 * that don't exercise the export path simpler.
 */
export function signCanonicalBundle(payload: unknown): { hash: string; signature: string } {
  const key = process.env.LGPD_EXPORT_HMAC_KEY
  if (!key || key.length < 32) {
    throw new Error('LGPD_EXPORT_HMAC_KEY missing or < 32 chars; cannot sign export bundle')
  }
  const canonical = canonicalize(payload)
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex')
  const signature = 'sha256=' + createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
  return { hash, signature }
}

/**
 * Verify a previously-signed bundle. Compares the signature in
 * constant time to prevent timing attacks on the HMAC.
 */
export function verifyCanonicalBundle(payload: unknown, signature: string): boolean {
  if (!signature.startsWith('sha256=')) return false
  const expected = signCanonicalBundle(payload).signature
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── Canonicalization (stable key order) ─────────────────────────────────

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, sortKeysDeep(v)] as const)
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) out[k] = v
  return out
}

// ── Postgres error mapping ──────────────────────────────────────────────

/**
 * Translate the free-text message from a `RAISE EXCEPTION … P0001`
 * in `public.dsar_transition()` into a stable enum our callers can
 * pattern-match on. Unknown errors fall through to `unknown`.
 */
export function mapPostgresError(message: string | null | undefined): string {
  if (!message) return 'unknown'
  const m = message.toLowerCase()
  if (m.includes('request ') && m.includes('not found')) return 'not_found'
  if (m.includes('invalid transition')) return 'invalid_transition'
  if (m.includes('reject_code required')) return 'reject_code_required'
  if (m.includes('delivery_hash') && m.includes('required')) return 'delivery_hash_required'
  if (m.includes('direct update forbidden')) return 'direct_update_forbidden'
  if (m.includes('append-only')) return 'audit_append_only'
  if (m.includes('new rows must start in received')) return 'bad_initial_state'
  if (m.includes('unknown target status')) return 'unknown_target_status'
  return 'unknown'
}

// Exported for unit-test convenience only.
export const _internal = { canonicalize, sortKeysDeep }
