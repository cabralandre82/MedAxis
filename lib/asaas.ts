import { withCircuitBreaker } from '@/lib/circuit-breaker'

const BASE_URL = process.env.ASAAS_API_URL ?? 'https://sandbox.asaas.com/api/v3'
const API_KEY = process.env.ASAAS_API_KEY ?? ''

async function asaasFetchRaw<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: API_KEY,
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Asaas API error ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function asaasFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return withCircuitBreaker(() => asaasFetchRaw<T>(path, options), { name: 'asaas' })
}

// ── Customer ─────────────────────────────────────────────────────────────────

export interface AsaasCustomer {
  id: string
  name: string
  cpfCnpj: string
  email?: string
  phone?: string
}

export async function findOrCreateCustomer(params: {
  cpfCnpj: string
  name: string
  email?: string
  phone?: string
}): Promise<AsaasCustomer> {
  // Search existing
  const search = await asaasFetch<{ data: AsaasCustomer[] }>(
    `/customers?cpfCnpj=${encodeURIComponent(params.cpfCnpj)}&limit=1`
  )
  if (search.data.length > 0) return search.data[0]

  // Create new.
  //
  // notificationDisabled: true (changed 2026-04-29)
  // ------------------------------------------------
  // Asaas defaults to spamming the customer with cobrança/lembrete
  // D-3/D-1/vencimento/recibo e-mails branded "Asaas". For a B2B
  // marketplace this is wrong on three axes:
  //   1. Branding — clinic sees Asaas e-mails, not Clinipharma.
  //   2. PII — bounces (clinica@medaxis.com.br case 2026-04-29)
  //      generate Asaas-side noise that we can't suppress per-tenant.
  //   3. Redundancy — payment lives on our `/orders/[id]` page; the
  //      `createNotification` + Resend pipeline already pushes a
  //      Clinipharma-branded "pagamento disponível" message.
  //
  // We keep the e-mail field populated (helps human reconciliation
  // in the Asaas dashboard) but `notificationDisabled: true` stops
  // every outbound message from Asaas. Existing customers created
  // before this commit are silenced via a one-shot PATCH (see
  // `scripts/silence-asaas-notifications.ts`).
  return asaasFetch<AsaasCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      cpfCnpj: params.cpfCnpj,
      email: params.email,
      phone: params.phone,
      notificationDisabled: true,
    }),
  })
}

// ── Payment ───────────────────────────────────────────────────────────────────

export interface AsaasPayment {
  id: string
  status: string
  invoiceUrl: string
  bankSlipUrl?: string
  dueDate: string
  value: number
  pixQrCodeId?: string
}

export interface AsaasPixQrCode {
  encodedImage: string // base64
  payload: string // copy-paste code
  expirationDate: string
}

export async function createPayment(params: {
  customerId: string
  value: number
  dueDate: string // YYYY-MM-DD
  description: string
  externalReference?: string
}): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      billingType: 'UNDEFINED', // shows PIX + boleto + cartão
      value: params.value,
      dueDate: params.dueDate,
      description: params.description,
      externalReference: params.externalReference,
      postalService: false,
    }),
  })
}

export async function getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
  return asaasFetch<AsaasPixQrCode>(`/payments/${paymentId}/pixQrCode`)
}

export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>(`/payments/${paymentId}`)
}

export async function cancelPayment(paymentId: string): Promise<void> {
  await asaasFetch(`/payments/${paymentId}`, { method: 'DELETE' })
}

// ── Webhook validation ────────────────────────────────────────────────────────

import { safeEqualString } from '@/lib/security/hmac'

/**
 * Compare the inbound Asaas access token to `ASAAS_WEBHOOK_SECRET` in
 * constant time. Asaas signs nothing — it ships a static token in the
 * `asaas-access-token` header — so the only defensive measure we can
 * take is to prevent timing side-channels from leaking the expected
 * secret character by character.
 */
export function validateAsaasWebhookToken(token: string): boolean {
  return safeEqualString(token, process.env.ASAAS_WEBHOOK_SECRET ?? null)
}

// ── Due date helper ───────────────────────────────────────────────────────────

/** Returns a due date string (YYYY-MM-DD) N business days from now */
export function dueDateFromNow(businessDays = 3): string {
  const date = new Date()
  let added = 0
  while (added < businessDays) {
    date.setDate(date.getDate() + 1)
    const day = date.getDay()
    if (day !== 0 && day !== 6) added++
  }
  return date.toISOString().slice(0, 10)
}
