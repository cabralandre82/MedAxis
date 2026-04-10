import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'

/**
 * GET /api/health
 *
 * Used by:
 *   - Vercel uptime checks
 *   - External monitoring (UptimeRobot, Better Uptime, etc.)
 *   - Upstash Redis health monitoring
 *   - CI/CD smoke tests post-deploy
 *
 * Returns 200 if all critical services are reachable, 503 otherwise.
 * Never returns auth errors — this endpoint is intentionally public.
 */
export async function GET() {
  const start = Date.now()
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  // ── Supabase connectivity check ──────────────────────────────────────────
  // Uses a lightweight query: count(1) on a small system table.
  // Does NOT expose any user data.
  try {
    const t0 = Date.now()
    const admin = createAdminClient()
    const { error } = await admin.from('sla_configs').select('id').limit(1)
    checks.database = { ok: !error, latencyMs: Date.now() - t0 }
    if (error) checks.database.error = error.message
  } catch (err) {
    checks.database = { ok: false, error: String(err) }
  }

  // ── Environment variables check ──────────────────────────────────────────
  const requiredEnvs = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const missingEnvs = requiredEnvs.filter((k) => !process.env[k])
  checks.env = { ok: missingEnvs.length === 0 }
  if (missingEnvs.length > 0) checks.env.error = `Missing: ${missingEnvs.join(', ')}`

  // ── Result ───────────────────────────────────────────────────────────────
  const allOk = Object.values(checks).every((c) => c.ok)
  const totalMs = Date.now() - start

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '1.9.0',
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalMs,
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        // Never cache health responses
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}
