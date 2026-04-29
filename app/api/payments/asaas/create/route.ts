import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { generateAsaasChargeForOrder } from '@/lib/payments/asaas-charge'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const createPaymentSchema = z.object({
  orderId: z.string().uuid('orderId inválido'),
})

/**
 * Create or refresh the Asaas charge for an order.
 *
 * Authorization (changed 2026-04-29 hot-incident #2): platform admins
 * can trigger this for any order, AND the clinic admin who owns the
 * order can trigger it too. Before this fix, only platform admins
 * could press the button — leaving a clinic stuck on the dead-end
 * "Aguardando geração da cobrança pelo administrador" UI when the
 * auto-trigger in `services/document-review.ts` failed.
 *
 * The charge generation itself is idempotent (see asaas-charge.ts), so
 * giving the clinic a retry button cannot create duplicate Asaas
 * payments for the same order.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = createPaymentSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })
  const { orderId } = parsed.data

  const admin = createAdminClient()

  const isPlatformAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  if (!isPlatformAdmin) {
    // Clinic admin path: the user must belong to the clinic that owns
    // the order. We do this with the admin client (bypassing RLS) because
    // the user is already authenticated and we want the membership check
    // to succeed even if RLS would have rejected the row read.
    const { data: order } = await admin
      .from('orders')
      .select('id, clinic_id')
      .eq('id', orderId)
      .maybeSingle()
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (!user.roles.includes('CLINIC_ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: membership } = await admin
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', user.id)
      .eq('clinic_id', order.clinic_id ?? '')
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await generateAsaasChargeForOrder(orderId)
  if (!result.ok) {
    logger.error('[POST /api/payments/asaas/create] charge generation failed', {
      orderId,
      userId: user.id,
      error: result.error ?? null,
    })
    return NextResponse.json({ error: result.error ?? 'Falha ao gerar cobrança' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    asaasPaymentId: result.asaasPaymentId,
    invoiceUrl: result.invoiceUrl,
    pixQrCode: result.pixQrCode,
    pixCopyPaste: result.pixCopyPaste,
    boletoUrl: result.boletoUrl,
    dueDate: result.dueDate,
  })
}
