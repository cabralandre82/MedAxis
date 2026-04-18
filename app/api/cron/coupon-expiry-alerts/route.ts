import { createAdminClient } from '@/lib/db/admin'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { withCronGuard } from '@/lib/cron/guarded'

/**
 * GET /api/cron/coupon-expiry-alerts
 * Daily cron: finds active+activated coupons expiring within 7 days
 * and notifies clinic members and admins.
 * Schedule: every day at 09:00 UTC (see vercel.json)
 *
 * Wrapped by withCronGuard (Wave 2) — single-flight lock + cron_runs audit.
 */
export const GET = withCronGuard('coupon-expiry-alerts', async () => {
  const admin = createAdminClient()
  const now = new Date()
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiring, error } = await admin
    .from('coupons')
    .select('id, code, clinic_id, product_id, valid_until, products(name), clinics(trade_name)')
    .eq('active', true)
    .not('activated_at', 'is', null)
    .not('valid_until', 'is', null)
    .gte('valid_until', now.toISOString())
    .lte('valid_until', in7Days)

  if (error) {
    logger.error('coupon query failed', { action: 'coupon-expiry-alerts', error })
    throw new Error(`coupon query failed: ${error.message}`)
  }

  if (!expiring?.length) {
    return { notified: 0, message: 'Nenhum cupom expirando nos próximos 7 dias' }
  }

  let notified = 0

  for (const coupon of expiring) {
    const productName = (coupon.products as unknown as { name: string } | null)?.name ?? 'produto'
    const clinicName =
      (coupon.clinics as unknown as { trade_name: string } | null)?.trade_name ?? 'clínica'

    const expiresAt = new Date(coupon.valid_until as string)
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const expiryLabel = daysLeft === 1 ? 'amanhã' : `em ${daysLeft} dias`

    const { data: members } = await admin
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', coupon.clinic_id)

    for (const member of members ?? []) {
      await createNotification({
        userId: member.user_id,
        type: 'COUPON_ASSIGNED',
        title: `Cupom de desconto expira ${expiryLabel}`,
        body: `Seu cupom de desconto no produto "${productName}" vence ${expiryLabel}. Aproveite antes que expire.`,
        link: '/coupons',
      })
    }

    await createNotificationForRole('SUPER_ADMIN', {
      type: 'COUPON_ASSIGNED',
      title: `Cupom expirando: ${coupon.code}`,
      body: `O cupom de ${clinicName} para "${productName}" expira ${expiryLabel}.`,
      link: '/coupons',
    })

    notified++
    logger.info('coupon alert sent', {
      action: 'coupon-expiry-alerts',
      couponId: coupon.id,
      code: coupon.code,
      daysLeft,
    })
  }

  return { notified, message: `${notified} cupom(ns) com alerta enviado` }
})
