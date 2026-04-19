/**
 * runCronGuarded — Wave 2 single-flight cron helper.
 *
 * Wraps a Vercel Cron Route Handler so that overlapping invocations of the
 * same `jobName` cannot race. Primary defences:
 *
 *   1. `cron_try_lock(jobName, lockedBy, ttl)` RPC (migration 045) acquires
 *      a TTL lease in `public.cron_locks`. A second invocation whose lease
 *      has not expired is immediately rejected.
 *   2. Every run appends a row to `public.cron_runs` with start time,
 *      duration, status and a JSON result summary; operators can grep the
 *      table for failed/skipped runs.
 *   3. On success the lease is released via `cron_release_lock`; on crash
 *      the lease auto-expires after `ttlSeconds`, so a wedged runner cannot
 *      block forever.
 *
 * Usage:
 *
 *   export const GET = withCronAuth('my-job', async (req) => {
 *     const out = await runCronGuarded('my-job', async () => {
 *       return await doWork()
 *     })
 *     return NextResponse.json(out)
 *   })
 *
 * Or more commonly, use `withCronGuard` which bundles auth + guard +
 * context + structured logging + response shaping in one wrapper.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { logger, withCronContext } from '@/lib/logger'
import { getRequestContext } from '@/lib/logger/context'
import { incCounter, observeHistogram, setGauge, Metrics } from '@/lib/metrics'

export interface GuardedOptions {
  /** Lease TTL in seconds. Default 900 (15 min) — matches Vercel Pro cron maxDuration. */
  ttlSeconds?: number
  /** Stable id for this process / deployment. Defaults to Vercel deployment url + uuid. */
  lockedBy?: string
}

export type GuardedResult<T> =
  | { status: 'success'; runId: number; durationMs: number; result: T }
  | { status: 'failed'; runId: number; durationMs: number; error: string }
  | { status: 'skipped_locked'; runId: number | null; reason: string }
  | { status: 'degraded'; reason: string }

const MODULE = { module: 'cron/guarded' }

function deriveLockedBy(override?: string): string {
  if (override) return override
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? 'local'
  return `${deployment}:${randomUUID()}`
}

/**
 * Runs `fn` under a named single-flight lock. Never throws — callers
 * receive a tagged union describing the outcome.
 */
export async function runCronGuarded<T>(
  jobName: string,
  fn: () => Promise<T>,
  opts: GuardedOptions = {}
): Promise<GuardedResult<T>> {
  if (!jobName || typeof jobName !== 'string') {
    throw new Error('runCronGuarded: jobName is required')
  }

  const ttl = Math.max(1, Math.floor(opts.ttlSeconds ?? 900))
  const lockedBy = deriveLockedBy(opts.lockedBy)
  const requestId = getRequestContext()?.requestId ?? null
  const admin = createAdminClient()

  // 1. Try to acquire lease ------------------------------------------------
  let acquired = false
  try {
    const rpc = await admin.rpc('cron_try_lock', {
      p_job_name: jobName,
      p_locked_by: lockedBy,
      p_ttl_seconds: ttl,
    })
    if (rpc.error) {
      logger.error('cron_try_lock RPC error', { ...MODULE, jobName, error: rpc.error })
      return { status: 'degraded', reason: rpc.error.message ?? 'rpc-error' }
    }
    acquired = rpc.data === true
  } catch (err) {
    logger.error('cron_try_lock threw', { ...MODULE, jobName, error: err })
    return { status: 'degraded', reason: err instanceof Error ? err.message : String(err) }
  }

  // 2. Append a cron_runs row regardless ----------------------------------
  const startedAt = Date.now()
  const initialStatus = acquired ? 'running' : 'skipped_locked'
  const runInsert = await admin
    .from('cron_runs')
    .insert({
      job_name: jobName,
      status: initialStatus,
      request_id: requestId,
      locked_by: lockedBy,
    })
    .select('id')
    .single()

  if (runInsert.error || !runInsert.data?.id) {
    logger.warn('cron_runs insert failed', {
      ...MODULE,
      jobName,
      acquired,
      error: runInsert.error,
    })
    // Still proceed if we hold the lock — side effects matter more than the audit row.
    if (!acquired) return { status: 'skipped_locked', runId: null, reason: 'lock-busy' }
  }

  const runId = (runInsert.data?.id as number | undefined) ?? null

  if (!acquired) {
    logger.info('cron skipped (another run in flight)', {
      ...MODULE,
      jobName,
      runId,
    })
    incCounter(Metrics.CRON_RUN_TOTAL, { job: jobName, status: 'skipped_locked' })
    return { status: 'skipped_locked', runId, reason: 'lock-busy' }
  }

  // 3. Execute -------------------------------------------------------------
  try {
    const result = await fn()
    const durationMs = Date.now() - startedAt

    // Only serialise JSON-safe results; discard anything exotic.
    const resultJson = safeJsonClone(result)

    if (runId) {
      await admin
        .from('cron_runs')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          result: resultJson,
        })
        .eq('id', runId)
    }

    await releaseLock(jobName, lockedBy)
    incCounter(Metrics.CRON_RUN_TOTAL, { job: jobName, status: 'success' })
    observeHistogram(Metrics.CRON_DURATION_MS, durationMs, { job: jobName })
    setGauge(Metrics.CRON_LAST_SUCCESS_TS, Math.floor(Date.now() / 1000), { job: jobName })
    return { status: 'success', runId: runId ?? -1, durationMs, result }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const message = err instanceof Error ? err.message : String(err)

    logger.error('cron failed', { ...MODULE, jobName, runId, error: err, durationMs })

    if (runId) {
      await admin
        .from('cron_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          error: truncate(message, 4096),
        })
        .eq('id', runId)
    }

    await releaseLock(jobName, lockedBy)
    incCounter(Metrics.CRON_RUN_TOTAL, { job: jobName, status: 'failed' })
    observeHistogram(Metrics.CRON_DURATION_MS, durationMs, { job: jobName })
    return { status: 'failed', runId: runId ?? -1, durationMs, error: message }
  }
}

async function releaseLock(jobName: string, lockedBy: string): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.rpc('cron_release_lock', {
      p_job_name: jobName,
      p_locked_by: lockedBy,
    })
  } catch (err) {
    logger.warn('cron_release_lock failed', { ...MODULE, jobName, error: err })
  }
}

function safeJsonClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[truncated]`
}

// ── HTTP wrapper ────────────────────────────────────────────────────────────

export interface CronHandlerOptions extends GuardedOptions {
  /** If false, skip the `CRON_SECRET` bearer check. Default true. */
  authenticate?: boolean
  /** Override the expected secret. Default `process.env.CRON_SECRET`. */
  expectedSecret?: string
}

type CronHandler<T> = (req: NextRequest) => Promise<T>

/**
 * Convenience wrapper: authenticate + run under ALS context + guard + log.
 *
 *   export const GET = withCronGuard('churn-check', async (req) => {
 *     return { triggered: await runChurn() }
 *   })
 */
export function withCronGuard<T>(
  jobName: string,
  handler: CronHandler<T>,
  options: CronHandlerOptions = {}
): (req: NextRequest) => Promise<NextResponse> {
  const { authenticate = true, expectedSecret, ...guardOpts } = options

  return withCronContext(jobName, async (req: NextRequest) => {
    if (authenticate) {
      const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
      const querySecret = req.nextUrl.searchParams.get('secret') ?? ''
      const headerSecret = req.headers.get('x-cron-secret') ?? ''
      const expected = expectedSecret ?? process.env.CRON_SECRET ?? ''
      const presented = bearer || headerSecret || querySecret
      if (!expected || presented !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const outcome = await runCronGuarded(jobName, () => handler(req), guardOpts)

    switch (outcome.status) {
      case 'success':
        return NextResponse.json({
          ok: true,
          job: jobName,
          runId: outcome.runId,
          durationMs: outcome.durationMs,
          result: outcome.result,
        })
      case 'skipped_locked':
        return NextResponse.json(
          {
            ok: true,
            job: jobName,
            skipped: true,
            reason: outcome.reason,
            runId: outcome.runId,
          },
          { status: 200 }
        )
      case 'failed':
        return NextResponse.json(
          {
            ok: false,
            job: jobName,
            runId: outcome.runId,
            durationMs: outcome.durationMs,
            error: outcome.error,
          },
          { status: 500 }
        )
      case 'degraded':
        return NextResponse.json(
          {
            ok: false,
            job: jobName,
            degraded: true,
            reason: outcome.reason,
          },
          { status: 503 }
        )
    }
  })
}
