/**
 * One-shot backfill: generate an Asaas charge for an order whose status
 * is AWAITING_PAYMENT but whose payments row has no asaas_payment_id.
 *
 * Standalone (does NOT import the runtime helper because that file
 * uses `server-only` which is a Next.js bundler-time guard, not a
 * Node module). Mirrors the helper's behaviour: idempotent on
 * existing PENDING Asaas payments, swallows PIX QR failures, updates
 * `payments` row in place when one exists.
 *
 * Usage:
 *   npx tsx scripts/backfill-asaas-charge.ts <orderId>
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ASAAS_API_URL = process.env.ASAAS_API_URL ?? 'https://sandbox.asaas.com/api/v3'
const ASAAS_API_KEY = process.env.ASAAS_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !ASAAS_API_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ASAAS_API_KEY')
  process.exit(1)
}

const supa = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

async function asaas<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', access_token: ASAAS_API_KEY!, ...init?.headers },
  })
  if (!res.ok) throw new Error(`Asaas ${path} → ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

function dueDateFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const orderId = process.argv[2]
  if (!orderId) {
    console.error('Usage: npx tsx scripts/backfill-asaas-charge.ts <orderId>')
    process.exit(1)
  }

  const { data: order, error: orderErr } = await supa
    .from('orders')
    .select('id, code, total_price, clinic_id, clinics(trade_name, cnpj, asaas_customer_id)')
    .eq('id', orderId)
    .single()

  if (orderErr || !order) {
    console.error('Order not found:', orderErr)
    process.exit(1)
  }

  // Resolve clinic billing contact through clinic_members → profiles
  // (no direct FK between clinics and profiles, so the JS client
  // can't do this in one nested select).
  const { data: contactMember } = await supa
    .from('clinic_members')
    .select('profiles(email, phone)')
    .eq('clinic_id', (order as { clinic_id: string }).clinic_id)
    .limit(1)
    .maybeSingle()
  const billingProfile =
    (contactMember as { profiles: { email: string | null; phone: string | null } | null } | null)
      ?.profiles ?? null

  const { data: existingPayment } = await supa
    .from('payments')
    .select(
      'id, asaas_payment_id, asaas_invoice_url, asaas_pix_qr_code, asaas_pix_copy_paste, asaas_boleto_url, payment_due_date, status'
    )
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle()

  if (existingPayment?.asaas_payment_id && existingPayment.status === 'PENDING') {
    console.log('Idempotent — already has Asaas payment:', existingPayment.asaas_payment_id)
    process.exit(0)
  }

  // PostgREST returns nested fk lookups as either an object or array
  // depending on RLS join hints. Normalise to a single object.
  const clinicsRaw = (order as unknown as { clinics: unknown }).clinics
  const clinic = (Array.isArray(clinicsRaw) ? clinicsRaw[0] : clinicsRaw) as {
    trade_name: string
    cnpj: string | null
    asaas_customer_id: string | null
  } | null

  if (!clinic) {
    console.error('Clinic not found for this order')
    process.exit(1)
  }

  let customerId = clinic.asaas_customer_id
  if (!customerId) {
    const search = await asaas<{ data: { id: string }[] }>(
      `/customers?cpfCnpj=${encodeURIComponent(clinic.cnpj ?? '00000000000000')}&limit=1`
    )
    if (search.data.length > 0) {
      customerId = search.data[0].id
    } else {
      const created = await asaas<{ id: string }>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          cpfCnpj: clinic.cnpj ?? '00000000000000',
          name: clinic.trade_name,
          email: billingProfile?.email ?? undefined,
          phone: billingProfile?.phone ?? undefined,
        }),
      })
      customerId = created.id
    }
    await supa
      .from('clinics')
      .update({ asaas_customer_id: customerId })
      .eq('id', (order as { clinic_id: string }).clinic_id)
    console.log('Created Asaas customer:', customerId)
  }

  const dueDate = dueDateFromNow(3)
  const payment = await asaas<{
    id: string
    invoiceUrl: string | null
    bankSlipUrl?: string | null
  }>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'UNDEFINED',
      value: Number(order.total_price),
      dueDate,
      description: `Pedido ${order.code} — Clinipharma`,
      externalReference: orderId,
    }),
  })
  console.log('Created Asaas payment:', payment.id)

  let pixQrCode: string | null = null
  let pixCopyPaste: string | null = null
  try {
    const pix = await asaas<{ encodedImage: string; payload: string }>(
      `/payments/${payment.id}/pixQrCode`
    )
    pixQrCode = pix.encodedImage
    pixCopyPaste = pix.payload
  } catch (err) {
    console.warn('PIX QR not yet available:', (err as Error).message)
  }

  if (existingPayment) {
    await supa
      .from('payments')
      .update({
        asaas_payment_id: payment.id,
        asaas_invoice_url: payment.invoiceUrl,
        asaas_boleto_url: payment.bankSlipUrl ?? null,
        asaas_pix_qr_code: pixQrCode,
        asaas_pix_copy_paste: pixCopyPaste,
        payment_link: payment.invoiceUrl,
        payment_due_date: dueDate,
        payment_method: 'ASAAS',
        status: 'PENDING',
      })
      .eq('id', existingPayment.id)
  } else {
    await supa.from('payments').insert({
      order_id: orderId,
      gross_amount: Number(order.total_price),
      status: 'PENDING',
      payment_method: 'ASAAS',
      asaas_payment_id: payment.id,
      asaas_invoice_url: payment.invoiceUrl,
      asaas_boleto_url: payment.bankSlipUrl ?? null,
      asaas_pix_qr_code: pixQrCode,
      asaas_pix_copy_paste: pixCopyPaste,
      payment_link: payment.invoiceUrl,
      payment_due_date: dueDate,
    })
  }

  console.log('Backfill OK for order', orderId)
  console.log({
    asaasPaymentId: payment.id,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode: pixQrCode ? '(present)' : null,
    dueDate,
  })
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
