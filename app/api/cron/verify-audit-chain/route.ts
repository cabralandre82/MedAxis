/**
 * GET /api/cron/verify-audit-chain — Wave 3 nightly tamper-detection.
 *
 * Re-hashes the last `lookbackHours` of `public.audit_logs` and compares
 * each stored `row_hash` with the recomputed value. Any drift means a
 * row was tampered with post-insert (or the hash chain was manually
 * broken) — the job returns non-200 so the cron_runs row is `failed`
 * and the P1 runbook `audit-chain-tampered.md` triggers.
 *
 * Wrapped by withCronGuard (Wave 2): single-flight lock + cron_runs audit.
 * Scheduled nightly 03:45 UTC via vercel.json.
 */

import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'
import { incCounter, setGauge, Metrics } from '@/lib/metrics'

interface VerifyRow {
  scanned_rows: number | null
  inconsistent_count: number | null
  first_broken_seq: number | null
  first_broken_id: string | null
  verified_from: string
  verified_to: string
}

const LOOKBACK_HOURS = Number(process.env.AUDIT_CHAIN_VERIFY_LOOKBACK_HOURS ?? '48')
const MAX_ROWS = Number(process.env.AUDIT_CHAIN_VERIFY_MAX_ROWS ?? '500000')

export const GET = withCronGuard('verify-audit-chain', async () => {
  const admin = createAdminClient()
  const startIso = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString()
  const endIso = new Date().toISOString()

  const { data, error } = await admin.rpc('verify_audit_chain', {
    p_start: startIso,
    p_end: endIso,
    p_max_rows: MAX_ROWS,
  })

  if (error) {
    logger.error('verify_audit_chain RPC error', {
      module: 'cron/verify-audit-chain',
      action: 'verify-audit-chain',
      error,
    })
    throw new Error(`verify_audit_chain RPC failed: ${error.message}`)
  }

  const summary = (Array.isArray(data) ? data[0] : (data as VerifyRow | null)) ?? null
  const scanned = Number(summary?.scanned_rows ?? 0)
  const inconsistent = Number(summary?.inconsistent_count ?? 0)

  incCounter(Metrics.AUDIT_CHAIN_VERIFY_TOTAL, {
    outcome: inconsistent > 0 ? 'tampered' : 'ok',
  })
  setGauge(Metrics.AUDIT_CHAIN_LAST_VERIFY_TS, Math.floor(Date.now() / 1000))

  if (inconsistent > 0) {
    incCounter(Metrics.AUDIT_CHAIN_BREAK_TOTAL, {}, inconsistent)
    logger.error('audit chain tampered', {
      module: 'cron/verify-audit-chain',
      action: 'verify-audit-chain',
      scanned,
      inconsistent,
      firstBrokenSeq: summary?.first_broken_seq,
      firstBrokenId: summary?.first_broken_id,
      verifiedFrom: summary?.verified_from,
      verifiedTo: summary?.verified_to,
    })
    throw new Error(
      `audit chain tampered: ${inconsistent} of ${scanned} rows failed verification ` +
        `(first broken seq=${summary?.first_broken_seq ?? 'unknown'})`
    )
  }

  logger.info('audit chain verified', {
    module: 'cron/verify-audit-chain',
    action: 'verify-audit-chain',
    scanned,
    verifiedFrom: summary?.verified_from,
    verifiedTo: summary?.verified_to,
  })

  return {
    scanned,
    inconsistent,
    verifiedFrom: summary?.verified_from ?? startIso,
    verifiedTo: summary?.verified_to ?? endIso,
    lookbackHours: LOOKBACK_HOURS,
  }
})
