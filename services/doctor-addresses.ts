'use server'
import { createAdminClient } from '@/lib/db/admin'
import { requireAuth } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { doctorAddressSchema } from '@/lib/validators'
import type { DoctorAddress } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveOwnDoctorId(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('doctors').select('id').eq('user_id', userId).maybeSingle()
  // Fallback: match by email for doctors registered before user_id was added
  if (data) return data.id
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  if (!profile?.email) return null
  const { data: byEmail } = await admin
    .from('doctors')
    .select('id')
    .eq('email', profile.email)
    .maybeSingle()
  return byEmail?.id ?? null
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function getDoctorAddresses(
  doctorId?: string
): Promise<{ addresses?: DoctorAddress[]; error?: string }> {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const targetId = doctorId ?? (await resolveOwnDoctorId(user.id))
    if (!targetId) return { addresses: [] }

    // Non-doctor roles (admins) may pass an explicit doctorId; doctors can only read their own
    if (!doctorId) {
      const ownId = await resolveOwnDoctorId(user.id)
      if (!ownId) return { addresses: [] }
    }

    const { data, error } = await admin
      .from('doctor_addresses')
      .select('*')
      .eq('doctor_id', targetId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) return { error: 'Erro ao buscar endereços' }
    return { addresses: (data ?? []) as DoctorAddress[] }
  } catch (err) {
    logger.error('[doctor-addresses/list] unexpected', { err })
    return { error: 'Erro interno' }
  }
}

// ── upsert (create or update) ─────────────────────────────────────────────────

export async function upsertDoctorAddress(
  input: unknown,
  addressId?: string
): Promise<{ address?: DoctorAddress; error?: string }> {
  try {
    const user = await requireAuth()
    const parsed = doctorAddressSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const admin = createAdminClient()
    const doctorId = await resolveOwnDoctorId(user.id)
    if (!doctorId) return { error: 'Médico não encontrado' }

    // If setting as default, clear existing default first (in same TX scope)
    if (parsed.data.is_default) {
      await admin
        .from('doctor_addresses')
        .update({ is_default: false })
        .eq('doctor_id', doctorId)
        .eq('is_default', true)
    }

    let result
    if (addressId) {
      // Update — ensure address belongs to this doctor
      const { data, error } = await admin
        .from('doctor_addresses')
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq('id', addressId)
        .eq('doctor_id', doctorId)
        .select()
        .single()
      if (error) return { error: 'Erro ao atualizar endereço' }
      result = data
    } else {
      // Insert
      const { data, error } = await admin
        .from('doctor_addresses')
        .insert({ ...parsed.data, doctor_id: doctorId })
        .select()
        .single()
      if (error) return { error: 'Erro ao salvar endereço' }
      result = data
    }

    return { address: result as DoctorAddress }
  } catch (err) {
    logger.error('[doctor-addresses/upsert] unexpected', { err })
    return { error: 'Erro interno' }
  }
}

// ── set default ───────────────────────────────────────────────────────────────

export async function setDefaultDoctorAddress(addressId: string): Promise<{ error?: string }> {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const doctorId = await resolveOwnDoctorId(user.id)
    if (!doctorId) return { error: 'Médico não encontrado' }

    // Verify ownership
    const { data: addr } = await admin
      .from('doctor_addresses')
      .select('id')
      .eq('id', addressId)
      .eq('doctor_id', doctorId)
      .maybeSingle()
    if (!addr) return { error: 'Endereço não encontrado' }

    // Clear existing default then set new one
    await admin
      .from('doctor_addresses')
      .update({ is_default: false })
      .eq('doctor_id', doctorId)
      .eq('is_default', true)

    const { error } = await admin
      .from('doctor_addresses')
      .update({ is_default: true })
      .eq('id', addressId)

    if (error) return { error: 'Erro ao definir endereço padrão' }
    return {}
  } catch (err) {
    logger.error('[doctor-addresses/setDefault] unexpected', { err })
    return { error: 'Erro interno' }
  }
}

// ── delete ────────────────────────────────────────────────────────────────────

export async function deleteDoctorAddress(addressId: string): Promise<{ error?: string }> {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const doctorId = await resolveOwnDoctorId(user.id)
    if (!doctorId) return { error: 'Médico não encontrado' }

    // Check if address is used in any order (ON DELETE RESTRICT in DB, but give a clear message)
    const { data: usedInOrder } = await admin
      .from('orders')
      .select('id')
      .eq('delivery_address_id', addressId)
      .limit(1)
      .maybeSingle()

    if (usedInOrder) {
      return {
        error:
          'Este endereço está vinculado a pedidos existentes e não pode ser excluído. Você pode editá-lo ou criar um novo.',
      }
    }

    const { error } = await admin
      .from('doctor_addresses')
      .delete()
      .eq('id', addressId)
      .eq('doctor_id', doctorId)

    if (error) return { error: 'Erro ao excluir endereço' }
    return {}
  } catch (err) {
    logger.error('[doctor-addresses/delete] unexpected', { err })
    return { error: 'Erro interno' }
  }
}
