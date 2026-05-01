'use server'

/**
 * Server actions for the tiered pricing engine (PR-C1 of ADR-001).
 *
 * Five entry points, all SUPER_ADMIN only:
 *
 *   - togglePricingMode(productId, mode, change_reason)
 *       flips products.pricing_mode between 'FIXED' and 'TIERED_PROFILE'.
 *       No data change beyond the flag — does NOT create/destroy
 *       profiles. Operator's responsibility to ensure a profile is
 *       active before flipping to TIERED_PROFILE (the freeze trigger
 *       fails loudly otherwise, so worst case is an order that can't
 *       be created — no silent corruption).
 *
 *   - savePricingProfile(productId, formData)
 *       Atomically: expires the live profile (if any) and inserts a
 *       new one with the given pharmacy_cost / floor / consultant
 *       basis + the tier list. Backed by RPC set_pricing_profile_atomic
 *       (mig-076).
 *
 *   - createBuyerOverride(formData)
 *       Inserts a row in buyer_pricing_overrides. Trigger
 *       trg_bpo_no_overlap rejects overlapping ranges for the same
 *       (product, buyer).
 *
 *   - expireBuyerOverride(overrideId, change_reason)
 *       Sets effective_until = effective_from + 1ms (or now() if
 *       sufficiently later) so the row is still semantically valid
 *       under the temporal CHECK and the EXCLUDE.
 *
 *   - listOverridesForProduct(productId)
 *       Returns all overrides (live + historical) for a product, with
 *       buyer name resolved (clinic.trade_name or doctors.full_name).
 *       Used by PR-C2's UI.
 *
 * Audit: every write goes to audit_logs.
 *
 * @module services/pricing
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/db/admin'
import { requireRole } from '@/lib/rbac'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import {
  pricingProfileSchema,
  buyerPricingOverrideSchema,
  type PricingProfileFormData,
  type BuyerPricingOverrideFormData,
} from '@/lib/validators'
import type { PricingMode, PricingProfile, PricingProfileTier, BuyerPricingOverride } from '@/types'

// ── Toggle pricing mode ──────────────────────────────────────────────────

// Same loose UUID regex used by `coupons` / other admin-side schemas —
// `z.string().uuid()` is strict-RFC4122 and rejects perfectly valid
// (but artificially uniform) test fixtures.
const uuidLoose = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'ID inválido')

const togglePricingModeSchema = z.object({
  productId: uuidLoose,
  mode: z.enum(['FIXED', 'TIERED_PROFILE']),
  changeReason: z.string().min(1).max(500),
})

/**
 * Sets `products.pricing_mode`. Doesn't validate that a live profile
 * exists when switching to TIERED_PROFILE — the freeze trigger handles
 * that defensively (loud failure on item insert). UI should preflight
 * via {@link getActivePricingProfile} and warn the operator.
 */
export async function togglePricingMode(
  productId: string,
  mode: PricingMode,
  changeReason: string
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const parsed = togglePricingModeSchema.safeParse({ productId, mode, changeReason })
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }

    const admin = createAdminClient()
    const { data: existing, error: readErr } = await admin
      .from('products')
      .select('pricing_mode')
      .eq('id', productId)
      .single()
    if (readErr || !existing) {
      logger.warn('[pricing] togglePricingMode product missing', {
        productId,
        code: readErr?.code,
        message: readErr?.message,
      })
      return { error: 'Produto não encontrado' }
    }
    const previousMode = (existing as { pricing_mode: PricingMode }).pricing_mode

    if (previousMode === mode) {
      // No-op — but record an audit row anyway so the operator's intent
      // is visible (e.g. "tried to toggle but it was already ON").
      await createAuditLog({
        actorUserId: actor.id,
        actorRole: actor.roles[0],
        entityType: AuditEntity.PRODUCT,
        entityId: productId,
        action: AuditAction.UPDATE,
        oldValues: { pricing_mode: previousMode },
        newValues: { pricing_mode: mode, change_reason: changeReason, noop: true },
      })
      return {}
    }

    const { error: writeErr } = await admin
      .from('products')
      .update({ pricing_mode: mode, updated_at: new Date().toISOString() })
      .eq('id', productId)
    if (writeErr) {
      logger.error('[pricing] togglePricingMode update failed', {
        productId,
        code: writeErr.code,
        message: writeErr.message,
      })
      return { error: 'Erro ao alterar o modo de precificação' }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: productId,
      action: AuditAction.UPDATE,
      oldValues: { pricing_mode: previousMode },
      newValues: { pricing_mode: mode, change_reason: changeReason },
    })

    revalidatePath(`/products/${productId}`)
    revalidatePath(`/products/${productId}/pricing`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('[pricing] togglePricingMode unexpected', { productId, error: err })
    return { error: 'Erro interno' }
  }
}

// ── Save pricing profile (atomic via RPC) ────────────────────────────────

export interface SavePricingProfileResult {
  profileId?: string
  tierIds?: string[]
  expiredPreviousId?: string | null
  error?: string
}

/**
 * Validates and persists a new pricing profile + tiers atomically.
 * Backed by `set_pricing_profile_atomic` (mig-076), which:
 *   1. expires the live profile (if any) by setting effective_until,
 *   2. inserts the new profile with effective_from immediately after,
 *   3. inserts all tiers, rejecting overlap.
 *
 * Errors come back as Portuguese strings for the form to render.
 */
export async function savePricingProfile(
  productId: string,
  input: PricingProfileFormData
): Promise<SavePricingProfileResult> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    // Diagnostic info — when a support request says "I clicked save and
    // nothing happened" this single line in the Vercel runtime log
    // confirms whether the action was even reached. Cheap (one line per
    // submit, never per request) and safe (no PII, no $ values logged).
    logger.info('[pricing] savePricingProfile invoked', {
      productId,
      actorId: actor.id,
      tierCount: Array.isArray(input?.tiers) ? input.tiers.length : 0,
    })
    const parsed = pricingProfileSchema.safeParse(input)
    if (!parsed.success) {
      logger.warn('[pricing] savePricingProfile validation failed', {
        productId,
        issue: parsed.error.issues[0]?.message,
      })
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }

    const admin = createAdminClient()
    const profile = parsed.data

    const { data, error } = await admin.rpc('set_pricing_profile_atomic', {
      p_product_id: productId,
      p_profile: {
        pharmacy_cost_unit_cents: profile.pharmacy_cost_unit_cents,
        platform_min_unit_cents: profile.platform_min_unit_cents ?? null,
        platform_min_unit_pct: profile.platform_min_unit_pct ?? null,
        consultant_commission_basis: profile.consultant_commission_basis,
        consultant_commission_fixed_per_unit_cents:
          profile.consultant_commission_fixed_per_unit_cents ?? null,
        change_reason: profile.change_reason,
      },
      p_tiers: profile.tiers.map((t) => ({
        min_quantity: t.min_quantity,
        max_quantity: t.max_quantity,
        unit_price_cents: t.unit_price_cents,
      })),
      p_actor_user_id: actor.id,
    })

    if (error) {
      logger.warn('[pricing] savePricingProfile RPC error', {
        productId,
        message: error.message,
      })
      // Map known P0001 reasons to friendly messages.
      const m = (error.message ?? '').toLowerCase()
      if (m.includes('product_not_found')) return { error: 'Produto não encontrado' }
      if (m.includes('no_tiers')) return { error: 'Pelo menos 1 tier é obrigatório' }
      if (m.includes('invalid_actor')) return { error: 'Sem permissão' }
      if (m.includes('invalid_profile')) return { error: 'Configuração de profile inválida' }
      if (m.includes('invalid_tier')) {
        return { error: 'Tiers com sobreposição ou valor inválido' }
      }
      return { error: 'Erro ao salvar pricing profile' }
    }

    const result = data as {
      profile_id: string
      tier_ids: string[]
      expired_previous: string | null
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: productId,
      action: AuditAction.UPDATE,
      newValues: {
        pricing_profile_id: result.profile_id,
        tier_count: result.tier_ids.length,
        expired_previous: result.expired_previous,
        change_reason: profile.change_reason,
      },
    })

    revalidatePath(`/products/${productId}`)
    revalidatePath(`/products/${productId}/pricing`)

    return {
      profileId: result.profile_id,
      tierIds: result.tier_ids,
      expiredPreviousId: result.expired_previous,
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('[pricing] savePricingProfile unexpected', { productId, error: err })
    return { error: 'Erro interno' }
  }
}

// ── Read helpers (used by PR-C2 pages) ───────────────────────────────────

/**
 * Returns the currently-live profile for a product (effective_until IS NULL),
 * along with its tiers ordered by min_quantity. Null when no profile exists.
 */
export async function getActivePricingProfile(productId: string): Promise<{
  profile: PricingProfile | null
  tiers: PricingProfileTier[]
}> {
  await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const admin = createAdminClient()

  const { data: profile, error: profileErr } = await admin
    .from('pricing_profiles')
    .select('*')
    .eq('product_id', productId)
    .is('effective_until', null)
    .maybeSingle()

  if (profileErr) {
    logger.warn('[pricing] getActivePricingProfile read failed', {
      productId,
      code: profileErr.code,
      message: profileErr.message,
    })
    return { profile: null, tiers: [] }
  }
  if (!profile) return { profile: null, tiers: [] }

  const typedProfile = profile as unknown as PricingProfile

  const { data: tiers } = await admin
    .from('pricing_profile_tiers')
    .select('*')
    .eq('pricing_profile_id', typedProfile.id)
    .order('min_quantity', { ascending: true })

  return {
    profile: typedProfile,
    tiers: (tiers ?? []) as unknown as PricingProfileTier[],
  }
}

/**
 * Returns the full profile history for a product (newest first).
 */
export async function listPricingProfileHistory(productId: string): Promise<PricingProfile[]> {
  await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const admin = createAdminClient()

  const { data } = await admin
    .from('pricing_profiles')
    .select('*')
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })

  return (data ?? []) as unknown as PricingProfile[]
}

// ── Buyer override actions ───────────────────────────────────────────────

export async function createBuyerOverride(
  input: BuyerPricingOverrideFormData
): Promise<{ overrideId?: string; error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const parsed = buyerPricingOverrideSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }
    const data = parsed.data

    const admin = createAdminClient()
    const { data: row, error } = await admin
      .from('buyer_pricing_overrides')
      .insert({
        product_id: data.product_id,
        clinic_id: data.clinic_id ?? null,
        doctor_id: data.doctor_id ?? null,
        platform_min_unit_cents: data.platform_min_unit_cents ?? null,
        platform_min_unit_pct: data.platform_min_unit_pct ?? null,
        change_reason: data.change_reason,
        created_by_user_id: actor.id,
      })
      .select('id')
      .single()

    if (error) {
      logger.warn('[pricing] createBuyerOverride insert failed', {
        productId: data.product_id,
        code: error.code,
        message: error.message,
      })
      // Trigger trg_bpo_no_overlap throws SQLSTATE 23505 with a
      // recognisable message — translate it to something operators
      // can act on.
      if (error.code === '23505' || (error.message ?? '').includes('overlap detected')) {
        return { error: 'Já existe um override ativo para este buyer e produto' }
      }
      if (error.code === '23514') {
        return { error: 'Configuração inválida (verifique os pisos)' }
      }
      return { error: 'Erro ao criar override de pricing' }
    }

    const overrideId = (row as { id: string }).id

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: data.product_id,
      action: AuditAction.CREATE,
      newValues: {
        buyer_pricing_override_id: overrideId,
        clinic_id: data.clinic_id,
        doctor_id: data.doctor_id,
        platform_min_unit_cents: data.platform_min_unit_cents,
        platform_min_unit_pct: data.platform_min_unit_pct,
        change_reason: data.change_reason,
      },
    })

    revalidatePath(`/products/${data.product_id}`)
    revalidatePath(`/products/${data.product_id}/pricing`)
    return { overrideId }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('[pricing] createBuyerOverride unexpected', { error: err })
    return { error: 'Erro interno' }
  }
}

const expireOverrideSchema = z.object({
  overrideId: uuidLoose,
  changeReason: z.string().min(1).max(500),
})

export async function expireBuyerOverride(
  overrideId: string,
  changeReason: string
): Promise<{ error?: string }> {
  try {
    const actor = await requireRole(['SUPER_ADMIN'])
    const parsed = expireOverrideSchema.safeParse({ overrideId, changeReason })
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }
    }

    const admin = createAdminClient()

    // Fetch effective_from to honour the temporal CHECK
    // (effective_until > effective_from). +1ms is the minimum delta;
    // if now() is already greater, use that.
    const { data: existing, error: readErr } = await admin
      .from('buyer_pricing_overrides')
      .select('id, product_id, effective_from, effective_until, clinic_id, doctor_id')
      .eq('id', overrideId)
      .single()

    if (readErr || !existing) {
      return { error: 'Override não encontrado' }
    }

    const typedRow = existing as unknown as BuyerPricingOverride

    if (typedRow.effective_until !== null) {
      return { error: 'Override já estava encerrado' }
    }

    const fromMs = new Date(typedRow.effective_from).getTime()
    const nowMs = Date.now()
    const targetMs = Math.max(nowMs, fromMs + 1)

    const { error: writeErr } = await admin
      .from('buyer_pricing_overrides')
      .update({ effective_until: new Date(targetMs).toISOString() })
      .eq('id', overrideId)

    if (writeErr) {
      logger.error('[pricing] expireBuyerOverride update failed', {
        overrideId,
        code: writeErr.code,
        message: writeErr.message,
      })
      return { error: 'Erro ao encerrar override' }
    }

    await createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: typedRow.product_id,
      action: AuditAction.UPDATE,
      oldValues: { buyer_pricing_override_id: overrideId, status: 'live' },
      newValues: {
        buyer_pricing_override_id: overrideId,
        status: 'expired',
        change_reason: changeReason,
      },
    })

    revalidatePath(`/products/${typedRow.product_id}`)
    revalidatePath(`/products/${typedRow.product_id}/pricing`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    logger.error('[pricing] expireBuyerOverride unexpected', { overrideId, error: err })
    return { error: 'Erro interno' }
  }
}

/**
 * Returns ALL overrides for a product (live + historical), with the
 * buyer name resolved (clinic.trade_name or doctors.full_name) for
 * UI display. Sorted newest-first so the "active" rows show on top.
 */
export interface OverrideListRow extends BuyerPricingOverride {
  buyer_label: string
  buyer_kind: 'clinic' | 'doctor'
}

export async function listOverridesForProduct(productId: string): Promise<OverrideListRow[]> {
  await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('buyer_pricing_overrides')
    .select(
      'id, product_id, clinic_id, doctor_id, platform_min_unit_cents, platform_min_unit_pct, effective_from, effective_until, created_by_user_id, change_reason, created_at'
    )
    .eq('product_id', productId)
    .order('effective_from', { ascending: false })

  if (error) {
    logger.warn('[pricing] listOverridesForProduct failed', {
      productId,
      code: error.code,
      message: error.message,
    })
    return []
  }
  if (!data || data.length === 0) return []

  const rows = data as unknown as BuyerPricingOverride[]
  const clinicIds = Array.from(new Set(rows.map((r) => r.clinic_id).filter(Boolean))) as string[]
  const doctorIds = Array.from(new Set(rows.map((r) => r.doctor_id).filter(Boolean))) as string[]

  const [clinics, doctors] = await Promise.all([
    clinicIds.length > 0
      ? admin.from('clinics').select('id, trade_name').in('id', clinicIds)
      : Promise.resolve({ data: [], error: null }),
    doctorIds.length > 0
      ? admin.from('doctors').select('id, full_name').in('id', doctorIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const clinicByID = new Map(
    ((clinics.data as Array<{ id: string; trade_name: string }>) ?? []).map((c) => [
      c.id,
      c.trade_name,
    ])
  )
  const doctorByID = new Map(
    ((doctors.data as Array<{ id: string; full_name: string }>) ?? []).map((d) => [
      d.id,
      d.full_name,
    ])
  )

  return rows.map((r) => ({
    ...r,
    buyer_label: r.clinic_id
      ? (clinicByID.get(r.clinic_id) ?? '(clínica desconhecida)')
      : (doctorByID.get(r.doctor_id ?? '') ?? '(médico desconhecido)'),
    buyer_kind: r.clinic_id ? 'clinic' : 'doctor',
  }))
}
