import 'server-only'
import { createAdminClient } from '@/lib/db/admin'
import { findOrCreateCustomer, createPayment, getPixQrCode, dueDateFromNow } from '@/lib/asaas'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'

/**
 * Idempotently generate (or refresh) the Asaas charge for an order.
 *
 * Why this lives here
 * -------------------
 * Before 2026-04-29 this exact logic existed only inside
 * `app/api/payments/asaas/create/route.ts`, gated by
 * `requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])`. That meant when the
 * pharmacy approved an order's documents and the status flipped to
 * `AWAITING_PAYMENT`, the clinic had **no way to pay** — the
 * `<PaymentOptions>` component fell into the
 * `if (!isAdmin) return "Aguardando geração da cobrança pelo administrador"`
 * dead-end branch. The clinic was effectively locked out of their
 * own purchase until a human admin clicked a button somewhere.
 *
 * Extracting the work into a server-only helper lets us call it from:
 *
 *   • `services/document-review.ts` — auto-fire when docs are
 *     approved (best-effort; failure does NOT block the status
 *     transition because Asaas might be temporarily down).
 *
 *   • `app/api/payments/asaas/create/route.ts` — keeps existing admin
 *     flow but also lets the clinic admin of the order's clinic
 *     retry from the UI if the auto-trigger missed.
 *
 *   • Future cron / backfill scripts — the backfill that runs once
 *     after this commit lands needs the same behaviour.
 *
 * Idempotency
 * -----------
 * The function detects an existing `payments` row for the order:
 *
 *   - If a row already has `asaas_payment_id` and `status='PENDING'`,
 *     it returns the existing IDs without calling Asaas again. This
 *     is the "user pressed the retry button after auto-trigger
 *     succeeded" case — we don't want duplicate charges in Asaas.
 *
 *   - If the row has no `asaas_payment_id` (manual placeholder
 *     created at order creation time), it calls Asaas and updates
 *     the row in place.
 *
 *   - If no payment row exists yet, it creates one.
 *
 * Failure mode
 * ------------
 * Returns `{ ok: false, error: '...' }` instead of throwing so
 * callers (especially the document-review server action) can decide
 * whether to surface the failure or swallow it. Callers should log
 * `result.error` themselves; this helper does NOT call `logger.error`
 * on its own to avoid double-reporting.
 */

export interface AsaasChargeResult {
  ok: boolean
  asaasPaymentId?: string
  invoiceUrl?: string | null
  pixQrCode?: string | null
  pixCopyPaste?: string | null
  boletoUrl?: string | null
  dueDate?: string
  error?: string
}

export async function generateAsaasChargeForOrder(orderId: string): Promise<AsaasChargeResult> {
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select(
      `id, code, total_price, clinic_id,
       clinics(trade_name, cnpj, asaas_customer_id)`
    )
    .eq('id', orderId)
    .single()

  if (!order) return { ok: false, error: 'Pedido não encontrado' }

  // Resolve a billing contact (email/phone) via clinic_members → profiles.
  // PostgREST cannot do this in one nested select because there is no
  // direct FK between `clinics` and `profiles`. Pre-2026-04-29 the API
  // route had `clinics(profiles(email, phone))` in its select string,
  // which silently returned PGRST200 ("Could not find a relationship")
  // every time — meaning the original "Gerar cobrança" admin button
  // would have produced an Order-not-found 404 to the admin too if
  // anyone had ever clicked it. We fix both surfaces here.
  const { data: contactMember } = await admin
    .from('clinic_members')
    .select('profiles(email, phone)')
    .eq('clinic_id', (order as unknown as { clinic_id: string }).clinic_id)
    .limit(1)
    .maybeSingle()
  const billingProfile =
    (contactMember as { profiles: { email: string | null; phone: string | null } | null } | null)
      ?.profiles ?? null

  // Idempotency check — if we already have an Asaas payment for this
  // order in PENDING state, return its data without re-charging.
  const { data: existingPayment } = await admin
    .from('payments')
    .select(
      'id, asaas_payment_id, asaas_invoice_url, asaas_pix_qr_code, asaas_pix_copy_paste, asaas_boleto_url, payment_due_date, status'
    )
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle()

  if (existingPayment?.asaas_payment_id && existingPayment.status === 'PENDING') {
    return {
      ok: true,
      asaasPaymentId: existingPayment.asaas_payment_id,
      invoiceUrl: existingPayment.asaas_invoice_url,
      pixQrCode: existingPayment.asaas_pix_qr_code,
      pixCopyPaste: existingPayment.asaas_pix_copy_paste,
      boletoUrl: existingPayment.asaas_boleto_url,
      dueDate: existingPayment.payment_due_date ?? undefined,
    }
  }

  const clinic = (
    order as unknown as {
      clinics: {
        trade_name: string
        cnpj: string | null
        asaas_customer_id: string | null
      } | null
    }
  ).clinics

  if (!clinic) return { ok: false, error: 'Clínica não encontrada' }

  let customerId = clinic.asaas_customer_id
  if (!customerId) {
    if (!clinic.cnpj) {
      return {
        ok: false,
        error:
          'CNPJ da clínica não cadastrado. Atualize o CNPJ no perfil da clínica antes de gerar a cobrança.',
      }
    }
    try {
      const customer = await findOrCreateCustomer({
        cpfCnpj: clinic.cnpj,
        name: clinic.trade_name,
        email: billingProfile?.email ?? undefined,
        phone: billingProfile?.phone ?? undefined,
      })
      customerId = customer.id
      await admin
        .from('clinics')
        .update({ asaas_customer_id: customerId })
        .eq('id', (order as unknown as { clinic_id: string }).clinic_id)
    } catch (err) {
      // Asaas returns a structured 400 with `errors[].description`
      // when the CNPJ fails validation. Surface that exact reason so
      // the clinic admin can fix their profile instead of seeing a
      // generic "tente novamente". The 2026-04-29 incident hit
      // exactly this path with the seed clinic's placeholder CNPJ
      // 11.222.333/0001-44, which Asaas production rejects.
      const raw = err instanceof Error ? err.message : String(err)
      const cnpjInvalid = raw.includes('CPF/CNPJ informado é inválido')
      return {
        ok: false,
        error: cnpjInvalid
          ? `CNPJ ${clinic.cnpj} é inválido segundo o Asaas. Atualize o CNPJ no perfil da clínica.`
          : `Falha ao registrar cliente no Asaas: ${raw}`,
      }
    }
  }

  const dueDate = dueDateFromNow(3)
  const description = `Pedido ${order.code} — Clinipharma`

  let payment
  try {
    payment = await createPayment({
      customerId,
      value: Number(order.total_price),
      dueDate,
      description,
      externalReference: orderId,
    })
  } catch (err) {
    return {
      ok: false,
      error: `Falha ao criar cobrança no Asaas: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
    }
  }

  // PIX may not be immediately available in Asaas — clients can retry,
  // and the row is fine without it (boleto + card invoice link still
  // work). Failure here is non-fatal.
  let pixQrCode: string | null = null
  let pixCopyPaste: string | null = null
  try {
    const pix = await getPixQrCode(payment.id)
    pixQrCode = pix.encodedImage
    pixCopyPaste = pix.payload
  } catch {
    // swallow — see comment above
  }

  if (existingPayment) {
    await admin
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
    await admin.from('payments').insert({
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

  // Push a notification so the clinic sees a fresh badge on /orders
  // and can act without revisiting the page that already led them here.
  // Best-effort — failures are logged but don't fail the charge.
  try {
    const { data: clinicMember } = await admin
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', (order as unknown as { clinic_id: string }).clinic_id)
      .limit(1)
      .maybeSingle()
    if (clinicMember) {
      await createNotification({
        userId: clinicMember.user_id,
        type: 'ORDER_STATUS',
        title: `Pagamento disponível — Pedido ${order.code}`,
        message: `Escolha PIX, boleto ou cartão para pagar o pedido ${order.code}. Vencimento: ${dueDate}.`,
        link: `/orders/${orderId}`,
      })
    }
  } catch (err) {
    logger.error('[generateAsaasCharge] failed to notify clinic member', {
      orderId,
      error: err,
    })
  }

  return {
    ok: true,
    asaasPaymentId: payment.id,
    invoiceUrl: payment.invoiceUrl,
    pixQrCode,
    pixCopyPaste,
    boletoUrl: payment.bankSlipUrl ?? null,
    dueDate,
  }
}
