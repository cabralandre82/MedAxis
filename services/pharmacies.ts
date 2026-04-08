'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { pharmacySchema, type PharmacyFormData } from '@/lib/validators'
import type { EntityStatus } from '@/types'

export async function createPharmacy(
  data: PharmacyFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = pharmacySchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { data: pharmacy, error } = await adminClient
      .from('pharmacies')
      .insert({ ...parsed.data, status: 'PENDING' })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'CNPJ já cadastrado' }
      return { error: 'Erro ao criar farmácia' }
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PHARMACY,
      entityId: pharmacy.id,
      action: AuditAction.CREATE,
      newValues: parsed.data,
    })

    return { id: pharmacy.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updatePharmacy(
  id: string,
  data: Partial<PharmacyFormData>
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient
      .from('pharmacies')
      .select('*')
      .eq('id', id)
      .single()

    const { error } = await adminClient
      .from('pharmacies')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar farmácia' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PHARMACY,
      entityId: id,
      action: AuditAction.UPDATE,
      oldValues: existing ?? undefined,
      newValues: data,
    })

    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function updatePharmacyStatus(
  id: string,
  status: EntityStatus
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    await adminClient
      .from('pharmacies')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PHARMACY,
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      newValues: { status },
    })

    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}
