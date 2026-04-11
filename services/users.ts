'use server'
import { logger } from '@/lib/logger'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { revokeAllUserTokens } from '@/lib/token-revocation'
import { z } from 'zod'
import { Resend } from 'resend'
import type { UserRole } from '@/types'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = 'https://clinipharma.com.br'

async function sendAdminWelcomeEmail(email: string, fullName: string) {
  const adminClient = createAdminClient()
  const { data } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${APP_URL}/auth/callback?type=recovery` },
  })
  const link = data?.properties?.hashed_token
    ? `${APP_URL}/auth/callback?token_hash=${data.properties.hashed_token}&type=recovery`
    : `${APP_URL}/login`

  await resend.emails.send({
    from: 'Clinipharma <noreply@clinipharma.com.br>',
    to: email,
    subject: 'Bem-vindo(a) à Clinipharma — Defina sua senha',
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
      <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
        <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
      </div>
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
        <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Olá, ${fullName}!</h2>
        <p style="color:#475569;font-size:14px;line-height:1.6">
          Seu acesso à Clinipharma foi criado. Clique no botão abaixo para definir sua senha e começar a usar a plataforma.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${link}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">
            Definir minha senha
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px;text-align:center">Este link expira em 1 hora.</p>
      </div>
    </div>`,
  })
}

const createUserSchema = z.object({
  full_name: z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('Email inválido'),
  password: z
    .string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres')
    .optional()
    .or(z.literal('')),
  role: z.enum([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
    'SALES_CONSULTANT',
  ]),
  clinic_id: z.string().uuid().optional(),
  pharmacy_id: z.string().uuid().optional(),
  consultant_id: z.string().uuid().optional(),
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

    // Create user in Supabase Auth (with random password — user sets own via email link)
    const tempPassword = parsed.data.password || `Tmp${Math.random().toString(36).slice(2)}!Cp`
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: parsed.data.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    })

    if (authError || !authUser.user) {
      if (authError?.message?.includes('already')) return { error: 'Email já cadastrado' }
      return { error: authError?.message ?? 'Erro ao criar usuário' }
    }

    const userId = authUser.user.id

    // Upsert profile (trigger may have created it already)
    const { error: profileUpsertErr } = await adminClient.from('profiles').upsert({
      id: userId,
      full_name: parsed.data.full_name,
      email: parsed.data.email,
    })
    if (profileUpsertErr)
      logger.error('[createUser] profiles.upsert failed', { userId, error: profileUpsertErr })

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
      const { error: memberErr } = await adminClient.from('clinic_members').insert({
        user_id: userId,
        clinic_id: parsed.data.clinic_id,
        membership_role: parsed.data.membership_role ?? 'ADMIN',
      })
      if (memberErr)
        logger.error('[createUser] clinic_members.insert failed', { userId, error: memberErr })
    }

    if (parsed.data.role === 'DOCTOR' && parsed.data.clinic_id) {
      // Check if a doctor record already exists for this email
      const { data: existingDoctor } = await adminClient
        .from('doctors')
        .select('id')
        .eq('email', parsed.data.email)
        .maybeSingle()

      if (existingDoctor) {
        const { error: linkErr } = await adminClient.from('doctor_clinic_links').upsert({
          doctor_id: existingDoctor.id,
          clinic_id: parsed.data.clinic_id,
          is_primary: true,
        })
        if (linkErr)
          logger.error('[createUser] doctor_clinic_links.upsert failed', { userId, error: linkErr })
      }
    }

    if (parsed.data.role === 'PHARMACY_ADMIN' && parsed.data.pharmacy_id) {
      // Insert into pharmacy_members so RLS policies and auth checks work correctly
      const { error: pharmMemberErr } = await adminClient.from('pharmacy_members').insert({
        user_id: userId,
        pharmacy_id: parsed.data.pharmacy_id,
      })
      if (pharmMemberErr)
        logger.error('[createUser] pharmacy_members.insert failed', {
          userId,
          error: pharmMemberErr,
        })
      await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: {
          full_name: parsed.data.full_name,
          pharmacy_id: parsed.data.pharmacy_id,
        },
      })
    }

    if (parsed.data.role === 'SALES_CONSULTANT' && parsed.data.consultant_id) {
      const { error: consultantErr } = await adminClient
        .from('sales_consultants')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', parsed.data.consultant_id)
      if (consultantErr)
        logger.error('[createUser] sales_consultants.update failed', {
          userId,
          error: consultantErr,
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

    // Send welcome email with password-set link (fire and forget)
    sendAdminWelcomeEmail(parsed.data.email, parsed.data.full_name).catch(console.error)

    revalidatePath('/users')
    return { id: userId }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('createUser error:', { error: err })
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

    // Upsert is safer than delete+insert — no window where user has no role
    const { error } = await adminClient
      .from('user_roles')
      .upsert({ user_id: userId, role }, { onConflict: 'user_id' })
    if (error) return { error: 'Erro ao atribuir papel' }

    // Revoke all active sessions — user must log in again to get a token with the new role
    await revokeAllUserTokens(userId)

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
    if (actor.id === userId) return { error: 'Você não pode desativar sua própria conta' }

    const adminClient = createAdminClient()

    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: '876600h',
    })
    if (authError) return { error: 'Erro ao desativar usuário' }

    // Mirror in profiles — checked explicitly so failures are not silent
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ is_active: false })
      .eq('id', userId)
    if (profileError)
      logger.error('[deactivateUser] failed to mirror is_active', { userId, error: profileError })

    await revokeAllUserTokens(userId)

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.STATUS_CHANGE,
      newValues: { active: false },
    })

    revalidatePath('/users')
    revalidatePath(`/users/${userId}`)
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function reactivateUser(userId: string): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    })
    if (authError) return { error: 'Erro ao reativar usuário' }

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ is_active: true })
      .eq('id', userId)
    if (profileError)
      logger.error('[reactivateUser] failed to mirror is_active', { userId, error: profileError })

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: userId,
      action: AuditAction.STATUS_CHANGE,
      newValues: { active: true },
    })

    revalidatePath('/users')
    revalidatePath(`/users/${userId}`)
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
    // Verify caller is updating their own profile (prevent IDOR)
    const { createClient: createServerClient } = await import('@/lib/db/server')
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) return { error: 'Sem permissão' }

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
