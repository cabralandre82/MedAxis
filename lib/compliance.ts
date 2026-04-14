/**
 * Compliance Engine — validates business rules that have regulatory implications.
 *
 * Key functions:
 *  - validateCNPJ(): checks if a CNPJ is active via public ReceitaWS API
 *  - canPlaceOrder(): verifies all pre-conditions before an order can be placed
 *  - canAcceptOrder(): verifies pre-conditions before a pharmacy accepts/advances an order
 *
 * CNPJ-blocked items (when company registration is obtained):
 *  - ANVISA API integration for pharmacy operating license validation
 *  - NF-e pre-validation
 */

import { createAdminClient } from '@/lib/db/admin'

// ── CNPJ Validation via ReceitaWS ────────────────────────────────────────────

export interface CNPJValidationResult {
  valid: boolean
  situation?: string
  name?: string
  error?: string
}

/**
 * Validate a CNPJ against the public ReceitaWS API.
 * Does not require any API key. Rate limit: ~3 req/min per IP.
 *
 * Situations that pass: 'ATIVA'
 * Situations that fail: 'BAIXADA', 'SUSPENSA', 'INAPTA', 'NULA'
 */
export async function validateCNPJ(cnpj: string): Promise<CNPJValidationResult> {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) {
    return { valid: false, error: 'CNPJ deve ter 14 dígitos' }
  }

  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${digits}`, {
      headers: { Accept: 'application/json' },
      // 10-second timeout — don't block user flows for too long
      signal: AbortSignal.timeout(10_000),
    })

    if (res.status === 429) {
      // Rate limited — fail open to avoid blocking legitimate operations
      console.warn('[compliance] ReceitaWS rate limited — failing open')
      return { valid: true, situation: 'UNKNOWN', error: 'rate_limited' }
    }

    if (!res.ok) {
      return { valid: false, error: `ReceitaWS error: ${res.status}` }
    }

    const data = await res.json()

    if (data.status === 'ERROR') {
      return { valid: false, error: data.message ?? 'CNPJ não encontrado' }
    }

    const situation: string = data.situacao ?? ''
    const isActive = situation.toUpperCase() === 'ATIVA'

    return {
      valid: isActive,
      situation,
      name: data.nome,
      error: isActive ? undefined : `Situação CNPJ: ${situation}`,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      // Fail open on timeout to not block order flows
      console.warn('[compliance] ReceitaWS timeout — failing open')
      return { valid: true, situation: 'TIMEOUT', error: 'timeout' }
    }
    console.error('[compliance] validateCNPJ error:', err)
    // Fail open on unexpected errors
    return { valid: true, situation: 'UNKNOWN', error: String(err) }
  }
}

// ── Order placement pre-conditions ───────────────────────────────────────────

export interface ComplianceCheckResult {
  allowed: boolean
  reason?: string
  /** True if ANY item in the order requires a prescription upload. Informational only — order is still created. */
  requiresPrescription?: boolean
  /** True if any product uses per-unit prescription (max_units_per_prescription is set). */
  requiresPerUnitPrescription?: boolean
}

/**
 * Verify all pre-conditions before allowing an order to be placed.
 *
 * Checks:
 *  1. Clinic exists and status is ACTIVE
 *  2. Pharmacy exists and status is ACTIVE
 *  3. Pharmacy CNPJ is valid (if last validation is > 7 days old, re-validates)
 *  4. Product is active and belongs to the pharmacy
 */
export async function canPlaceOrder(
  clinicId: string | null,
  pharmacyId: string,
  productId?: string,
  buyerType: 'CLINIC' | 'DOCTOR' = 'CLINIC'
): Promise<ComplianceCheckResult> {
  const admin = createAdminClient()

  // 1. Check clinic — skipped for solo doctor purchases
  if (buyerType === 'CLINIC') {
    if (!clinicId) return { allowed: false, reason: 'Clínica não informada' }

    const { data: clinic } = await admin
      .from('clinics')
      .select('id, status')
      .eq('id', clinicId)
      .single()

    if (!clinic) return { allowed: false, reason: 'Clínica não encontrada' }
    if (clinic.status !== 'ACTIVE') return { allowed: false, reason: 'Clínica não está ativa' }
  }

  // 2. Check pharmacy
  const { data: pharmacy } = await admin
    .from('pharmacies')
    .select('id, status, cnpj, cnpj_validated_at, cnpj_situation')
    .eq('id', pharmacyId)
    .single()

  if (!pharmacy) return { allowed: false, reason: 'Farmácia não encontrada' }
  if (pharmacy.status !== 'ACTIVE') return { allowed: false, reason: 'Farmácia não está ativa' }

  // 3. Re-validate pharmacy CNPJ if it's stale (> 7 days) or never validated
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const needsRevalidation = !pharmacy.cnpj_validated_at || pharmacy.cnpj_validated_at < sevenDaysAgo

  if (needsRevalidation && pharmacy.cnpj) {
    const result = await validateCNPJ(pharmacy.cnpj)
    // Update validated_at regardless of result (to avoid hammering the API)
    await admin
      .from('pharmacies')
      .update({
        cnpj_validated_at: new Date().toISOString(),
        cnpj_situation: result.situation ?? 'UNKNOWN',
      })
      .eq('id', pharmacyId)

    if (!result.valid && result.error !== 'rate_limited' && result.error !== 'timeout') {
      return { allowed: false, reason: `CNPJ da farmácia inativo: ${result.situation}` }
    }
  } else if (
    pharmacy.cnpj_situation &&
    pharmacy.cnpj_situation !== 'ATIVA' &&
    pharmacy.cnpj_situation !== 'UNKNOWN' &&
    pharmacy.cnpj_situation !== 'TIMEOUT'
  ) {
    return {
      allowed: false,
      reason: `CNPJ da farmácia com situação irregular: ${pharmacy.cnpj_situation}`,
    }
  }

  // 4. Check product (if provided)
  let requiresPrescription = false
  let requiresPerUnitPrescription = false

  if (productId) {
    const { data: product } = await admin
      .from('products')
      .select('id, active, pharmacy_id, requires_prescription, max_units_per_prescription')
      .eq('id', productId)
      .single()

    if (!product) return { allowed: false, reason: 'Produto não encontrado' }
    if (!product.active) return { allowed: false, reason: 'Produto indisponível' }
    if (product.pharmacy_id !== pharmacyId) {
      return { allowed: false, reason: 'Produto não pertence à farmácia selecionada' }
    }

    requiresPrescription = product.requires_prescription ?? false
    requiresPerUnitPrescription = requiresPrescription && product.max_units_per_prescription != null
  }

  return { allowed: true, requiresPrescription, requiresPerUnitPrescription }
}

/**
 * Verify pre-conditions before a pharmacy can advance an order status.
 * Lighter check — mainly confirms the pharmacy is still active.
 */
export async function canAcceptOrder(orderId: string): Promise<ComplianceCheckResult> {
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, order_status, pharmacy_id, pharmacies(status)')
    .eq('id', orderId)
    .single()

  if (!order) return { allowed: false, reason: 'Pedido não encontrado' }

  const pharmacy = order.pharmacies as unknown as { status: string } | null
  if (!pharmacy) return { allowed: false, reason: 'Farmácia do pedido não encontrada' }
  if (pharmacy.status !== 'ACTIVE') {
    return { allowed: false, reason: 'Farmácia não está ativa — não pode avançar pedidos' }
  }

  if (['COMPLETED', 'CANCELED', 'DELIVERED'].includes(order.order_status)) {
    return { allowed: false, reason: `Pedido já está em estado final: ${order.order_status}` }
  }

  return { allowed: true }
}
