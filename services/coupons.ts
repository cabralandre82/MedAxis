'use server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { requireAuth } from '@/lib/auth/session'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { revalidateTag } from 'next/cache'
import { randomBytes } from 'crypto'
import {
  applyCouponAtomic,
  recordAtomicFallback,
  shouldUseAtomicRpc,
} from '@/lib/services/atomic.server'

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateCouponCode(): string {
  const part = () => randomBytes(3).toString('hex').toUpperCase()
  return `${part()}-${part()}` // e.g. A3F2B9-1C4D7E
}

// ─── schemas ─────────────────────────────────────────────────────────────────

const uuidLoose = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'ID inválido')

const createCouponSchema = z
  .object({
    product_id: uuidLoose,
    clinic_id: uuidLoose.optional().nullable(),
    doctor_id: uuidLoose.optional().nullable(),
    discount_type: z.enum(['PERCENT', 'FIXED']),
    discount_value: z.number().positive(),
    max_discount_amount: z.number().positive().optional(),
    valid_from: z.string().datetime().optional(),
    valid_until: z.string().datetime().nullable().optional(),
  })
  .refine((d) => d.clinic_id || d.doctor_id, {
    message: 'Informe a clínica ou o médico destinatário do cupom',
    path: ['clinic_id'],
  })

export type CreateCouponInput = z.infer<typeof createCouponSchema>

export interface CouponRow {
  id: string
  code: string
  product_id: string
  clinic_id: string | null
  doctor_id: string | null
  discount_type: 'PERCENT' | 'FIXED'
  discount_value: number
  max_discount_amount: number | null
  valid_from: string
  valid_until: string | null
  activated_at: string | null
  active: boolean
  used_count: number
  created_by_user_id: string
  created_at: string
  updated_at: string
}

// ─── admin: criar cupom ───────────────────────────────────────────────────────

export async function createCoupon(
  input: CreateCouponInput
): Promise<{ coupon?: CouponRow; error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = createCouponSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const admin = createAdminClient()

    const { clinic_id, doctor_id } = parsed.data
    const targetField = clinic_id ? 'clinic_id' : 'doctor_id'
    const targetId = clinic_id ?? doctor_id!

    // Verifica duplicidade por target+product
    const existingQuery = admin
      .from('coupons')
      .select('id')
      .eq('product_id', parsed.data.product_id)
      .eq('active', true)

    if (clinic_id) existingQuery.eq('clinic_id', clinic_id)
    else existingQuery.eq('doctor_id', doctor_id!)

    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      const who = clinic_id ? 'esta clínica' : 'este médico'
      return {
        error: `Já existe um cupom ativo para ${who} e produto. Desative-o antes de criar um novo.`,
      }
    }

    const code = generateCouponCode()

    const { data: coupon, error: insertError } = await admin
      .from('coupons')
      .insert({
        code,
        product_id: parsed.data.product_id,
        clinic_id: clinic_id ?? null,
        doctor_id: doctor_id ?? null,
        discount_type: parsed.data.discount_type,
        discount_value: parsed.data.discount_value,
        max_discount_amount: parsed.data.max_discount_amount ?? null,
        valid_from: parsed.data.valid_from ?? new Date().toISOString(),
        valid_until: parsed.data.valid_until ?? null,
        created_by_user_id: actor.id,
      })
      .select()
      .single()

    if (insertError || !coupon) {
      logger.error('[coupons/create] insert failed', { error: insertError })
      return { error: 'Erro ao criar cupom' }
    }

    // Busca dados para notificação
    const { data: product } = await admin
      .from('products')
      .select('name')
      .eq('id', parsed.data.product_id)
      .single()

    const discountLabel =
      parsed.data.discount_type === 'PERCENT'
        ? `${parsed.data.discount_value}%`
        : `R$${Number(parsed.data.discount_value).toFixed(2)}`

    if (clinic_id) {
      // Notifica membros da clínica
      const { data: members } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', clinic_id)
      for (const member of members ?? []) {
        await createNotification({
          userId: member.user_id,
          type: 'COUPON_ASSIGNED',
          title: `Cupom de desconto disponível`,
          body: `Você recebeu um cupom de ${discountLabel} de desconto no produto ${product?.name ?? '—'}. Código: ${code}`,
          link: '/coupons',
        })
      }
    } else if (doctor_id) {
      // Notifica o médico diretamente (via user_id)
      const { data: doc } = await admin
        .from('doctors')
        .select('user_id')
        .eq('id', doctor_id)
        .maybeSingle()
      if (doc?.user_id) {
        await createNotification({
          userId: doc.user_id,
          type: 'COUPON_ASSIGNED',
          title: `Cupom de desconto disponível`,
          body: `Você recebeu um cupom de ${discountLabel} no produto ${product?.name ?? '—'}. Código: ${code}`,
          link: '/coupons',
        })
      }
    }

    // Busca nome do destinatário para audit log
    let targetName: string | undefined
    if (clinic_id) {
      const { data: clinic } = await admin
        .from('clinics')
        .select('trade_name')
        .eq('id', clinic_id)
        .single()
      targetName = clinic?.trade_name
    } else {
      const { data: doc } = await admin
        .from('doctors')
        .select('full_name')
        .eq('id', doctor_id!)
        .single()
      targetName = doc?.full_name
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: coupon.id,
      action: AuditAction.CREATE,
      newValues: {
        code,
        [targetField]: targetId,
        target_name: targetName,
        product: product?.name,
        discount_type: parsed.data.discount_type,
        discount_value: parsed.data.discount_value,
      },
    })

    revalidateTag('coupons')
    return { coupon: coupon as CouponRow }
  } catch (err) {
    logger.error('[coupons/create] unexpected', { err })
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── admin: desativar cupom ───────────────────────────────────────────────────

export async function deactivateCoupon(couponId: string): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const admin = createAdminClient()

    const { data: coupon, error: fetchErr } = await admin
      .from('coupons')
      .select('id, active, code, clinic_id, doctor_id, product_id')
      .eq('id', couponId)
      .single()

    if (fetchErr || !coupon) return { error: 'Cupom não encontrado' }
    if (!coupon.active) return { error: 'Cupom já está inativo' }

    const { error: updateErr } = await admin
      .from('coupons')
      .update({ active: false })
      .eq('id', couponId)

    if (updateErr) {
      logger.error('[coupons/deactivate] update failed', { error: updateErr })
      return { error: 'Erro ao desativar cupom' }
    }

    // Notifica destinatário (clínica ou médico)
    if (coupon.clinic_id) {
      const { data: members } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', coupon.clinic_id)
      for (const member of members ?? []) {
        await createNotification({
          userId: member.user_id,
          type: 'COUPON_ASSIGNED',
          title: 'Cupom cancelado',
          body: `O cupom de desconto (${coupon.code}) foi cancelado pelo administrador.`,
          link: '/coupons',
        })
      }
    } else if (coupon.doctor_id) {
      const { data: doc } = await admin
        .from('doctors')
        .select('user_id')
        .eq('id', coupon.doctor_id)
        .maybeSingle()
      if (doc?.user_id) {
        await createNotification({
          userId: doc.user_id,
          type: 'COUPON_ASSIGNED',
          title: 'Cupom cancelado',
          body: `O cupom de desconto (${coupon.code}) foi cancelado pelo administrador.`,
          link: '/coupons',
        })
      }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.ORDER,
      entityId: couponId,
      action: AuditAction.UPDATE,
      oldValues: { active: true },
      newValues: { active: false },
    })

    revalidateTag('coupons')
    return {}
  } catch (err) {
    logger.error('[coupons/deactivate] unexpected', { err })
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── clínica: ativar cupom pelo código ────────────────────────────────────────

export async function activateCoupon(
  code: string
): Promise<{ coupon?: CouponRow; error?: string }> {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    // Wave 7 — atomic path. When `coupons.atomic_rpc` is enabled we delegate
    // the whole check-then-act to public.apply_coupon_atomic(), which runs
    // inside a single statement and therefore can never double-activate.
    // We still hydrate the returned CouponRow to match the legacy shape so
    // downstream callers are unchanged.
    const useRpc = await shouldUseAtomicRpc('coupon', { userId: user.id })
    if (useRpc) {
      const { data, error } = await applyCouponAtomic(code, user.id)
      if (error) {
        const map: Record<string, string> = {
          invalid_code: 'Código inválido',
          invalid_user: 'Usuário não autenticado',
          user_not_linked: 'Usuário não vinculado a nenhuma clínica ou perfil de médico',
          already_activated: 'Este cupom já foi ativado anteriormente',
          not_found_or_forbidden: 'Código inválido ou cupom não encontrado',
          rpc_unavailable: 'Serviço temporariamente indisponível',
        }
        // Only fall back on infrastructure errors. Business errors must
        // surface to the user so the UX matches the legacy flow.
        if (error.reason === 'rpc_unavailable') {
          recordAtomicFallback('coupon', 'rpc_unavailable')
          logger.warn('[coupons/activate] atomic rpc unavailable, using legacy path', {
            userId: user.id,
          })
        } else {
          return { error: map[error.reason] ?? 'Erro ao ativar cupom' }
        }
      } else if (data) {
        const { data: full } = await admin
          .from('coupons')
          .select('*')
          .eq('id', data.coupon_id)
          .single()
        if (full) {
          revalidateTag('coupons')
          return { coupon: full as CouponRow }
        }
      }
    } else {
      recordAtomicFallback('coupon', 'flag_off')
    }

    // Resolve who the current user is — clinic member or doctor
    const [{ data: membership }, { data: doctorRecord }] = await Promise.all([
      admin.from('clinic_members').select('clinic_id').eq('user_id', user.id).maybeSingle(),
      admin
        .from('doctors')
        .select('id')
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .maybeSingle(),
    ])

    if (!membership && !doctorRecord) {
      return { error: 'Usuário não vinculado a nenhuma clínica ou perfil de médico' }
    }

    const { data: coupon, error: fetchErr } = await admin
      .from('coupons')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .eq('active', true)
      .maybeSingle()

    if (fetchErr || !coupon) return { error: 'Código inválido ou cupom não encontrado' }

    // Validate ownership: coupon must belong to the user's clinic or to the doctor
    if (coupon.clinic_id && membership && coupon.clinic_id !== membership.clinic_id) {
      return { error: 'Este cupom não pertence à sua clínica' }
    }
    if (coupon.doctor_id && doctorRecord && coupon.doctor_id !== doctorRecord.id) {
      return { error: 'Este cupom não pertence ao seu perfil' }
    }
    if (coupon.clinic_id && !membership) {
      return { error: 'Este cupom é destinado a uma clínica' }
    }
    if (coupon.doctor_id && !doctorRecord) {
      return { error: 'Este cupom é destinado a um médico' }
    }

    if (coupon.valid_until && new Date(coupon.valid_until) < new Date()) {
      return { error: 'Este cupom está expirado' }
    }

    if (coupon.activated_at) {
      return { error: 'Este cupom já foi ativado anteriormente' }
    }

    const { data: updated, error: updateErr } = await admin
      .from('coupons')
      .update({ activated_at: new Date().toISOString() })
      .eq('id', coupon.id)
      .select()
      .single()

    if (updateErr || !updated) {
      logger.error('[coupons/activate] update failed', { error: updateErr })
      return { error: 'Erro ao ativar cupom' }
    }

    revalidateTag('coupons')
    return { coupon: updated as CouponRow }
  } catch (err) {
    logger.error('[coupons/activate] unexpected', { err })
    return { error: 'Erro interno' }
  }
}

// ─── listagem para clínica ────────────────────────────────────────────────────

export async function getClinicCoupons(): Promise<{
  coupons?: Array<CouponRow & { product_name: string }>
  error?: string
}> {
  try {
    const user = await requireAuth()
    const admin = createAdminClient()

    const { data: membership } = await admin
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) return { coupons: [] }

    const { data, error } = await admin
      .from('coupons')
      .select('*, products(name)')
      .eq('clinic_id', membership.clinic_id)
      .order('created_at', { ascending: false })

    if (error) return { error: 'Erro ao buscar cupons' }

    const coupons = (data ?? []).map((c) => ({
      ...c,
      product_name: (c.products as { name: string } | null)?.name ?? '—',
    })) as Array<CouponRow & { product_name: string }>

    return { coupons }
  } catch (err) {
    logger.error('[coupons/getClinicCoupons] unexpected', { err })
    return { error: 'Erro interno' }
  }
}

// ─── listagem para admin ──────────────────────────────────────────────────────

export async function getAdminCoupons(): Promise<{
  coupons?: Array<CouponRow & { product_name: string; recipient_name: string }>
  error?: string
}> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('coupons')
      .select('*, products(name), clinics(trade_name), doctors(full_name)')
      .order('created_at', { ascending: false })

    if (error) return { error: 'Erro ao buscar cupons' }

    const coupons = (data ?? []).map((c) => ({
      ...c,
      product_name: (c.products as { name: string } | null)?.name ?? '—',
      // Recipient is either a clinic or a doctor
      recipient_name:
        (c.clinics as { trade_name: string } | null)?.trade_name ??
        (c.doctors as { full_name: string } | null)?.full_name ??
        '—',
    })) as Array<CouponRow & { product_name: string; recipient_name: string }>

    return { coupons }
  } catch (err) {
    logger.error('[coupons/getAdminCoupons] unexpected', { err })
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

// ─── auto-detecção no momento do pedido ──────────────────────────────────────

/**
 * Retorna map de product_id → coupon_id para cupons ativos, ativados e válidos
 * de uma clínica. Usado em createOrder para aplicar desconto automaticamente.
 */
export async function getActiveCouponsForOrder(
  clinicId: string | null,
  productIds: string[],
  doctorId?: string | null
): Promise<Record<string, string>> {
  if (!productIds.length) return {}
  if (!clinicId && !doctorId) return {}

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const query = admin
    .from('coupons')
    .select('id, product_id')
    .eq('active', true)
    .not('activated_at', 'is', null)
    .in('product_id', productIds)
    .or(`valid_until.is.null,valid_until.gte.${now}`)

  if (clinicId) query.eq('clinic_id', clinicId)
  else if (doctorId) query.eq('doctor_id', doctorId)

  const { data, error } = await query

  if (error || !data?.length) return {}

  return Object.fromEntries(data.map((c) => [c.product_id, c.id]))
}
