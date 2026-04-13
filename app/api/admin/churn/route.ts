import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { z } from 'zod'

/**
 * GET  /api/admin/churn   — list all at-risk clinics sorted by score desc
 * POST /api/admin/churn   — mark a clinic as contacted (or clear contact)
 */

export async function GET(req: NextRequest) {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SALES_CONSULTANT'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const riskLevel = searchParams.get('risk') // HIGH | MODERATE | LOW
  const contacted = searchParams.get('contacted') // 'true' | 'false'

  const admin = createAdminClient()
  let query = admin
    .from('clinic_churn_scores')
    .select(
      `id, score, risk_level, days_since_last_order, avg_cycle_days,
       open_tickets, failed_payments, computed_at, contacted_at, contact_notes,
       clinics ( id, trade_name, email, city, state, status )`
    )
    .order('score', { ascending: false })

  if (riskLevel) query = query.eq('risk_level', riskLevel)
  if (contacted === 'true') query = query.not('contacted_at', 'is', null)
  if (contacted === 'false') query = query.is('contacted_at', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

const contactSchema = z.object({
  clinicId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  clear: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  let userId: string
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SALES_CONSULTANT'])
    userId = user.id
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = contactSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const { clinicId, notes, clear } = parsed.data
  const admin = createAdminClient()

  const update = clear
    ? { contacted_at: null, contacted_by_user_id: null, contact_notes: null }
    : {
        contacted_at: new Date().toISOString(),
        contacted_by_user_id: userId,
        contact_notes: notes ?? null,
      }

  const { error } = await admin.from('clinic_churn_scores').update(update).eq('clinic_id', clinicId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
