import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { activateCoupon } from '@/services/coupons'
import { apiLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const rl = await apiLimiter.check(ip)
  if (!rl.ok) return NextResponse.json({ error: 'Muitas requisições' }, { status: 429 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  if (!body.code?.trim()) {
    return NextResponse.json({ error: 'Código obrigatório' }, { status: 400 })
  }

  const result = await activateCoupon(body.code)

  if (result.error) {
    logger.warn('[api/coupons/activate] failed', {
      code: body.code,
      error: result.error,
      userId: user.id,
    })
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  return NextResponse.json({ coupon: result.coupon })
}
