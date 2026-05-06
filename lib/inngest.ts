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
      /**
       * Asaas billing type — present on most events but optional because
       * legacy / synthetic deliveries may omit it. Mapped to internal
       * `payment_method` via `lib/payments/confirm-via-webhook.ts` when
       * the ledger atomic RPC is invoked. Known values per Asaas docs:
       * 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | 'TRANSFER' | 'UNDEFINED'.
       */
      billingType?: string
    }
  }
}

export type ChurnCheckEvent = {
  name: 'cron/churn.check'
  data: { triggeredAt: string }
}

export type ReorderAlertsEvent = {
  name: 'cron/reorder-alerts.check'
  data: { triggeredAt: string }
}

export type ProductRecommendationsEvent = {
  name: 'cron/product-recommendations.rebuild'
  data: { triggeredAt: string }
}

export type ContractAutoSendEvent = {
  name: 'registration/contract.auto-send'
  data: {
    entityType: 'CLINIC' | 'DOCTOR' | 'PHARMACY' | 'CONSULTANT'
    entityId: string
    registrationId: string
  }
}

export type InngestEvents =
  | ExportOrdersEvent
  | ExportCommissionsEvent
  | StaleOrdersEvent
  | AsaasWebhookEvent
  | ChurnCheckEvent
  | ReorderAlertsEvent
  | ProductRecommendationsEvent
  | ContractAutoSendEvent
