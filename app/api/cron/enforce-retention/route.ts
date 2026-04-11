import { NextRequest, NextResponse } from 'next/server'
import { enforceRetentionPolicy } from '@/lib/retention-policy'

/**
 * GET /api/cron/enforce-retention
 * Monthly cron: enforces data retention policy per LGPD + CTN requirements.
 * Schedule: 1st of each month at 02:00 UTC (see vercel.json)
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await enforceRetentionPolicy()

  if (result.errors.length > 0) {
    console.error('[cron/enforce-retention] partial errors:', result.errors)
  }

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    ...result,
  })
}
