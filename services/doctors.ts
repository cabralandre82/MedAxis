'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { doctorSchema, type DoctorFormData } from '@/lib/validators'
import { encrypt } from '@/lib/crypto'
import type { EntityStatus } from '@/types'

export async function createDoctor(
  data: DoctorFormData,
  options?: { autoLinkClinicId?: string }
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])
    const parsed = doctorSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { data: doctor, error } = await adminClient
      .from('doctors')
      .insert({
        ...parsed.data,
        crm_encrypted: encrypt(parsed.data.crm ?? null),
        status: 'ACTIVE',
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'CRM já cadastrado para este estado' }
      return { error: 'Erro ao criar médico' }
    }

    // CLINIC_ADMIN: auto-link to their clinic (or explicit override)
    const clinicId =
      options?.autoLinkClinicId ??
      (user.roles.includes('CLINIC_ADMIN')
        ? await (async () => {
            const { data: cm } = await adminClient
              .from('clinic_members')
              .select('clinic_id')
              .eq('user_id', user.id)
              .maybeSingle()
            return cm?.clinic_id ?? null
          })()
        : null)

    if (clinicId) {
      await adminClient
        .from('doctor_clinic_links')
        .upsert({ doctor_id: doctor.id, clinic_id: clinicId, is_primary: true })
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.DOCTOR,
      entityId: doctor.id,
      action: AuditAction.CREATE,
      newValues: parsed.data,
    })

    return { id: doctor.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updateDoctor(
  id: string,
  data: Partial<DoctorFormData>
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient.from('doctors').select('*').eq('id', id).single()

    const { error } = await adminClient
      .from('doctors')
      .update({
        ...data,
        ...(data.crm !== undefined ? { crm_encrypted: encrypt(data.crm ?? null) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar médico' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.DOCTOR,
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

export async function updateDoctorStatus(
  id: string,
  status: EntityStatus
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient
      .from('doctors')
      .select('status')
      .eq('id', id)
      .single()

    const { error } = await adminClient
      .from('doctors')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar status' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.DOCTOR,
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

export async function linkDoctorToClinic(
  doctorId: string,
  clinicId: string,
  isPrimary = false
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('doctor_clinic_links')
      .upsert({ doctor_id: doctorId, clinic_id: clinicId, is_primary: isPrimary })

    if (error) return { error: 'Erro ao vincular médico à clínica' }
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}
