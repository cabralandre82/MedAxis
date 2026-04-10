import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { exportOrdersJob } from '@/lib/jobs/export-orders'
import { staleOrdersJob } from '@/lib/jobs/stale-orders'
import { asaasWebhookJob } from '@/lib/jobs/asaas-webhook'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [exportOrdersJob, staleOrdersJob, asaasWebhookJob],
})
