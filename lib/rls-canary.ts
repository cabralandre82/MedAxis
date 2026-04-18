/**
 * RLS canary helpers — Wave 14.
 *
 * The cron at `/api/cron/rls-canary` (and the deep-health probe)
 * call into this module to:
 *
 *   1. Forge a short-lived JWT for an unaffiliated synthetic user
 *      (`canarySubjectUuid()` returns a fresh UUID each run).
 *   2. Open a non-bypass Supabase client with that JWT in the
 *      `Authorization: Bearer` header. PostgREST then sets
 *      `request.jwt.claims` and `role = authenticated` for the
 *      session, so the `public.rls_canary_assert(uuid)` RPC runs
 *      with **RLS enforced**. Only this configuration produces a
 *      meaningful answer — calling the RPC via service_role would
 *      BYPASS RLS and the canary would always pass.
 *   3. Persist the run summary to `public.rls_canary_log` via the
 *      service_role admin client (`rls_canary_record(...)`), which
 *      is the only client allowed to write to the hash-chained
 *      ledger.
 *
 * Security notes
 * --------------
 * * The JWT is HS256, signed with `SUPABASE_JWT_SECRET`. The
 *   secret is the same one PostgREST uses to validate every API
 *   call; if it leaks, the entire authenticated surface is
 *   compromised regardless of this canary, so we don't add new
 *   exposure.
 * * Tokens are minted with `exp = iat + 60s` because the canary
 *   round-trip is sub-second; we want stolen tokens to be useless
 *   long before they could be exfiltrated.
 * * The `sub` claim is a freshly-generated UUID. We deliberately
 *   do **not** reuse a fixed canary UUID — that way an attacker
 *   who somehow seeds rows for "the canary user" cannot mask a
 *   policy regression.
 *
 * @module lib/rls-canary
 */

import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/db/admin'
import { logger } from '@/lib/logger'
import { incCounter, observeHistogram, setGauge, Metrics } from '@/lib/metrics'

// ── types ──────────────────────────────────────────────────────────────

export interface CanaryAssertion {
  table_name: string
  bucket: 'tenant' | 'self' | 'admin'
  visible_rows: number
  expected_max: number
  violated: boolean
  error_message: string | null
}

export interface CanaryRun {
  ranAtMs: number
  durationMs: number
  subject: string
  tablesChecked: number
  violations: number
  assertions: CanaryAssertion[]
}

// ── JWT forging ────────────────────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Mint an HS256 JWT compatible with Supabase Postgrest. We
 * implement this in-house instead of pulling `jose` because the
 * canary needs exactly one signing operation and the official
 * server already proves HS256 over `SUPABASE_JWT_SECRET`.
 */
export function signCanaryJwt(subject: string, ttlSeconds = 60): string {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    throw new Error('[rls-canary] SUPABASE_JWT_SECRET is required to forge a canary JWT.')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    iss: 'rls-canary',
    sub: subject,
    iat: now,
    exp: now + ttlSeconds,
  }
  const head = base64url(JSON.stringify(header))
  const body = base64url(JSON.stringify(payload))
  const data = `${head}.${body}`
  const sig = base64url(createHmac('sha256', secret).update(data).digest())
  return `${data}.${sig}`
}

export function canarySubjectUuid(): string {
  return randomUUID()
}

// ── canary client ──────────────────────────────────────────────────────

/**
 * Build a Supabase client that authenticates as the canary subject.
 * It reuses the project's anon key as `apikey` (PostgREST requires
 * it on every request) but overrides the `Authorization` header
 * with the forged JWT — that's how PostgREST resolves role from
 * the bearer rather than the apikey.
 */
function createCanaryClient(jwt: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error(
      '[rls-canary] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.'
    )
  }
  return createSupabaseClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  })
}

// ── orchestrator ───────────────────────────────────────────────────────

/**
 * Run one full canary cycle:
 *   1. Mint canary subject + JWT.
 *   2. Call `rls_canary_assert(subject)` as the canary user.
 *   3. Persist summary via `rls_canary_record(...)` as service_role.
 *   4. Emit metrics + structured log.
 *
 * Always returns a CanaryRun even on partial failure (e.g. assert
 * RPC throws). The cron then decides whether to alert.
 */
export async function runCanary(): Promise<CanaryRun> {
  const startedAt = Date.now()
  const subject = canarySubjectUuid()
  const jwt = signCanaryJwt(subject, 60)
  const client = createCanaryClient(jwt)

  const { data, error } = await client.rpc('rls_canary_assert', {
    p_subject_uuid: subject,
  })

  if (error) {
    // RPC-level error means we couldn't even ask. Treat the whole
    // run as a "violation" so the cron escalates — better to wake
    // someone for a transient DB error than to silently miss days
    // of broken canaries.
    logger.error('[rls-canary] assert RPC failed', {
      module: 'rls-canary',
      subject,
      error: error.message,
    })
    incCounter(Metrics.RLS_CANARY_RUNS_TOTAL, { outcome: 'error' })
    const run: CanaryRun = {
      ranAtMs: Date.now(),
      durationMs: Date.now() - startedAt,
      subject,
      tablesChecked: 0,
      violations: 1,
      assertions: [],
    }
    await persistRun(run, { rpc_error: error.message }).catch(() => {})
    return run
  }

  const assertions: CanaryAssertion[] = (data ?? []) as CanaryAssertion[]
  const violations = assertions.filter((a) => a.violated).length
  const durationMs = Date.now() - startedAt

  observeHistogram(Metrics.RLS_CANARY_DURATION_MS, durationMs)
  incCounter(Metrics.RLS_CANARY_RUNS_TOTAL, {
    outcome: violations === 0 ? 'ok' : 'violation',
  })
  setGauge(Metrics.RLS_CANARY_TABLES_CHECKED, assertions.length)
  if (violations > 0) {
    incCounter(Metrics.RLS_CANARY_VIOLATIONS_TOTAL, {}, violations)
    setGauge(Metrics.RLS_CANARY_LAST_VIOLATION_TS, Math.floor(Date.now() / 1000))
  } else {
    setGauge(Metrics.RLS_CANARY_LAST_SUCCESS_TS, Math.floor(Date.now() / 1000))
  }

  const run: CanaryRun = {
    ranAtMs: Date.now(),
    durationMs,
    subject,
    tablesChecked: assertions.length,
    violations,
    assertions,
  }

  await persistRun(run).catch((err) => {
    logger.error('[rls-canary] persist failed (run still counted in metrics)', {
      module: 'rls-canary',
      subject,
      error: (err as Error).message,
    })
  })

  return run
}

/**
 * Insert the run into the hash-chained `rls_canary_log` ledger via
 * the SECURITY DEFINER `rls_canary_record(...)` RPC. We pass a
 * compact `details` payload containing only the violating rows
 * (full assertion list would bloat the table on healthy days).
 */
async function persistRun(
  run: CanaryRun,
  extraDetails: Record<string, unknown> = {}
): Promise<void> {
  const admin = createAdminClient()
  const violatingRows = run.assertions
    .filter((a) => a.violated)
    .slice(0, 50) // cap to avoid jsonb bloat on a worst-case run
    .map((a) => ({
      table: a.table_name,
      bucket: a.bucket,
      visible_rows: a.visible_rows,
      error: a.error_message,
    }))

  const details = {
    duration_ms: run.durationMs,
    violating: violatingRows,
    ...extraDetails,
  }

  const { error } = await admin.rpc('rls_canary_record', {
    p_subject_uuid: run.subject,
    p_tables_checked: run.tablesChecked,
    p_violations: run.violations,
    p_details: details,
  })
  if (error) {
    throw new Error(`rls_canary_record failed: ${error.message}`)
  }
}

// ── deep-health helpers ────────────────────────────────────────────────

/**
 * Read the freshness of the canary ledger for the deep health
 * endpoint. Returns null if no rows exist yet (genesis hasn't
 * been recorded — should only happen pre-migration-055).
 */
export async function readLatestCanaryStatus(): Promise<{
  lastRunAt: string
  lastRunAgeSeconds: number
  lastViolations: number
  tablesChecked: number
} | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('rls_canary_log')
    .select('ran_at, violations, tables_checked')
    .order('ran_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`read canary status failed: ${error.message}`)
  const row = (data ?? [])[0] as
    | { ran_at: string; violations: number; tables_checked: number }
    | undefined
  if (!row) return null
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(row.ran_at).getTime()) / 1000))
  setGauge(Metrics.RLS_CANARY_AGE_SECONDS, ageSeconds)
  return {
    lastRunAt: row.ran_at,
    lastRunAgeSeconds: ageSeconds,
    lastViolations: row.violations,
    tablesChecked: row.tables_checked,
  }
}
