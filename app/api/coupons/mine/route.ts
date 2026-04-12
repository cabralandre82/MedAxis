import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { getClinicCoupons } from '@/services/coupons'
import { apiLimiter } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await apiLimiter.check(ip)
  if (!rl.ok) return NextResponse.json({ error: 'Muitas requisições' }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const result = await getClinicCoupons()

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ coupons: result.coupons ?? [] })
}
