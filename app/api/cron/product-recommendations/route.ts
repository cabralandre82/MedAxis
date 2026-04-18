import { inngest } from '@/lib/inngest'
import { withCronGuard } from '@/lib/cron/guarded'

export const runtime = 'nodejs'

export const GET = withCronGuard('product-recommendations', async () => {
  await inngest.send({
    name: 'cron/product-recommendations.rebuild',
    data: { triggeredAt: new Date().toISOString() },
  })
  return { triggered: 'product-recommendations' }
})
