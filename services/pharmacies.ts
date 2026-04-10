'use server'

import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { pharmacySchema, type PharmacyFormData } from '@/lib/validators'
import { validateCNPJ } from '@/lib/compliance'
import type { EntityStatus } from '@/types'

export async function createPharmacy(
  data: PharmacyFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = pharmacySchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    // Validate CNPJ before creating pharmacy (fail-open: if API is unavailable, we still allow)
    if (parsed.data.cnpj) {
      const cnpjResult = await validateCNPJ(parsed.data.cnpj)
      if (
        !cnpjResult.valid &&
        cnpjResult.error !== 'rate_limited' &&
        cnpjResult.error !== 'timeout'
      ) {
        return {
          error: `CNPJ inativo na Receita Federal: ${cnpjResult.situation ?? cnpjResult.error}`,
        }
      }
    }

    const adminClient = createAdminClient()
    const { data: pharmacy, error } = await adminClient
      .from('pharmacies')
      .insert({
        ...parsed.data,
        status: 'PENDING',
        cnpj_validated_at: parsed.data.cnpj ? new Date().toISOString() : null,
        cnpj_situation: parsed.data.cnpj ? 'ATIVA' : null,
      })
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

    const { data: existing } = await adminClient
      .from('pharmacies')
      .select('status, cnpj')
      .eq('id', id)
      .single()

    // Re-validate CNPJ when activating a pharmacy
    let cnpjUpdate: Record<string, string | null> = {}
    if (status === 'ACTIVE' && existing?.cnpj) {
      const cnpjResult = await validateCNPJ(existing.cnpj)
      if (
        !cnpjResult.valid &&
        cnpjResult.error !== 'rate_limited' &&
        cnpjResult.error !== 'timeout'
      ) {
        return {
          error: `CNPJ inativo na Receita Federal: ${cnpjResult.situation ?? cnpjResult.error}`,
        }
      }
      cnpjUpdate = {
        cnpj_validated_at: new Date().toISOString(),
        cnpj_situation: cnpjResult.situation ?? 'ATIVA',
      }
    }

    const { error } = await adminClient
      .from('pharmacies')
      .update({ status, updated_at: new Date().toISOString(), ...cnpjUpdate })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar status' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PHARMACY,
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
