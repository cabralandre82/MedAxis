/**
 * Backup ledger helpers — Wave 12.
 *
 * The actual backup work (pg_dump, age-encrypt, R2 upload) lives
 * in `.github/workflows/offsite-backup.yml` and runs on GitHub
 * runners. This module is the **platform-side** interface that:
 *
 *   1. Validates ingest payloads coming from the workflow before
 *      they hit the `backup_record_run()` RPC.
 *   2. Reads `backup_latest_view` for the freshness cron and the
 *      deep health endpoint.
 *   3. Exposes the chain-verifier RPC so on-call can sanity-check
 *      the ledger during an incident without needing psql access.
 *
 * Kept intentionally small — everything heavy (encryption, upload,
 * restore) stays in CI where the secrets live offline.
 */

import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { Metrics, incCounter, observeHistogram, setGauge } from '@/lib/metrics'

// ── types + validation ─────────────────────────────────────────────────

export const BackupKind = ['BACKUP', 'VERIFY', 'RESTORE_DRILL'] as const
export type BackupKind = (typeof BackupKind)[number]

export const BackupOutcome = ['ok', 'fail', 'partial'] as const
export type BackupOutcome = (typeof BackupOutcome)[number]

/**
 * Schema for the JSON body accepted by `/api/backups/record`.
 * We validate every field because the payload is supplied by a
 * GitHub-hosted runner we do not control at runtime — a rogue
 * workflow fork would otherwise be able to poison the ledger.
 */
export const recordRunSchema = z.object({
  kind: z.enum(BackupKind),
  // 'weekly' | 'monthly' | 'ad-hoc' | ... — free-form so labels
  // added in future workflows don't require a platform deploy.
  label: z.string().min(1).max(64),
  r2_prefix: z.string().max(256).optional().nullable(),
  // manifest-sha256.txt content (sha256:filename pairs, newline-
  // separated). We store it as-is so operators can diff two runs.
  files_sha256: z.string().max(8192).optional().nullable(),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional().nullable(),
  outcome: z.enum(BackupOutcome),
  source_url: z.string().url().max(512).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type RecordRunInput = z.infer<typeof recordRunSchema>

export interface BackupRunRow {
  id: string
  kind: BackupKind
  label: string
  r2_prefix: string | null
  files_sha256: string | null
  size_bytes: number | null
  outcome: BackupOutcome
  source_url: string | null
  metadata_json: Record<string, unknown>
  recorded_at: string
  prev_hash: string | null
  row_hash: string
}

// ── record ingest ──────────────────────────────────────────────────────

/**
 * Persist a workflow run outcome into `backup_runs`. Idempotency
 * is best-effort: if the same workflow attempts to record twice
 * (retry after a network blip) we get two rows with different
 * `row_hash` — the chain is still valid because the second row
 * links to the first. Deduplication would require the workflow
 * to supply its own nonce, which is future work.
 *
 * @throws when the RPC returns a Postgres error. Caller is
 *   expected to convert the error into a 5xx response.
 */
export async function recordBackupRun(input: RecordRunInput): Promise<BackupRunRow> {
  const admin = createAdminClient()
  const startedAt = Date.now()

  const { data, error } = await admin.rpc('backup_record_run', {
    p_kind: input.kind,
    p_label: input.label,
    p_r2_prefix: input.r2_prefix ?? null,
    p_files_sha256: input.files_sha256 ?? null,
    p_size_bytes: input.size_bytes ?? null,
    p_outcome: input.outcome,
    p_metadata: input.metadata ?? {},
    p_source_url: input.source_url ?? null,
  })

  const elapsed = Date.now() - startedAt
  observeHistogram(Metrics.BACKUP_RECORD_DURATION_MS, elapsed, {
    kind: input.kind,
    outcome: input.outcome,
  })

  if (error) {
    incCounter(Metrics.BACKUP_RECORD_TOTAL, {
      kind: input.kind,
      outcome: input.outcome,
      result: 'error',
    })
    logger.error('[backup] record_run RPC failed', {
      module: 'backup',
      kind: input.kind,
      label: input.label,
      error: error.message,
    })
    throw new Error(`backup_record_run failed: ${error.message}`)
  }

  incCounter(Metrics.BACKUP_RECORD_TOTAL, {
    kind: input.kind,
    outcome: input.outcome,
    result: 'ok',
  })

  const row = data as BackupRunRow
  // Only the BACKUP kind counts towards freshness — VERIFY and
  // RESTORE_DRILL are independent signals.
  if (input.kind === 'BACKUP' && input.outcome === 'ok') {
    setGauge(
      Metrics.BACKUP_LAST_SUCCESS_TS,
      Math.floor(new Date(row.recorded_at).getTime() / 1000),
      { label: input.label }
    )
    if (typeof input.size_bytes === 'number') {
      setGauge(Metrics.BACKUP_LAST_SIZE_BYTES, input.size_bytes, { label: input.label })
    }
  }
  if (input.kind === 'RESTORE_DRILL' && input.outcome === 'ok') {
    setGauge(
      Metrics.RESTORE_DRILL_LAST_SUCCESS_TS,
      Math.floor(new Date(row.recorded_at).getTime() / 1000),
      { label: input.label }
    )
  }

  return row
}

// ── freshness read ─────────────────────────────────────────────────────

export interface BackupFreshnessRow {
  kind: BackupKind
  label: string
  outcome: BackupOutcome
  r2_prefix: string | null
  size_bytes: number | null
  recorded_at: string
  source_url: string | null
  metadata_json: Record<string, unknown>
  age_seconds: number
}

/**
 * Read the `backup_latest_view` and annotate each row with its
 * age in seconds. Used by the freshness cron and the deep health
 * endpoint.
 */
export async function getBackupFreshness(): Promise<BackupFreshnessRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('backup_latest_view')
    .select('kind, label, outcome, r2_prefix, size_bytes, recorded_at, source_url, metadata_json')

  if (error) {
    throw new Error(`backup_latest_view select failed: ${error.message}`)
  }

  const now = Date.now()
  return (data ?? []).map((r) => ({
    ...(r as Omit<BackupFreshnessRow, 'age_seconds'>),
    age_seconds: Math.max(
      0,
      Math.floor((now - new Date(r.recorded_at as string).getTime()) / 1000)
    ),
  }))
}

// ── chain verifier ─────────────────────────────────────────────────────

export interface ChainVerifyResult {
  first_break_id: string | null
  checked_rows: number
}

/**
 * Call `backup_verify_chain()` and return the first break, if
 * any. Scoped to a single `kind` so the freshness cron can
 * verify BACKUP and RESTORE_DRILL chains independently and page
 * only on the one that broke.
 */
export async function verifyBackupChain(kind?: BackupKind): Promise<ChainVerifyResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('backup_verify_chain', {
    p_kind: kind ?? null,
  })
  if (error) {
    throw new Error(`backup_verify_chain failed: ${error.message}`)
  }
  // PostgREST returns the TABLE(...) result as an array of objects.
  const row = Array.isArray(data) ? data[0] : data
  return {
    first_break_id: (row?.first_break_id as string | null) ?? null,
    checked_rows: Number(row?.checked_rows ?? 0),
  }
}

// ── SLA helpers ────────────────────────────────────────────────────────

/**
 * Business SLAs for the freshness cron. Kept as top-level
 * constants so the runbook and dashboard can reference the exact
 * seconds we use in production.
 */
export const BACKUP_SLA = {
  /** Weekly backup: 7 days cron + 2 day grace = 9 days. */
  BACKUP_MAX_AGE_S: 9 * 24 * 60 * 60,
  /** Monthly drill: ~30 days cron + 5 day grace = 35 days. */
  RESTORE_DRILL_MAX_AGE_S: 35 * 24 * 60 * 60,
  /** Verification (optional, future): weekly + grace. */
  VERIFY_MAX_AGE_S: 9 * 24 * 60 * 60,
} as const
