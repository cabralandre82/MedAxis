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

// ADR-002: 5 tipos de cupom. PERCENT/FIXED = legacy; os outros 3 ganharam
// migração 079 + colunas adicionais (`min_quantity`, `tier_promotion_steps`).
// COUPON_DISCOUNT_TYPES vive em `lib/coupons/preview.ts` para não violar
// a regra "use server só exporta async functions" (verificado por
// tests/unit/services/coupons-use-server.test.ts).
import { COUPON_DISCOUNT_TYPES, type CatalogCouponDiscountType } from '@/lib/coupons/preview'

const createCouponSchema = z
  .object({
    product_id: uuidLoose,
    clinic_id: uuidLoose.optional().nullable(),
    doctor_id: uuidLoose.optional().nullable(),
    discount_type: z.enum(COUPON_DISCOUNT_TYPES),
    /**
     * - PERCENT, MIN_QTY_PERCENT: 0..100 (% por unidade)
     * - FIXED, FIRST_UNIT_DISCOUNT: R$ por unidade (positivo)
     * - TIER_UPGRADE: aceita 0 ou positivo (a regra é via tier_promotion_steps)
     */
    discount_value: z.number().min(0),
    max_discount_amount: z.number().positive().optional(),
    /** ADR-002: gate uniforme. Default 1 (sem gate). MIN_QTY_PERCENT exige >= 2. */
    min_quantity: z.number().int().min(1).max(1000).optional(),
    /** ADR-002: número de tiers acima a promover. TIER_UPGRADE exige >= 1. */
    tier_promotion_steps: z.number().int().min(0).max(10).optional(),
    valid_from: z.string().datetime().optional(),
    valid_until: z.string().datetime().nullable().optional(),
    /**
     * ADR-003 — opt-in para o caminho de substituição atômica.
     *
     * Quando `false` (default), createCoupon retorna conflito 409-style
     * se já houver outro cupom ativo para o mesmo (target × produto).
     * A UI usa esse conflito para pedir confirmação ao operador.
     *
     * Quando `true`, createCoupon chama a RPC `replace_active_coupon`,
     * que desativa o ativo anterior e cria o novo na mesma transação.
     * Notificação ao destinatário e audit log são emitidos para os
     * dois lados (desativação + criação).
     */
    replace_existing: z.boolean().optional(),
  })
  .refine((d) => d.clinic_id || d.doctor_id, {
    message: 'Informe a clínica ou o médico destinatário do cupom',
    path: ['clinic_id'],
  })
  .superRefine((d, ctx) => {
    // Mesmas validações do CHECK constraint coupons_type_consistency
    // (mig-079). Falhar antes do INSERT dá mensagem de UI mais clara
    // do que esperar a violação do banco.
    if (d.discount_type === 'TIER_UPGRADE') {
      if (!d.tier_promotion_steps || d.tier_promotion_steps < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tier_promotion_steps'],
          message: 'Upgrade de tier exige tier_promotion_steps >= 1',
        })
      }
    }
    if (d.discount_type === 'MIN_QTY_PERCENT') {
      if (!d.min_quantity || d.min_quantity < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['min_quantity'],
          message: '% condicional exige min_quantity >= 2',
        })
      }
      if (d.discount_value <= 0 || d.discount_value > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discount_value'],
          message: 'Percentual deve estar entre 0 e 100',
        })
      }
    }
    if (d.discount_type === 'FIRST_UNIT_DISCOUNT' && d.discount_value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount_value'],
        message: 'Desconto na 1ª unidade deve ser maior que zero',
      })
    }
    if (d.discount_type === 'PERCENT' && (d.discount_value <= 0 || d.discount_value > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount_value'],
        message: 'Percentual deve estar entre 0 e 100',
      })
    }
    if (d.discount_type === 'FIXED' && d.discount_value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discount_value'],
        message: 'Valor fixo deve ser maior que zero',
      })
    }
  })

export type CreateCouponInput = z.infer<typeof createCouponSchema>

export interface CouponRow {
  id: string
  code: string
  product_id: string
  clinic_id: string | null
  doctor_id: string | null
  discount_type: CatalogCouponDiscountType
  discount_value: number
  max_discount_amount: number | null
  min_quantity: number
  tier_promotion_steps: number
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

/**
 * ADR-003 — payload que descreve o cupom existente quando há conflito
 * de unicidade. A UI consome este payload para exibir o modal de
 * confirmação ("Já existe um cupom X. Substituir?").
 */
export interface ExistingCouponConflict {
  id: string
  code: string
  discount_type: CatalogCouponDiscountType
  discount_value: number
  min_quantity: number
  tier_promotion_steps: number
  valid_until: string | null
}

export interface CreateCouponResult {
  coupon?: CouponRow
  error?: string
  /**
   * Presente apenas quando há cupom ativo prévio para (target × produto)
   * E `replace_existing` veio false/ausente. A UI pede confirmação e
   * re-submete com `replace_existing: true`.
   */
  conflict?: { existing_coupon: ExistingCouponConflict }
  /** Presente quando o caminho de substituição rodou com sucesso. */
  replaced_coupon_ids?: string[]
  replaced_coupon_codes?: string[]
}

export async function createCoupon(input: CreateCouponInput): Promise<CreateCouponResult> {
  try {
    const actor = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = createCouponSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const admin = createAdminClient()

    const { clinic_id, doctor_id } = parsed.data
    const targetField = clinic_id ? 'clinic_id' : 'doctor_id'
    const targetId = clinic_id ?? doctor_id!

    // ADR-002 — guard de compatibilidade com pricing_mode.
    //
    // Os 3 tipos novos (FIRST_UNIT_DISCOUNT, TIER_UPGRADE, MIN_QTY_PERCENT)
    // só são tratados pela engine TIERED (compute_unit_price). O branch
    // legacy de freeze_order_item_price (pricing_mode='FIXED') só conhece
    // PERCENT/FIXED; deixar passar um tipo novo aqui causaria desconto
    // calculado errado no congelamento do pedido. Ver migração 080 para
    // a defesa-em-profundidade no banco.
    const NEW_TYPES = ['FIRST_UNIT_DISCOUNT', 'TIER_UPGRADE', 'MIN_QTY_PERCENT'] as const
    if ((NEW_TYPES as readonly string[]).includes(parsed.data.discount_type)) {
      const { data: prod, error: prodErr } = await admin
        .from('products')
        .select('pricing_mode, name')
        .eq('id', parsed.data.product_id)
        .maybeSingle()
      if (prodErr || !prod) {
        return { error: 'Produto não encontrado' }
      }
      if (prod.pricing_mode !== 'TIERED_PROFILE') {
        return {
          error: `O cupom do tipo ${parsed.data.discount_type} só pode ser aplicado a produtos com preço por escala (TIERED). O produto ${prod.name} ainda está com preço fixo — converta-o antes ou escolha PERCENT/FIXED.`,
        }
      }
    }

    // ADR-003 — Verifica duplicidade por target+product.
    //
    // O partial unique index garante que existe no máximo 1, mas
    // selecionamos com colunas suficientes para construir um payload de
    // confirmação útil para a UI quando precisarmos pedir override.
    const existingQuery = admin
      .from('coupons')
      .select(
        'id, code, discount_type, discount_value, min_quantity, tier_promotion_steps, valid_until'
      )
      .eq('product_id', parsed.data.product_id)
      .eq('active', true)

    if (clinic_id) existingQuery.eq('clinic_id', clinic_id)
    else existingQuery.eq('doctor_id', doctor_id!)

    const { data: existing } = await existingQuery.maybeSingle()

    if (existing && !parsed.data.replace_existing) {
      const who = clinic_id ? 'esta clínica' : 'este médico'
      // Mantemos `error` preenchido para compat com chamadores antigos
      // que esperam só { error }. Adicionamos `conflict` para a UI nova
      // (admin-coupon-panel) abrir o modal "substituir cupom existente?".
      return {
        error: `Já existe um cupom ativo para ${who} e produto. Confirme a substituição para continuar.`,
        conflict: {
          existing_coupon: {
            id: String(existing.id),
            code: String(existing.code),
            discount_type: existing.discount_type as CatalogCouponDiscountType,
            discount_value: Number(existing.discount_value),
            min_quantity: Number(existing.min_quantity ?? 1),
            tier_promotion_steps: Number(existing.tier_promotion_steps ?? 0),
            valid_until: (existing.valid_until ?? null) as string | null,
          },
        },
      }
    }

    const code = generateCouponCode()
    let coupon: CouponRow | null = null
    let replacedCouponIds: string[] = []
    let replacedCouponCodes: string[] = []

    if (existing && parsed.data.replace_existing) {
      // Caminho atômico via RPC — desativa o ativo anterior e cria o
      // novo na MESMA transação. Sem janela onde 0 ou 2 cupons fiquem
      // ativos para o (target × produto) — protege o partial unique
      // index e a leitura do catálogo.
      const { data: rpcData, error: rpcError } = await admin.rpc('replace_active_coupon', {
        p_product_id: parsed.data.product_id,
        p_clinic_id: clinic_id ?? null,
        p_doctor_id: doctor_id ?? null,
        p_code: code,
        p_discount_type: parsed.data.discount_type,
        p_discount_value: parsed.data.discount_value,
        p_max_discount_amount: parsed.data.max_discount_amount ?? null,
        p_min_quantity: parsed.data.min_quantity ?? 1,
        p_tier_promotion_steps: parsed.data.tier_promotion_steps ?? 0,
        p_valid_from: parsed.data.valid_from ?? new Date().toISOString(),
        p_valid_until: parsed.data.valid_until ?? null,
        p_created_by_user_id: actor.id,
      })

      if (rpcError || !rpcData) {
        logger.error('[coupons/create] replace rpc failed', { error: rpcError })
        return { error: 'Erro ao substituir cupom existente' }
      }

      const payload = rpcData as {
        new_coupon: CouponRow
        replaced_ids: string[] | null
        replaced_codes: string[] | null
      }
      coupon = payload.new_coupon
      replacedCouponIds = payload.replaced_ids ?? []
      replacedCouponCodes = payload.replaced_codes ?? []
    } else {
      const { data: inserted, error: insertError } = await admin
        .from('coupons')
        .insert({
          code,
          product_id: parsed.data.product_id,
          clinic_id: clinic_id ?? null,
          doctor_id: doctor_id ?? null,
          discount_type: parsed.data.discount_type,
          discount_value: parsed.data.discount_value,
          max_discount_amount: parsed.data.max_discount_amount ?? null,
          min_quantity: parsed.data.min_quantity ?? 1,
          tier_promotion_steps: parsed.data.tier_promotion_steps ?? 0,
          valid_from: parsed.data.valid_from ?? new Date().toISOString(),
          valid_until: parsed.data.valid_until ?? null,
          created_by_user_id: actor.id,
        })
        .select()
        .single()

      if (insertError || !inserted) {
        logger.error('[coupons/create] insert failed', { error: insertError })
        return { error: 'Erro ao criar cupom' }
      }
      coupon = inserted as CouponRow
    }

    if (!coupon) {
      return { error: 'Erro ao criar cupom' }
    }

    // Busca dados para notificação
    const { data: product } = await admin
      .from('products')
      .select('name')
      .eq('id', parsed.data.product_id)
      .single()

    // ADR-002: rótulo curto para a notificação ao destinatário, cobrindo
    // os 5 tipos. O rótulo completo (com qty mínima, tiers etc.) aparece
    // na lista do painel admin/clínica via componente próprio.
    const discountLabel = (() => {
      const v = Number(parsed.data.discount_value)
      switch (parsed.data.discount_type) {
        case 'PERCENT':
          return `${v}%`
        case 'FIXED':
          return `R$${v.toFixed(2)}`
        case 'FIRST_UNIT_DISCOUNT':
          return `R$${v.toFixed(2)} na 1ª unidade`
        case 'TIER_UPGRADE':
          return `+${parsed.data.tier_promotion_steps ?? 0} tier(s)`
        case 'MIN_QTY_PERCENT':
          return `${v}% (mín ${parsed.data.min_quantity ?? 2} unid.)`
      }
    })()

    // ADR-003 — quando é replacement, a body inclui menção explícita ao
    // cupom anterior. Isso evita que o destinatário pense que o sistema
    // duplicou descontos ou que o cupom antigo continua valendo.
    const replacementSuffix =
      replacedCouponCodes.length > 0
        ? ` (substitui o cupom anterior ${replacedCouponCodes.join(', ')})`
        : ''

    if (clinic_id) {
      const { data: members } = await admin
        .from('clinic_members')
        .select('user_id')
        .eq('clinic_id', clinic_id)
      for (const member of members ?? []) {
        await createNotification({
          userId: member.user_id,
          type: 'COUPON_ASSIGNED',
          title: `Cupom de desconto disponível`,
          body: `Você recebeu um cupom de ${discountLabel} de desconto no produto ${product?.name ?? '—'}. Código: ${code}${replacementSuffix}`,
          link: '/coupons',
        })
      }
    } else if (doctor_id) {
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
          body: `Você recebeu um cupom de ${discountLabel} no produto ${product?.name ?? '—'}. Código: ${code}${replacementSuffix}`,
          link: '/coupons',
        })
      }
    }

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
        // ADR-003: rastreia o "novo apaga antigo" no histórico.
        replaced_coupon_ids: replacedCouponIds.length > 0 ? replacedCouponIds : undefined,
        replaced_coupon_codes: replacedCouponCodes.length > 0 ? replacedCouponCodes : undefined,
      },
    })

    // ADR-003: também grava UPDATE em cada cupom desativado, para que o
    // audit_logs de cada cupom tenha o registro do motivo da desativação
    // (substituição) — útil em DSAR e investigação.
    for (let i = 0; i < replacedCouponIds.length; i++) {
      await createAuditLog({
        actorUserId: actor.id,
        actorRole: actor.roles[0],
        entityType: AuditEntity.ORDER,
        entityId: replacedCouponIds[i],
        action: AuditAction.UPDATE,
        newValues: {
          active: false,
          deactivation_reason: 'replaced',
          replaced_by_coupon_id: coupon.id,
          replaced_by_coupon_code: code,
        },
      })
    }

    revalidateTag('coupons')
    return {
      coupon: coupon as CouponRow,
      replaced_coupon_ids: replacedCouponIds.length > 0 ? replacedCouponIds : undefined,
      replaced_coupon_codes: replacedCouponCodes.length > 0 ? replacedCouponCodes : undefined,
    }
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

/**
 * Catalog-side coupon preview.
 *
 * Returns full coupon shape (not just id) keyed by `product_id` so the
 * catalog grid can show "you have a coupon — pay R$ X" before the order
 * is even created. Without this the discount only became visible *after*
 * the buyer placed the order, which trapped them in a "is the coupon
 * really active?" loop reported on 2026-04-28.
 *
 * Usage: call once at the top of `app/(private)/catalog/page.tsx` and
 * pass the resulting map down to `CatalogGrid` as a prop.
 *
 * Resolution: clinic > doctor (CLINIC_ADMIN's clinic coupons take
 * precedence; DOCTOR sees their personal coupons).
 */
export type { CatalogCouponPreview } from '@/lib/coupons/preview'
import type { CatalogCouponPreview } from '@/lib/coupons/preview'

export async function getActiveCouponsByProductForBuyer(args: {
  clinicId: string | null
  doctorId?: string | null
  productIds: string[]
}): Promise<Record<string, CatalogCouponPreview>> {
  const { clinicId, doctorId, productIds } = args
  if (!productIds.length) return {}
  if (!clinicId && !doctorId) return {}

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const base = admin
    .from('coupons')
    .select('id, product_id, code, discount_type, discount_value, max_discount_amount, valid_until')
    .eq('active', true)
    .not('activated_at', 'is', null)
    .in('product_id', productIds)
    .or(`valid_until.is.null,valid_until.gte.${now}`)

  const query = clinicId ? base.eq('clinic_id', clinicId) : base.eq('doctor_id', doctorId!)

  const { data, error } = await query
  if (error || !data?.length) return {}

  return Object.fromEntries(
    data.map((c) => [
      c.product_id as string,
      {
        id: c.id as string,
        code: c.code as string,
        // ADR-002: discount_type pode ser qualquer um dos 5 valores.
        discount_type: c.discount_type as CatalogCouponPreview['discount_type'],
        discount_value: Number(c.discount_value),
        max_discount_amount: c.max_discount_amount == null ? null : Number(c.max_discount_amount),
        valid_until: c.valid_until as string | null,
      } satisfies CatalogCouponPreview,
    ])
  )
}

// NOTE: the pure helper `previewDiscountedUnitPrice` lives in
// `lib/coupons/preview.ts`. We deliberately do NOT re-export it from
// here because this file carries `'use server'` and re-exporting a
// non-async function would violate the App Router contract (caught by
// tests/unit/services/coupons-use-server.test.ts). Callers — both
// server and client — should import the helper directly from
// `@/lib/coupons/preview`.
