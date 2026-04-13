'use server'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { createNotification } from '@/lib/notifications'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { addBusinessDays } from '@/lib/utils'

// ─── Review a single document (PHARMACY_ADMIN only) ──────────────────────────

export async function reviewDocument(
  documentId: string,
  decision: 'APPROVED' | 'REJECTED',
  rejectionReason?: string
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])
    const admin = createAdminClient()

    if (decision === 'REJECTED' && !rejectionReason?.trim()) {
      return { error: 'Informe o motivo da rejeição' }
    }

    // Fetch document + order
    const { data: doc } = await admin
      .from('order_documents')
      .select('id, order_id, order_items_id')
      .eq('id', documentId)
      .single()

    if (!doc) return { error: 'Documento não encontrado' }

    const { data: order } = await admin
      .from('orders')
      .select('id, order_status, clinic_id, pharmacy_id, created_by_user_id')
      .eq('id', doc.order_id)
      .single()

    if (!order) return { error: 'Pedido não encontrado' }
    if (order.order_status !== 'READY_FOR_REVIEW') {
      return { error: 'Pedido não está em revisão' }
    }

    // PHARMACY_ADMIN must belong to this order's pharmacy
    if (actor.roles.includes('PHARMACY_ADMIN')) {
      const { data: member } = await admin
        .from('pharmacy_members')
        .select('user_id')
        .eq('pharmacy_id', order.pharmacy_id)
        .eq('user_id', actor.id)
        .maybeSingle()
      if (!member) return { error: 'Sem permissão: pedido pertence a outra farmácia' }
    }

    // Update document status
    await admin
      .from('order_documents')
      .update({
        status: decision,
        rejection_reason: decision === 'REJECTED' ? rejectionReason : null,
        reviewed_by_user_id: actor.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: doc.order_id,
      action: AuditAction.UPDATE,
      newValues: { document_id: documentId, decision, rejectionReason },
    })

    // After any review action, re-evaluate the whole order
    await evaluateOrderDocuments(doc.order_id, actor.id)

    return {}
  } catch (err) {
    logger.error('[reviewDocument] error', { error: err })
    return { error: 'Erro interno' }
  }
}

// ─── Core logic: evaluate all docs/items and advance or block the order ──────

export async function evaluateOrderDocuments(orderId: string, actorUserId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, order_status, clinic_id, created_by_user_id')
    .eq('id', orderId)
    .single()

  if (!order) return

  // Fetch all items and their required prescription flag
  const { data: items } = await admin
    .from('order_items')
    .select('id, product_id, doc_status, products(requires_prescription)')
    .eq('order_id', orderId)

  if (!items?.length) return

  // Fetch all documents for this order
  const { data: docs } = await admin
    .from('order_documents')
    .select('id, status, rejection_reason')
    .eq('order_id', orderId)

  const hasRejected = docs?.some((d) => d.status === 'REJECTED') ?? false
  const hasPending = docs?.some((d) => d.status === 'PENDING') ?? false

  // Determine per-item doc_status
  // Items that require prescription: need at least one APPROVED PRESCRIPTION doc
  // Items that don't require prescription: always OK
  const { data: prescriptionDocs } = await admin
    .from('order_documents')
    .select('id, status')
    .eq('order_id', orderId)
    .eq('document_type', 'PRESCRIPTION')

  const hasApprovedPrescription = prescriptionDocs?.some((d) => d.status === 'APPROVED') ?? false
  const hasRejectedPrescription = prescriptionDocs?.some((d) => d.status === 'REJECTED') ?? false
  const noPrescriptionDocs = !prescriptionDocs?.length

  for (const item of items) {
    const requiresRx =
      (item.products as unknown as { requires_prescription: boolean } | null)
        ?.requires_prescription ?? false

    let newDocStatus: 'OK' | 'PENDING_DOCS' | 'REJECTED_DOCS' = 'OK'

    if (requiresRx) {
      if (hasApprovedPrescription) {
        newDocStatus = 'OK'
      } else if (hasRejectedPrescription) {
        newDocStatus = 'REJECTED_DOCS'
      } else if (noPrescriptionDocs || hasPending) {
        newDocStatus = 'PENDING_DOCS'
      }
    }

    if (newDocStatus !== item.doc_status) {
      await admin.from('order_items').update({ doc_status: newDocStatus }).eq('id', item.id)
    }
  }

  // Re-fetch updated items
  const { data: updatedItems } = await admin
    .from('order_items')
    .select('id, doc_status')
    .eq('order_id', orderId)

  const allOk = updatedItems?.every((i) => i.doc_status === 'OK') ?? false
  const anyRejected = updatedItems?.some((i) => i.doc_status === 'REJECTED_DOCS') ?? false

  if (allOk && order.order_status === 'READY_FOR_REVIEW') {
    // Advance to AWAITING_PAYMENT
    await admin
      .from('orders')
      .update({ order_status: 'AWAITING_PAYMENT', updated_at: new Date().toISOString() })
      .eq('id', orderId)

    await admin.from('order_status_history').insert({
      order_id: orderId,
      old_status: 'READY_FOR_REVIEW',
      new_status: 'AWAITING_PAYMENT',
      changed_by_user_id: actorUserId,
      reason: 'Documentação aprovada pela farmácia',
    })

    // Notify clinic
    await createNotification({
      userId: order.created_by_user_id,
      type: 'ORDER_STATUS',
      title: 'Documentação aprovada',
      body: 'Seu pedido foi aprovado e está aguardando pagamento.',
      link: `/orders/${orderId}`,
      push: true,
    })
  } else if (anyRejected && order.order_status === 'READY_FOR_REVIEW') {
    // Block order — set deadline 3 business days from now
    const deadline = addBusinessDays(new Date(), 3)

    await admin
      .from('orders')
      .update({
        order_status: 'AWAITING_DOCUMENTS',
        docs_deadline: deadline.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)

    await admin.from('order_status_history').insert({
      order_id: orderId,
      old_status: 'READY_FOR_REVIEW',
      new_status: 'AWAITING_DOCUMENTS',
      changed_by_user_id: actorUserId,
      reason: 'Documentação rejeitada pela farmácia — aguardando reenvio',
    })

    // Build rejection summary per item for the notification
    const rejectedDocs = docs?.filter((d) => d.status === 'REJECTED') ?? []
    const reasons = rejectedDocs
      .map((d) => d.rejection_reason)
      .filter(Boolean)
      .join('; ')

    await createNotification({
      userId: order.created_by_user_id,
      type: 'ORDER_STATUS',
      title: 'Documentação rejeitada — reenvio necessário',
      body: reasons
        ? `Motivo(s): ${reasons}. Prazo: ${deadline.toLocaleDateString('pt-BR')}.`
        : `Reenvie os documentos até ${deadline.toLocaleDateString('pt-BR')}.`,
      link: `/orders/${orderId}`,
      push: true,
    })
  }
}

// ─── Remove an item from the order (CLINIC_ADMIN only, while AWAITING_DOCUMENTS) ─

export async function removeOrderItem(
  orderId: string,
  itemId: string
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])
    const admin = createAdminClient()

    const { data: order } = await admin
      .from('orders')
      .select('id, order_status, clinic_id, created_by_user_id')
      .eq('id', orderId)
      .single()

    if (!order) return { error: 'Pedido não encontrado' }
    if (order.order_status !== 'AWAITING_DOCUMENTS') {
      return { error: 'Itens só podem ser removidos enquanto o pedido aguarda documentação' }
    }

    // CLINIC_ADMIN must belong to this order's clinic
    if (actor.roles.includes('CLINIC_ADMIN')) {
      const { data: member } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', order.clinic_id)
        .eq('user_id', actor.id)
        .maybeSingle()
      if (!member) return { error: 'Sem permissão' }
    }

    // Verify item belongs to this order and is rejected
    const { data: item } = await admin
      .from('order_items')
      .select('id, doc_status')
      .eq('id', itemId)
      .eq('order_id', orderId)
      .single()

    if (!item) return { error: 'Item não encontrado' }
    if (item.doc_status !== 'REJECTED_DOCS') {
      return { error: 'Apenas itens com documentação rejeitada podem ser removidos' }
    }

    // Count remaining items before delete
    const { count } = await admin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)

    if ((count ?? 0) <= 1) {
      // Last item — cancel the order
      await admin
        .from('orders')
        .update({ order_status: 'CANCELED', updated_at: new Date().toISOString() })
        .eq('id', orderId)

      await admin.from('order_status_history').insert({
        order_id: orderId,
        old_status: 'AWAITING_DOCUMENTS',
        new_status: 'CANCELED',
        changed_by_user_id: actor.id,
        reason: 'Pedido cancelado: todos os itens foram removidos pela clínica',
      })

      await createAuditLog({
        actorUserId: actor.id,
        actorRole: actor.roles[0],
        entityType: AuditEntity.ORDER,
        entityId: orderId,
        action: AuditAction.STATUS_CHANGE,
        oldValues: { status: 'AWAITING_DOCUMENTS' },
        newValues: { status: 'CANCELED', reason: 'all items removed' },
      })

      return {}
    }

    // Delete the item (trigger recalc_order_total fires automatically)
    await admin.from('order_items').delete().eq('id', itemId)

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: orderId,
      action: AuditAction.UPDATE,
      newValues: { removed_item_id: itemId },
    })

    // Re-evaluate: if remaining items are all OK, advance to READY_FOR_REVIEW
    await evaluateOrderDocuments(orderId, actor.id)

    return {}
  } catch (err) {
    logger.error('[removeOrderItem] error', { error: err })
    return { error: 'Erro interno' }
  }
}
