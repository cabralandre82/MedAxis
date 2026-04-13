/**
 * Prescription enforcement rules.
 *
 * Pure business logic — no HTTP, no UI. Callable from:
 *   - API route /api/orders/[id]/advance (blocks status transition)
 *   - canPlaceOrder (informational — decides initial status)
 *   - UI (derives display state from the same model)
 *
 * Two prescription models coexist:
 *
 *   Model A — Simple (max_units_per_prescription IS NULL)
 *     One document in order_documents with type='PRESCRIPTION' satisfies
 *     any quantity of that product. The receipt may list multiple items.
 *
 *   Model B — Per-unit (max_units_per_prescription = N, typically 1)
 *     sum(order_item_prescriptions.units_covered) must be >= order_item.quantity
 *     for the item to be considered satisfied.
 *     Example: quantity=5, max_units=1 → 5 separate prescriptions required.
 *     Example: quantity=5, max_units=2 → ceil(5/2) = 3 prescriptions required.
 */

import { createAdminClient } from '@/lib/db/admin'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrescriptionProduct {
  id: string
  name: string
  requires_prescription: boolean
  prescription_type: string | null
  max_units_per_prescription: number | null
}

export interface OrderItemPrescriptionState {
  order_item_id: string
  product_id: string
  product_name: string
  quantity: number
  requires_prescription: boolean
  prescription_type: string | null
  /** null = Model A (simple receipt, handled in order_documents) */
  max_units_per_prescription: number | null
  /** How many prescription docs have been uploaded for this item */
  prescriptions_uploaded: number
  /** How many units those prescriptions cover */
  units_covered: number
  /** How many more prescriptions are needed */
  prescriptions_needed: number
  satisfied: boolean
}

export interface PrescriptionRequirementResult {
  /** True if the order can advance from AWAITING_DOCUMENTS */
  met: boolean
  /** True if ANY item requires a prescription (either model) */
  anyRequiresPrescription: boolean
  /** True if at least one item uses Model A (simple, order-level document) */
  needsSimplePrescription: boolean
  /** True if at least one item uses Model B (per-unit document) */
  needsPerUnitPrescription: boolean
  /** Per-item breakdown for UI rendering */
  items: OrderItemPrescriptionState[]
  /** Human-readable explanation when met=false */
  reason?: string
}

// ── Core query ────────────────────────────────────────────────────────────────

/**
 * Evaluate whether an order has met all prescription upload requirements.
 * Checks both Model A and Model B items in a single DB round-trip per query.
 */
export async function getPrescriptionState(
  orderId: string
): Promise<PrescriptionRequirementResult> {
  const admin = createAdminClient()

  // Fetch order items with product prescription config
  const { data: items, error: itemsErr } = await admin
    .from('order_items')
    .select(
      `id, quantity, product_id,
       products (
         id, name,
         requires_prescription,
         prescription_type,
         max_units_per_prescription
       )`
    )
    .eq('order_id', orderId)

  if (itemsErr || !items) {
    return {
      met: false,
      anyRequiresPrescription: false,
      needsSimplePrescription: false,
      needsPerUnitPrescription: false,
      items: [],
      reason: 'Erro ao verificar itens do pedido',
    }
  }

  // Fetch per-unit prescriptions already uploaded for this order
  const { data: perUnitDocs } = await admin
    .from('order_item_prescriptions')
    .select('order_item_id, units_covered')
    .eq('order_id', orderId)

  // Fetch simple prescriptions (order_documents with type PRESCRIPTION)
  const { data: simpleDocs } = await admin
    .from('order_documents')
    .select('id')
    .eq('order_id', orderId)
    .eq('document_type', 'PRESCRIPTION')

  const hasSimpleDoc = (simpleDocs?.length ?? 0) > 0

  // Aggregate units_covered per order_item_id
  const unitsCoveredMap = new Map<string, { count: number; units: number }>()
  for (const doc of perUnitDocs ?? []) {
    const prev = unitsCoveredMap.get(doc.order_item_id) ?? { count: 0, units: 0 }
    unitsCoveredMap.set(doc.order_item_id, {
      count: prev.count + 1,
      units: prev.units + doc.units_covered,
    })
  }

  // Build per-item state
  const itemStates: OrderItemPrescriptionState[] = []
  let anyRequiresPrescription = false
  let needsSimplePrescription = false
  let needsPerUnitPrescription = false
  let allSatisfied = true

  for (const item of items) {
    const product = item.products as unknown as PrescriptionProduct | null
    if (!product) continue

    if (!product.requires_prescription) {
      itemStates.push({
        order_item_id: item.id,
        product_id: item.product_id,
        product_name: product.name,
        quantity: item.quantity,
        requires_prescription: false,
        prescription_type: null,
        max_units_per_prescription: null,
        prescriptions_uploaded: 0,
        units_covered: 0,
        prescriptions_needed: 0,
        satisfied: true,
      })
      continue
    }

    anyRequiresPrescription = true
    const maxUnits = product.max_units_per_prescription

    if (maxUnits === null) {
      // Model A: simple prescription (one doc for the whole item)
      needsSimplePrescription = true
      const satisfied = hasSimpleDoc
      if (!satisfied) allSatisfied = false
      itemStates.push({
        order_item_id: item.id,
        product_id: item.product_id,
        product_name: product.name,
        quantity: item.quantity,
        requires_prescription: true,
        prescription_type: product.prescription_type,
        max_units_per_prescription: null,
        prescriptions_uploaded: hasSimpleDoc ? 1 : 0,
        units_covered: hasSimpleDoc ? item.quantity : 0,
        prescriptions_needed: hasSimpleDoc ? 0 : 1,
        satisfied,
      })
    } else {
      // Model B: per-unit prescriptions
      needsPerUnitPrescription = true
      const uploaded = unitsCoveredMap.get(item.id) ?? { count: 0, units: 0 }
      // How many prescriptions needed: ceil(quantity / maxUnits)
      const prescriptionsNeeded = Math.ceil(item.quantity / maxUnits)
      const satisfied = uploaded.units >= item.quantity
      if (!satisfied) allSatisfied = false
      itemStates.push({
        order_item_id: item.id,
        product_id: item.product_id,
        product_name: product.name,
        quantity: item.quantity,
        requires_prescription: true,
        prescription_type: product.prescription_type,
        max_units_per_prescription: maxUnits,
        prescriptions_uploaded: uploaded.count,
        units_covered: uploaded.units,
        prescriptions_needed: Math.max(0, prescriptionsNeeded - uploaded.count),
        satisfied,
      })
    }
  }

  if (!anyRequiresPrescription) {
    return {
      met: true,
      anyRequiresPrescription: false,
      needsSimplePrescription: false,
      needsPerUnitPrescription: false,
      items: itemStates,
    }
  }

  // Build human-readable reason for UI / blocking message
  let reason: string | undefined
  if (!allSatisfied) {
    const unsatisfied = itemStates.filter((i) => i.requires_prescription && !i.satisfied)
    const parts = unsatisfied.map((i) => {
      if (i.max_units_per_prescription === null) {
        return `"${i.product_name}": receita não enviada`
      }
      return `"${i.product_name}": ${i.prescriptions_needed} receita(s) faltando (${i.units_covered}/${i.quantity} unidades cobertas)`
    })
    reason = parts.join('; ')
  }

  return {
    met: allSatisfied,
    anyRequiresPrescription,
    needsSimplePrescription,
    needsPerUnitPrescription,
    items: itemStates,
    reason,
  }
}

/**
 * Lightweight boolean check — use in status transition guards.
 */
export async function isPrescriptionRequirementMet(orderId: string): Promise<boolean> {
  const result = await getPrescriptionState(orderId)
  return result.met
}
