import { inngest } from '@/lib/inngest'
import { withCronGuard } from '@/lib/cron/guarded'

export const runtime = 'nodejs'

export const GET = withCronGuard('reorder-alerts', async () => {
  await inngest.send({
    name: 'cron/reorder-alerts.check',
    data: { triggeredAt: new Date().toISOString() },
  })
  return { triggered: 'reorder-alerts' }
})
