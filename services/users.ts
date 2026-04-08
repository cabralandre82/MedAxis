'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { z } from 'zod'
import type { UserRole } from '@/types'

const createUserSchema = z.object({
  full_name: z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  role: z.enum(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'PHARMACY_ADMIN']),
  clinic_id: z.string().uuid().optional(),
  pharmacy_id: z.string().uuid().optional(),
  membership_role: z.enum(['ADMIN', 'STAFF']).optional(),
})

export type CreateUserFormData = z.infer<typeof createUserSchema>

const updateUserSchema = z.object({
  full_name: z.string().min(2, 'Nome é obrigatório'),
  phone: z.string().optional(),
})

export type UpdateUserFormData = z.infer<typeof updateUserSchema>

export async function createUser(
  data: CreateUserFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = createUserSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()

    // Create user in Supabase Auth
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    })

    if (authError || !authUser.user) {
      if (authError?.message?.includes('already')) return { error: 'Email já cadastrado' }
      return { error: authError?.message ?? 'Erro ao criar usuário' }
    }

    const userId = authUser.user.id

    // Upsert profile (trigger may have created it already)
    await adminClient.from('profiles').upsert({
      id: userId,
      full_name: parsed.data.full_name,
      email: parsed.data.email,
    })

    // Assign role
    const { error: roleError } = await adminClient
      .from('user_roles')
      .insert({ user_id: userId, role: parsed.data.role })

    if (roleError) {
      await adminClient.auth.admin.deleteUser(userId)
      return { error: 'Erro ao atribuir papel ao usuário' }
    }

    // Link to organization
    if (parsed.data.role === 'CLINIC_ADMIN' && parsed.data.clinic_id) {
      await adminClient.from('clinic_members').insert({
        user_id: userId,
        clinic_id: parsed.data.clinic_id,
        role: parsed.data.membership_role ?? 'ADMIN',
      })
    }

    if (parsed.data.role === 'DOCTOR' && parsed.data.clinic_id) {
      // Check if a doctor record already exists for this email
      const { data: existingDoctor } = await adminClient
        .from('doctors')
        .select('id')
        .eq('email', parsed.data.email)
        .maybeSingle()

      if (existingDoctor) {
        await adminClient.from('doctor_clinic_links').upsert({
          doctor_id: existingDoctor.id,
          clinic_id: parsed.data.clinic_id,
          is_primary: true,
        })
      }
    }

    if (parsed.data.role === 'PHARMACY_ADMIN' && parsed.data.pharmacy_id) {
      await adminClient
        .from('pharmacies')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', parsed.data.pharmacy_id)
      // Store pharmacy link in user metadata for RLS
      await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: {
          full_name: parsed.data.full_name,
          pharmacy_id: parsed.data.pharmacy_id,
        },
      })
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.CREATE,
      newValues: {
        email: parsed.data.email,
        role: parsed.data.role,
        full_name: parsed.data.full_name,
      },
    })

    revalidatePath('/users')
    return { id: userId }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    console.error('createUser error:', err)
    return { error: 'Erro interno ao criar usuário' }
  }
}

export async function updateUserProfile(
  userId: string,
  data: UpdateUserFormData
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = updateUserSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('profiles')
      .update({
        full_name: parsed.data.full_name,
        phone: parsed.data.phone ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) return { error: 'Erro ao atualizar perfil' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.UPDATE,
      newValues: parsed.data as Record<string, unknown>,
    })

    revalidatePath('/users')
    revalidatePath(`/users/${userId}`)
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function assignUserRole(userId: string, role: UserRole): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    // Remove existing roles
    await adminClient.from('user_roles').delete().eq('user_id', userId)

    // Insert new role
    const { error } = await adminClient.from('user_roles').insert({ user_id: userId, role })
    if (error) return { error: 'Erro ao atribuir papel' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.UPDATE,
      newValues: { role },
    })

    revalidatePath(`/users/${userId}`)
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    if (newPassword.length < 8) return { error: 'Senha deve ter pelo menos 8 caracteres' }

    const adminClient = createAdminClient()
    const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword })
    if (error) return { error: 'Erro ao redefinir senha' }

    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function deactivateUser(userId: string): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: '876600h',
    })
    if (error) return { error: 'Erro ao desativar usuário' }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.STATUS_CHANGE,
      newValues: { active: false },
    })

    revalidatePath('/users')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function updateOwnProfile(
  userId: string,
  data: { full_name: string; phone?: string }
): Promise<{ error?: string }> {
  try {
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('profiles')
      .update({
        full_name: data.full_name,
        phone: data.phone ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) return { error: 'Erro ao atualizar perfil' }
    revalidatePath('/profile')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}
