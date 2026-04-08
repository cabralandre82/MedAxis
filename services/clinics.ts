'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { clinicSchema, type ClinicFormData } from '@/lib/validators'
import type { EntityStatus } from '@/types'

export async function createClinic(data: ClinicFormData): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = clinicSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { data: clinic, error } = await adminClient
      .from('clinics')
      .insert({ ...parsed.data, status: 'PENDING' })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'CNPJ já cadastrado' }
      return { error: 'Erro ao criar clínica' }
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.CLINIC,
      entityId: clinic.id,
      action: AuditAction.CREATE,
      newValues: parsed.data,
    })

    return { id: clinic.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updateClinic(
  id: string,
  data: Partial<ClinicFormData>
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient.from('clinics').select('*').eq('id', id).single()

    const { error } = await adminClient
      .from('clinics')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar clínica' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.CLINIC,
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

export async function updateClinicStatus(
  id: string,
  status: EntityStatus
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient
      .from('clinics')
      .select('status')
      .eq('id', id)
      .single()

    const { error } = await adminClient
      .from('clinics')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar status' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.CLINIC,
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      oldValues: { status: existing?.status },
      newValues: { status },
    })

    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}
