import { inngest } from '@/lib/inngest'
import { withCronGuard } from '@/lib/cron/guarded'

export const runtime = 'nodejs'

export const GET = withCronGuard('churn-check', async () => {
  await inngest.send({ name: 'cron/churn.check', data: { triggeredAt: new Date().toISOString() } })
  return { triggered: 'churn-detection' }
})
