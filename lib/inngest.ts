import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'clinipharma',
  name: 'Clinipharma',
  // eventKey is required in production — set INNGEST_EVENT_KEY env var
  // In development the Inngest Dev Server is used automatically
})

// ── Event type registry ───────────────────────────────────────────────────────

export type ExportOrdersEvent = {
  name: 'export/orders.requested'
  data: {
    format: 'csv' | 'xlsx'
    filters: {
      startDate?: string
      endDate?: string
      status?: string
      pharmacyId?: string
    }
    requestedBy: string
    notifyEmail: string
  }
}

export type ExportCommissionsEvent = {
  name: 'export/commissions.requested'
  data: {
    format: 'csv' | 'xlsx'
    consultantId?: string
    startDate?: string
    endDate?: string
    requestedBy: string
    notifyEmail: string
  }
}

export type StaleOrdersEvent = {
  name: 'cron/stale-orders.check'
  data: { triggeredAt: string }
}

export type AsaasWebhookEvent = {
  name: 'webhook/asaas.received'
  data: {
    event: string
    payment: {
      id: string
      externalReference?: string
      status: string
      value: number
      netValue: number
    }
  }
}

export type InngestEvents =
  | ExportOrdersEvent
  | ExportCommissionsEvent
  | StaleOrdersEvent
  | AsaasWebhookEvent
