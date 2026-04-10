import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { sendEmail } from '@/lib/email'

type OrderRow = {
  code: string
  order_status: string
  total_price: number
  created_at: string
  clinics: { trade_name: string } | { trade_name: string }[] | null
  pharmacies: { trade_name: string } | { trade_name: string }[] | null
}

function getTradeName(val: { trade_name: string } | { trade_name: string }[] | null): string {
  if (!val) return ''
  if (Array.isArray(val)) return val[0]?.trade_name ?? ''
  return val.trade_name ?? ''
}

/**
 * Background job: Export orders to CSV without hitting serverless timeout.
 * Triggered by `export/orders.requested` event.
 * Sends result as email with CSV inline.
 */
export const exportOrdersJob = inngest.createFunction(
  {
    id: 'export-orders',
    name: 'Export Orders',
    triggers: [{ event: 'export/orders.requested' as const }],
    concurrency: { limit: 5 },
    retries: 2,
    timeouts: { finish: '10m' },
  },
  async ({ event, step }) => {
    const { filters, requestedBy, notifyEmail } = event.data

    const rows = await step.run('fetch-orders', async () => {
      const admin = createAdminClient()
      let query = admin
        .from('orders')
        .select(
          'code, order_status, total_price, created_at, clinics(trade_name), pharmacies(trade_name)'
        )
        .order('created_at', { ascending: false })

      if (filters.startDate) query = query.gte('created_at', filters.startDate)
      if (filters.endDate) query = query.lte('created_at', filters.endDate)
      if (filters.status) query = query.eq('order_status', filters.status)
      if (filters.pharmacyId) query = query.eq('pharmacy_id', filters.pharmacyId)

      const { data, error } = await query
      if (error) throw new Error(`DB query failed: ${error.message}`)
      return (data ?? []) as OrderRow[]
    })

    const csvContent = await step.run('build-csv', async () => {
      const header = 'Código,Status,Total,Data,Clínica,Farmácia'
      const lines = rows.map((r) =>
        [
          r.code,
          r.order_status,
          r.total_price,
          r.created_at,
          getTradeName(r.clinics),
          getTradeName(r.pharmacies),
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      return [header, ...lines].join('\n')
    })

    await step.run('send-email', async () => {
      await sendEmail({
        to: notifyEmail,
        subject: `Exportação de pedidos — ${new Date().toLocaleDateString('pt-BR')}`,
        html: `
          <p>Olá,</p>
          <p>Sua exportação de <strong>${rows.length} pedidos</strong> está pronta.</p>
          <p>Solicitada por: ${requestedBy}</p>
          <pre style="font-family:monospace;font-size:12px;overflow:auto">${csvContent.slice(0, 3000)}${csvContent.length > 3000 ? '\n...(truncado)' : ''}</pre>
        `,
      })
    })

    return { exported: rows.length, requestedBy }
  }
)
