'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { salesConsultantSchema, type SalesConsultantFormData } from '@/lib/validators'
import { sendEmail } from '@/lib/email'
import { consultantTransferEmail } from '@/lib/email/templates'
import { formatCurrency } from '@/lib/utils'

// ─── Create ────────────────────────────────────────────────────────────────

export async function createConsultant(
  data: SalesConsultantFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const parsed = salesConsultantSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { data: consultant, error } = await adminClient
      .from('sales_consultants')
      .insert({ ...parsed.data, status: 'ACTIVE' })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        if (error.message.includes('cnpj')) return { error: 'CNPJ já cadastrado' }
        if (error.message.includes('email')) return { error: 'Email já cadastrado' }
      }
      return { error: 'Erro ao criar consultor' }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: consultant.id,
      action: AuditAction.CREATE,
      newValues: { ...parsed.data, entity: 'sales_consultant' },
    })

    revalidatePath('/consultants')
    return { id: consultant.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    console.error('createConsultant error:', err)
    return { error: 'Erro interno' }
  }
}

// ─── Update ────────────────────────────────────────────────────────────────

export async function updateConsultant(
  id: string,
  data: SalesConsultantFormData
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const parsed = salesConsultantSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('sales_consultants')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar consultor' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: id,
      action: AuditAction.UPDATE,
      newValues: { ...parsed.data, entity: 'sales_consultant' },
    })

    revalidatePath('/consultants')
    revalidatePath(`/consultants/${id}`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── Status ────────────────────────────────────────────────────────────────

export async function updateConsultantStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('sales_consultants')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar status' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: id,
      action: AuditAction.UPDATE,
      newValues: { status, entity: 'sales_consultant' },
    })

    revalidatePath('/consultants')
    revalidatePath(`/consultants/${id}`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── Link user account ─────────────────────────────────────────────────────

export async function linkConsultantUser(
  consultantId: string,
  userId: string
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('sales_consultants')
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq('id', consultantId)

    if (error) return { error: 'Erro ao vincular usuário' }

    revalidatePath(`/consultants/${consultantId}`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── Assign consultant to clinic ───────────────────────────────────────────

export async function assignConsultantToClinic(
  clinicId: string,
  consultantId: string | null
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('clinics')
      .update({ consultant_id: consultantId, updated_at: new Date().toISOString() })
      .eq('id', clinicId)

    if (error) return { error: 'Erro ao vincular consultor à clínica' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.CLINIC,
      entityId: clinicId,
      action: AuditAction.UPDATE,
      newValues: { consultant_id: consultantId },
    })

    revalidatePath(`/clinics/${clinicId}`)
    revalidatePath('/clinics')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── Register consultant transfer (batch) ──────────────────────────────────

export async function registerConsultantTransfer(
  consultantId: string,
  commissionIds: string[],
  transferReference: string,
  notes?: string
): Promise<{ id?: string; error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    if (!commissionIds.length) return { error: 'Nenhuma comissão selecionada' }

    const adminClient = createAdminClient()

    // Sum pending commissions
    const { data: commissions, error: fetchErr } = await adminClient
      .from('consultant_commissions')
      .select('id, commission_amount')
      .in('id', commissionIds)
      .eq('consultant_id', consultantId)
      .eq('status', 'PENDING')

    if (fetchErr || !commissions?.length) return { error: 'Comissões não encontradas ou já pagas' }

    const grossAmount = commissions.reduce((sum, c) => sum + Number(c.commission_amount), 0)

    // Create transfer
    const { data: transfer, error: transferErr } = await adminClient
      .from('consultant_transfers')
      .insert({
        consultant_id: consultantId,
        gross_amount: Math.round(grossAmount * 100) / 100,
        transfer_reference: transferReference,
        transfer_date: new Date().toISOString(),
        notes: notes ?? null,
        status: 'COMPLETED',
        confirmed_by: actor.id,
        confirmed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (transferErr || !transfer) return { error: 'Erro ao registrar repasse' }

    // Mark commissions as PAID and link to transfer
    await adminClient
      .from('consultant_commissions')
      .update({
        status: 'PAID',
        transfer_id: transfer.id,
        updated_at: new Date().toISOString(),
      })
      .in('id', commissionIds)

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.TRANSFER,
      entityId: transfer.id,
      action: AuditAction.TRANSFER_REGISTERED,
      newValues: {
        consultant_id: consultantId,
        gross_amount: grossAmount,
        commission_count: commissions.length,
        reference: transferReference,
      },
    })

    // Notify consultant
    try {
      const { data: consultant } = await adminClient
        .from('sales_consultants')
        .select('email, full_name')
        .eq('id', consultantId)
        .single()

      if (consultant?.email) {
        const tmpl = consultantTransferEmail({
          consultantName: consultant.full_name,
          totalAmount: formatCurrency(grossAmount),
          reference: transferReference,
          commissionCount: commissions.length,
        })
        await sendEmail({ to: consultant.email, ...tmpl })
      }
    } catch {
      // email failure must not affect transfer registration
    }

    revalidatePath('/consultant-transfers')
    revalidatePath(`/consultants/${consultantId}`)
    return { id: transfer.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    console.error('registerConsultantTransfer error:', err)
    return { error: 'Erro interno' }
  }
}
