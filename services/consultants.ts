'use server'
import { logger } from '@/lib/logger'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { salesConsultantSchema, type SalesConsultantFormData } from '@/lib/validators'
import { sendEmail } from '@/lib/email'
import {
  consultantTransferEmail,
  consultantWelcomeEmail,
  consultantClinicLinkedEmail,
} from '@/lib/email/templates'
import { formatCurrency } from '@/lib/utils'
import { emitirNFSeParaConsultor } from '@/services/nfse'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://clinipharma.com.br'

/**
 * Global consultant commission rate, in percent.
 *
 * Migration 005 dropped `sales_consultants.commission_rate` and moved
 * the value to `app_settings` under the key `consultant_commission_rate`
 * (rate is now uniform across all consultants — product decision). The
 * previous code path kept reading `consultant.commission_rate` from
 * `sales_consultants` even after the column was gone, producing
 * `42703 undefined_column` on every create / clinic-link / transfer
 * email path. This helper is the single read site for the rate; if a
 * future product policy reintroduces per-consultant rates, the migration
 * comes here.
 *
 * Returns 5 (percent) when the setting row is missing.
 */
async function getGlobalConsultantRate(
  adminClient: ReturnType<typeof createAdminClient>
): Promise<number> {
  try {
    const { data } = await adminClient
      .from('app_settings')
      .select('value_json')
      .eq('key', 'consultant_commission_rate')
      .single()
    const raw = data?.value_json
    if (raw === null || raw === undefined) return 5
    const parsed = Number(typeof raw === 'string' ? raw : JSON.stringify(raw))
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 5
  } catch {
    return 5
  }
}

/**
 * Maps a PostgREST/Postgres error from `sales_consultants.insert` into
 * a Portuguese, actionable message. The operator triggering this is
 * always a SUPER_ADMIN, so the message can name the constraint /
 * column directly (no leak of sensitive values, just shape).
 *
 * Recognized error codes (subset of Postgres SQLSTATE):
 *   23505 unique_violation         — CNPJ / email duplicado
 *   23502 not_null_violation       — coluna obrigatória vazia
 *   23514 check_violation          — commission_rate fora do range, status inválido
 *   23503 foreign_key_violation    — referência inválida (raro nesta tabela)
 *   22P02 invalid_text_representation — formato (ex.: enum inválido)
 *   42501 insufficient_privilege   — RLS bloqueou
 *   PGRST*                         — erros do PostgREST (geralmente schema cache)
 *
 * Anything unrecognized falls back to a message that quotes the SQLSTATE
 * code, so the operator can search the runbook by code instead of
 * staring at "Erro ao criar consultor".
 */
function friendlyConsultantInsertError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}): string {
  const code = error.code ?? ''
  const message = error.message ?? ''
  const details = error.details ?? ''
  const haystack = `${message} ${details}`.toLowerCase()

  if (code === '23505') {
    if (haystack.includes('email')) {
      return 'Email já cadastrado para outro consultor. Verifique a lista em /consultants ou use outro email.'
    }
    if (haystack.includes('cnpj')) {
      return 'CNPJ já cadastrado para outro consultor. Cada CNPJ pode estar vinculado a apenas um consultor.'
    }
    return 'Já existe um consultor com algum dos dados informados (campo único duplicado). Verifique email e CNPJ.'
  }

  if (code === '23502') {
    // Postgres puts the column name in `message` like
    // "null value in column \"full_name\" violates not-null constraint"
    const colMatch = message.match(/column "([^"]+)"/i)
    const col = colMatch?.[1]
    if (col) {
      return `Campo obrigatório não preenchido: ${col}.`
    }
    return 'Campo obrigatório não preenchido. Confira nome, email e CNPJ.'
  }

  if (code === '23514') {
    if (haystack.includes('commission_rate')) {
      return 'Taxa de comissão deve estar entre 0% e 100%. Ajuste em Configurações → Taxa de comissão.'
    }
    if (haystack.includes('status')) {
      return 'Status inválido. Permitidos: ACTIVE, INACTIVE ou SUSPENDED.'
    }
    return `Restrição do banco bloqueou a criação (constraint violada). Detalhes: ${message}`
  }

  if (code === '23503') {
    return `Referência inválida no cadastro (foreign key): ${details || message}`
  }

  if (code === '22P02') {
    return `Formato de dado inválido em algum campo. Detalhes: ${message}`
  }

  if (code === '42501') {
    return 'Sem permissão para criar consultor (RLS). Faça login como SUPER_ADMIN.'
  }

  if (code.startsWith('PGRST')) {
    return `Erro de schema (${code}). Provavelmente uma migration pendente. Detalhes: ${message}`
  }

  // Unknown error — surface the SQLSTATE code so it's searchable in
  // logs and runbooks instead of a generic toast.
  if (code) {
    return `Erro ao criar consultor (código ${code}). Detalhes nos logs do servidor.`
  }
  return `Erro ao criar consultor: ${message || 'sem mensagem do banco'}.`
}

// ─── Create ────────────────────────────────────────────────────────────────

/**
 * Creates a sales consultant **AND** provisions the user account so the
 * consultant can log in, see their dashboard and receive notifications.
 *
 * The full happy-path is:
 *   1. Insert into `sales_consultants` (the source of truth for billing/CNPJ)
 *   2. Create a Supabase auth user (idempotent: if the email already exists
 *      in auth.users we reuse that account instead of failing)
 *   3. Upsert `profiles` mirror (the existing trigger usually already did
 *      this, but we upsert defensively in case the trigger is disabled)
 *   4. Insert `user_roles` row with `SALES_CONSULTANT` so the user shows up
 *      in `/users` and the dashboard router serves the ConsultantDashboard
 *   5. Link `sales_consultants.user_id ← auth.user.id`
 *   6. Generate a recovery (password-set) link and email it via the
 *      `consultantWelcomeEmail` template
 *
 * Failure handling: if step 2 succeeds but a later step fails, we delete
 * the auth user so the operator can retry without "email already cadastrado"
 * sticking around. Email send is fire-and-forget — we never block on it.
 */
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
      // `commission_rate` USED to live on `sales_consultants` until
      // migration 005 hoisted it to `app_settings`. Selecting the
      // dropped column was returning `42703 undefined_column` — that
      // was the actual root cause of the 2026-04-29 "Erro ao criar
      // consultor" toast. Rate is read from app_settings further down.
      .select('id, full_name, email')
      .single()

    if (error) {
      // Always log the raw error first — the historical "Erro ao criar
      // consultor" toast was a black box for the operator. Anything we
      // can't classify still ends up in the server log with full
      // context (code, message, details, hint).
      logger.error('[createConsultant] sales_consultants.insert failed', {
        actorUserId: actor.id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        // Echo only non-sensitive identifying fields. We deliberately
        // do NOT log bank/pix data even though they're under audit-log
        // RLS — the logger forwards to Sentry and they don't need to
        // see secondary copies.
        email: parsed.data.email,
        cnpj: parsed.data.cnpj,
      })

      // Map the known error families to actionable Portuguese
      // messages. The operator who triggers this is always a
      // SUPER_ADMIN (RBAC gate above), so it's safe to surface the
      // technical reason (which column / which constraint) — these
      // operators are the ones who have to fix the data.
      const friendly = friendlyConsultantInsertError(error)
      return { error: friendly }
    }

    // ─── Provision auth account so the consultant can actually log in ──
    let userId: string | null = null
    let createdAuthUser = false
    try {
      const tempPassword = `Tmp${Math.random().toString(36).slice(2)}!Cp`
      const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
        email: parsed.data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: parsed.data.full_name, consultant_id: consultant.id },
      })

      if (authUser?.user) {
        userId = authUser.user.id
        createdAuthUser = true
      } else if (authErr?.message?.toLowerCase().includes('already')) {
        // Email already in auth.users — reuse the existing account so
        // the operator can re-link a returning consultant without a
        // hard error.
        const { data: page } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
        const existing = page?.users.find(
          (u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase()
        )
        if (existing) userId = existing.id
      } else if (authErr) {
        logger.warn('[createConsultant] auth.admin.createUser failed', {
          consultantId: consultant.id,
          error: authErr,
        })
      }
    } catch (authErr) {
      logger.warn('[createConsultant] auth provisioning threw', {
        consultantId: consultant.id,
        error: authErr,
      })
    }

    if (userId) {
      // Profile mirror (defensive — handle_new_user trigger usually did it)
      await adminClient.from('profiles').upsert({
        id: userId,
        full_name: parsed.data.full_name,
        email: parsed.data.email,
      })

      // Role assignment — idempotent, won't double-insert
      const { error: roleErr } = await adminClient
        .from('user_roles')
        .upsert(
          { user_id: userId, role: 'SALES_CONSULTANT' },
          { onConflict: 'user_id,role', ignoreDuplicates: true }
        )
      if (roleErr) {
        logger.error('[createConsultant] user_roles.upsert failed', {
          userId,
          consultantId: consultant.id,
          error: roleErr,
        })
        // Roll back: if WE created the auth user, undo it so the operator
        // can retry. If the user already existed we leave it alone.
        if (createdAuthUser) {
          await adminClient.auth.admin.deleteUser(userId).catch(() => {})
        }
        return { error: 'Erro ao atribuir papel ao consultor' }
      }

      // Link consultant ↔ user
      const { error: linkErr } = await adminClient
        .from('sales_consultants')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', consultant.id)
      if (linkErr)
        logger.error('[createConsultant] sales_consultants.update user_id failed', {
          userId,
          consultantId: consultant.id,
          error: linkErr,
        })

      // Welcome email with password-set link — non-blocking
      try {
        const [{ data: linkData }, globalRate] = await Promise.all([
          adminClient.auth.admin.generateLink({
            type: 'recovery',
            email: parsed.data.email,
            options: { redirectTo: `${APP_URL}/auth/callback?type=recovery` },
          }),
          getGlobalConsultantRate(adminClient),
        ])
        const inviteUrl = linkData?.properties?.hashed_token
          ? `${APP_URL}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=recovery`
          : `${APP_URL}/login`
        const tmpl = consultantWelcomeEmail({
          consultantName: parsed.data.full_name,
          inviteUrl,
          commissionRate: String(globalRate),
        })
        await sendEmail({ to: parsed.data.email, ...tmpl })
      } catch (emailErr) {
        logger.warn('[createConsultant] welcome email failed', {
          consultantId: consultant.id,
          error: emailErr,
        })
      }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: consultant.id,
      action: AuditAction.CREATE,
      newValues: { ...parsed.data, entity: 'sales_consultant', user_id: userId },
    })

    revalidatePath('/consultants')
    revalidatePath('/users')
    return { id: consultant.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('createConsultant error:', { error: err })
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

    if (error) {
      logger.error('[updateConsultant] sales_consultants.update failed', {
        consultantId: id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return { error: friendlyConsultantInsertError(error) }
    }

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

    if (error) {
      logger.error('[updateConsultantStatus] sales_consultants.update failed', {
        consultantId: id,
        nextStatus: status,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return { error: friendlyConsultantInsertError(error) }
    }

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

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a consultant record + the associated auth user when safe.
 *
 * Why this exists: the operator surface had a status switcher
 * (ACTIVE / INACTIVE / SUSPENDED) but no way to remove a mistakenly-
 * created record. The "consultor teste" entry sat there indefinitely
 * because nothing in the UI could clear it.
 *
 * Safety rails (deletion is irreversible):
 *
 *   1. Refuses if there is ANY commission row (`consultant_commissions`)
 *      or transfer row (`consultant_transfers`) tied to this consultant.
 *      Those tables drive financial reporting and tax/fiscal retention
 *      (LGPD Art. 16, II — obrigação legal de conservação fiscal). The
 *      operator must use status='INACTIVE' instead, which keeps the
 *      ledger intact.
 *   2. Unlinks linked clinics first (`clinics.consultant_id = NULL`).
 *      The FK already does ON DELETE SET NULL, but doing it explicitly
 *      lets us audit-log the unlinks.
 *   3. Deletes the auth.users row only if the linked user has
 *      `SALES_CONSULTANT` as their ONLY role. If they have another
 *      role (CLINIC_ADMIN, DOCTOR, etc) they continue to exist in
 *      auth — we just sever the consultant link.
 *
 * Audit-log: writes `PROFILE` / `DELETE` action with the deleted
 * snapshot in `oldValues` so a subsequent investigation can recover the
 * minimum identifying fields.
 */
export async function deleteConsultant(
  id: string
): Promise<{ error?: string; deletedAuthUser?: boolean; unlinkedClinics?: number }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const adminClient = createAdminClient()

    const { data: consultant, error: fetchErr } = await adminClient
      .from('sales_consultants')
      .select('id, full_name, email, cnpj, user_id, status')
      .eq('id', id)
      .single()
    if (fetchErr || !consultant) {
      return { error: 'Consultor não encontrado.' }
    }

    const [{ count: commissionCount }, { count: transferCount }] = await Promise.all([
      adminClient
        .from('consultant_commissions')
        .select('id', { head: true, count: 'exact' })
        .eq('consultant_id', id),
      adminClient
        .from('consultant_transfers')
        .select('id', { head: true, count: 'exact' })
        .eq('consultant_id', id),
    ])
    const totalFinancial = (commissionCount ?? 0) + (transferCount ?? 0)
    if (totalFinancial > 0) {
      return {
        error:
          `Esse consultor tem ${commissionCount ?? 0} comissão(ões) e ${transferCount ?? 0} repasse(s) registrado(s). ` +
          'Por obrigação fiscal e LGPD esses dados devem ser preservados — use o status "Inativo" em vez de excluir.',
      }
    }

    const { data: clinicsForUnlink, error: clinicsFetchErr } = await adminClient
      .from('clinics')
      .select('id')
      .eq('consultant_id', id)
    if (clinicsFetchErr) {
      logger.error('[deleteConsultant] failed to enumerate linked clinics', {
        consultantId: id,
        error: clinicsFetchErr,
      })
      return { error: 'Erro ao verificar clínicas vinculadas. Tente novamente.' }
    }
    const linkedClinicIds = (clinicsForUnlink ?? []).map((c) => c.id)
    if (linkedClinicIds.length > 0) {
      const { error: unlinkErr } = await adminClient
        .from('clinics')
        .update({ consultant_id: null, updated_at: new Date().toISOString() })
        .in('id', linkedClinicIds)
      if (unlinkErr) {
        logger.error('[deleteConsultant] clinics unlink failed', {
          consultantId: id,
          clinicIds: linkedClinicIds,
          code: unlinkErr.code,
          message: unlinkErr.message,
        })
        return { error: friendlyConsultantInsertError(unlinkErr) }
      }
    }

    const { error: deleteErr } = await adminClient.from('sales_consultants').delete().eq('id', id)
    if (deleteErr) {
      logger.error('[deleteConsultant] sales_consultants.delete failed', {
        consultantId: id,
        code: deleteErr.code,
        message: deleteErr.message,
        details: deleteErr.details,
        hint: deleteErr.hint,
      })
      return { error: friendlyConsultantInsertError(deleteErr) }
    }

    let deletedAuthUser = false
    if (consultant.user_id) {
      try {
        const { data: roleRows, error: roleErr } = await adminClient
          .from('user_roles')
          .select('role')
          .eq('user_id', consultant.user_id)
        if (roleErr) {
          logger.warn('[deleteConsultant] could not enumerate user_roles', {
            userId: consultant.user_id,
            error: roleErr,
          })
        } else {
          const roles = (roleRows ?? []).map((r) => r.role)
          const onlySalesConsultant = roles.length === 1 && roles[0] === 'SALES_CONSULTANT'
          if (onlySalesConsultant) {
            await adminClient
              .from('user_roles')
              .delete()
              .eq('user_id', consultant.user_id)
              .eq('role', 'SALES_CONSULTANT')
            const { error: authDeleteErr } = await adminClient.auth.admin.deleteUser(
              consultant.user_id
            )
            if (authDeleteErr) {
              logger.warn('[deleteConsultant] auth.admin.deleteUser failed', {
                userId: consultant.user_id,
                error: authDeleteErr,
              })
            } else {
              deletedAuthUser = true
            }
          } else if (roles.length > 1) {
            await adminClient
              .from('user_roles')
              .delete()
              .eq('user_id', consultant.user_id)
              .eq('role', 'SALES_CONSULTANT')
          }
        }
      } catch (authCleanupErr) {
        logger.warn('[deleteConsultant] auth user cleanup threw', {
          userId: consultant.user_id,
          error: authCleanupErr,
        })
      }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PROFILE,
      entityId: id,
      action: AuditAction.DELETE,
      oldValues: {
        ...consultant,
        entity: 'sales_consultant',
        unlinked_clinics: linkedClinicIds.length,
        deleted_auth_user: deletedAuthUser,
      },
    })

    revalidatePath('/consultants')
    revalidatePath('/users')
    return { unlinkedClinics: linkedClinicIds.length, deletedAuthUser }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('deleteConsultant error:', { error: err })
    return { error: 'Erro interno ao excluir consultor.' }
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

    // Notify consultant — only on link (not unlink). Failures must never
    // block the assignment write itself.
    if (consultantId) {
      try {
        const [{ data: consultant }, { data: clinic }, globalRate] = await Promise.all([
          adminClient
            .from('sales_consultants')
            .select('email, full_name')
            .eq('id', consultantId)
            .single(),
          adminClient.from('clinics').select('trade_name').eq('id', clinicId).single(),
          getGlobalConsultantRate(adminClient),
        ])

        if (consultant?.email && clinic?.trade_name) {
          const tmpl = consultantClinicLinkedEmail({
            consultantName: consultant.full_name,
            clinicName: clinic.trade_name,
            commissionRate: String(globalRate),
          })
          await sendEmail({ to: consultant.email, ...tmpl })
        }
      } catch (emailErr) {
        logger.warn('[assignConsultantToClinic] notification email failed', {
          consultantId,
          clinicId,
          error: emailErr,
        })
      }
    }

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

    // Atomic claim: mark commissions as PROCESSING only if still PENDING
    // This prevents double-payment in concurrent requests
    const { data: claimed, error: claimErr } = await adminClient
      .from('consultant_commissions')
      .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
      .in('id', commissionIds)
      .eq('consultant_id', consultantId)
      .eq('status', 'PENDING')
      .select('id, commission_amount')

    if (claimErr || !claimed?.length)
      return { error: 'Comissões não encontradas ou já estão sendo processadas' }

    const commissions = claimed
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

    if (transferErr || !transfer) {
      // Rollback: revert commissions back to PENDING so they can be retried
      const { error: rollbackErr } = await adminClient
        .from('consultant_commissions')
        .update({ status: 'PENDING', updated_at: new Date().toISOString() })
        .in('id', commissionIds)
      if (rollbackErr)
        logger.error(
          '[registerConsultantTransfer] rollback failed — commissions may be stuck in PROCESSING',
          { error: rollbackErr, commissionIds }
        )
      return { error: 'Erro ao registrar repasse' }
    }

    // Mark commissions as PAID and link to transfer
    const { error: markPaidErr } = await adminClient
      .from('consultant_commissions')
      .update({
        status: 'PAID',
        transfer_id: transfer.id,
        updated_at: new Date().toISOString(),
      })
      .in('id', commissionIds)
    if (markPaidErr)
      logger.error('[registerConsultantTransfer] failed to mark commissions as PAID', {
        error: markPaidErr,
        transferId: transfer.id,
        commissionIds,
      })

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

    // Emit NFS-e for consultant commission — non-blocking, never throws
    if (grossAmount > 0) {
      const { data: consultantForNFSe } = await adminClient
        .from('sales_consultants')
        .select('cnpj, full_name, email')
        .eq('id', consultantId)
        .single()

      if (consultantForNFSe?.cnpj) {
        emitirNFSeParaConsultor({
          consultantTransferId: transfer.id,
          valorServicos: grossAmount,
          tomadorCpfCnpj: consultantForNFSe.cnpj,
          tomadorNome: consultantForNFSe.full_name,
          tomadorEmail: consultantForNFSe.email ?? undefined,
          commissionCount: commissions.length,
        }).catch((err) =>
          logger.error('[registerConsultantTransfer] NFS-e async error', { error: err })
        )
      }
    }

    revalidatePath('/consultant-transfers')
    revalidatePath(`/consultants/${consultantId}`)
    return { id: transfer.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('registerConsultantTransfer error:', { error: err })
    return { error: 'Erro interno' }
  }
}
