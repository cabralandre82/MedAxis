import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { createCoupon, getAdminCoupons } from '@/services/coupons'
import { apiLimiter } from '@/lib/rate-limit'

async function isAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .in('role', ['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  return (data?.length ?? 0) > 0
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await apiLimiter.check(ip)
  if (!rl.ok) return NextResponse.json({ error: 'Muitas requisições' }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await isAdmin(user.id)))
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const result = await getAdminCoupons()
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ coupons: result.coupons ?? [] })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await apiLimiter.check(ip)
  if (!rl.ok) return NextResponse.json({ error: 'Muitas requisições' }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await isAdmin(user.id)))
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const result = await createCoupon(body as Parameters<typeof createCoupon>[0])
  if (result.error) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({ coupon: result.coupon }, { status: 201 })
}
