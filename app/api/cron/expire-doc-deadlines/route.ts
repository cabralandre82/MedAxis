import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'

/**
 * GET /api/cron/expire-doc-deadlines
 * Called daily by Vercel Cron.
 * Cancels orders that are still in AWAITING_DOCUMENTS past their docs_deadline.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: expired, error } = await admin
    .from('orders')
    .select('id, code, created_by_user_id, docs_deadline')
    .eq('order_status', 'AWAITING_DOCUMENTS')
    .not('docs_deadline', 'is', null)
    .lt('docs_deadline', new Date().toISOString())

  if (error) {
    logger.error('[expire-doc-deadlines] query error', { error })
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!expired?.length) {
    return NextResponse.json({ ok: true, canceled: 0 })
  }

  let canceled = 0

  for (const order of expired) {
    try {
      await admin
        .from('orders')
        .update({ order_status: 'CANCELED', updated_at: new Date().toISOString() })
        .eq('id', order.id)

      await admin.from('order_status_history').insert({
        order_id: order.id,
        old_status: 'AWAITING_DOCUMENTS',
        new_status: 'CANCELED',
        changed_by_user_id: null,
        reason: 'Cancelado automaticamente: prazo de reenvio de documentos expirado',
      })

      await createNotification({
        userId: order.created_by_user_id,
        type: 'ORDER_STATUS',
        title: `Pedido ${order.code} cancelado`,
        body: 'O prazo para reenvio dos documentos expirou. Abra um novo pedido se desejar continuar.',
        link: `/orders/${order.id}`,
        push: true,
      })

      canceled++
    } catch (err) {
      logger.error('[expire-doc-deadlines] failed to cancel order', {
        orderId: order.id,
        error: err,
      })
    }
  }

  return NextResponse.json({ ok: true, canceled })
}
