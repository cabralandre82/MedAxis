'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { productSchema, priceUpdateSchema } from '@/lib/validators'
import type { ProductFormData, PriceUpdateFormData } from '@/lib/validators'
import { slugify } from '@/lib/utils'
import { createNotificationForRole } from '@/lib/notifications'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Removes accents and keeps only alphanumeric chars, uppercased.
 * "Hormônios" → "HOR", "FarmaMag SP" → "FAR"
 */
function toAbbrev(text: string, len: number): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, len)
    .toUpperCase()
    .padEnd(len, 'X')
}

/**
 * Generates a unique SKU in the format [CAT3]-[FAR3]-[NNNN].
 * NNNN = total products for this pharmacy + 1 (zero-padded).
 * Falls back with a random hex suffix if a collision occurs.
 */
export async function generateSKU(
  categoryId: string,
  pharmacyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient<any>
): Promise<string> {
  const [{ data: cat }, { data: pharma }, { count }] = await Promise.all([
    adminClient.from('product_categories').select('name').eq('id', categoryId).single(),
    adminClient.from('pharmacies').select('trade_name').eq('id', pharmacyId).single(),
    adminClient
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('pharmacy_id', pharmacyId),
  ])

  const catPart = toAbbrev((cat as { name: string } | null)?.name ?? 'PRD', 3)
  const farPart = toAbbrev((pharma as { trade_name: string } | null)?.trade_name ?? 'FRM', 3)
  const seq = String((count ?? 0) + 1).padStart(4, '0')

  return `${catPart}-${farPart}-${seq}`
}

export async function createProduct(
  data: ProductFormData
): Promise<{ id?: string; error?: string; sku?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()

    // PHARMACY_ADMIN can only create products for their own pharmacy
    if (user.roles.includes('PHARMACY_ADMIN')) {
      const { data: member } = await adminClient
        .from('pharmacy_members')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .single()
      if (!member || member.pharmacy_id !== parsed.data.pharmacy_id) {
        return { error: 'Sem permissão para criar produto nesta farmácia' }
      }
      // Platform sets price_current — pharmacy always creates with 0 and inactive
      parsed.data.price_current = 0
      parsed.data.status = 'inactive'
    }

    const slug = parsed.data.slug || slugify(parsed.data.name)

    // Auto-generate SKU if not provided
    const sku =
      parsed.data.sku ||
      (await generateSKU(parsed.data.category_id, parsed.data.pharmacy_id, adminClient))

    const { data: product, error } = await adminClient
      .from('products')
      .insert({
        ...parsed.data,
        sku,
        slug,
        active: parsed.data.status !== 'inactive',
        status: parsed.data.status ?? 'active',
        featured: parsed.data.featured ?? false,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        // Rare collision — retry with random suffix
        const fallbackSku = `${sku}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        const { data: retryProduct, error: retryError } = await adminClient
          .from('products')
          .insert({
            ...parsed.data,
            sku: fallbackSku,
            slug,
            active: parsed.data.status !== 'inactive',
            status: parsed.data.status ?? 'active',
            featured: parsed.data.featured ?? false,
          })
          .select('id')
          .single()
        if (retryError) return { error: 'Erro ao criar produto' }
        await createAuditLog({
          actorUserId: user.id,
          actorRole: user.roles[0],
          entityType: AuditEntity.PRODUCT,
          entityId: retryProduct.id,
          action: AuditAction.CREATE,
          newValues: { ...parsed.data, sku: fallbackSku } as Record<string, unknown>,
        })
        if (user.roles.includes('PHARMACY_ADMIN')) {
          await notifyAdminsNewProduct(retryProduct.id, parsed.data.name, fallbackSku)
        }
        revalidatePath('/products')
        revalidatePath('/catalog')
        revalidateTag('dashboard')
        return { id: retryProduct.id, sku: fallbackSku }
      }
      return { error: 'Erro ao criar produto' }
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: product.id,
      action: AuditAction.CREATE,
      newValues: { ...parsed.data, sku } as Record<string, unknown>,
    })

    if (user.roles.includes('PHARMACY_ADMIN')) {
      await notifyAdminsNewProduct(product.id, parsed.data.name, sku)
    }

    revalidatePath('/products')
    revalidatePath('/catalog')
    revalidateTag('dashboard')
    return { id: product.id, sku }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updateProduct(
  id: string,
  data: Partial<ProductFormData>
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient.from('products').select('*').eq('id', id).single()

    // PHARMACY_ADMIN can only update products belonging to their own pharmacy
    if (user.roles.includes('PHARMACY_ADMIN')) {
      const { data: member } = await adminClient
        .from('pharmacy_members')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .single()
      if (
        !member ||
        !existing ||
        (existing as { pharmacy_id: string }).pharmacy_id !== member.pharmacy_id
      ) {
        return { error: 'Sem permissão para editar produto desta farmácia' }
      }
    }

    const updateData: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() }
    delete updateData['price_current']
    if (data.status) updateData['active'] = data.status !== 'inactive'

    const { error } = await adminClient.from('products').update(updateData).eq('id', id)

    if (error) return { error: 'Erro ao atualizar produto' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: id,
      action: AuditAction.UPDATE,
      oldValues: existing ?? undefined,
      newValues: data as Record<string, unknown>,
    })

    revalidatePath('/products')
    revalidatePath(`/catalog`)
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function updateProductPrice(
  productId: string,
  data: PriceUpdateFormData
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = priceUpdateSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()

    const { data: product } = await adminClient
      .from('products')
      .select('price_current')
      .eq('id', productId)
      .single()

    if (!product) return { error: 'Produto não encontrado' }

    await adminClient.from('product_price_history').insert({
      product_id: productId,
      old_price: product.price_current,
      new_price: parsed.data.new_price,
      changed_by_user_id: user.id,
      reason: parsed.data.reason,
    })

    const { error } = await adminClient
      .from('products')
      .update({
        price_current: parsed.data.new_price,
        needs_price_review: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)

    if (error) return { error: 'Erro ao atualizar preço' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: productId,
      action: AuditAction.PRICE_CHANGE,
      oldValues: { price: product.price_current },
      newValues: { price: parsed.data.new_price, reason: parsed.data.reason },
    })

    revalidatePath('/products')
    revalidatePath('/catalog')
    revalidateTag('dashboard')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function updatePharmacyCost(
  productId: string,
  newCost: number,
  reason: string
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])
    if (!reason?.trim()) return { error: 'Motivo é obrigatório' }
    if (newCost < 0) return { error: 'Custo deve ser maior ou igual a zero' }

    const adminClient = createAdminClient()

    const { data: product } = await adminClient
      .from('products')
      .select('pharmacy_cost, pharmacy_id, price_current, name, sku')
      .eq('id', productId)
      .single()

    if (!product) return { error: 'Produto não encontrado' }

    // PHARMACY_ADMIN can only update cost of their own pharmacy's products
    if (user.roles.includes('PHARMACY_ADMIN')) {
      const { data: member } = await adminClient
        .from('pharmacy_members')
        .select('pharmacy_id')
        .eq('user_id', user.id)
        .single()
      if (!member || (product as { pharmacy_id: string }).pharmacy_id !== member.pharmacy_id) {
        return { error: 'Sem permissão para alterar custo deste produto' }
      }
    }

    await adminClient.from('product_pharmacy_cost_history').insert({
      product_id: productId,
      old_cost: product.pharmacy_cost,
      new_cost: newCost,
      changed_by_user_id: user.id,
      reason,
    })

    const priceCurrentNum = Number(product.price_current ?? 0)

    // Determine if the product needs to be auto-deactivated (selling at a loss)
    const shouldDeactivate = priceCurrentNum > 0 && newCost >= priceCurrentNum

    const updatePayload: Record<string, unknown> = {
      pharmacy_cost: newCost,
      updated_at: new Date().toISOString(),
      // flag for admin to review price_current whenever pharmacy changes their cost
      ...(priceCurrentNum > 0 ? { needs_price_review: true } : {}),
    }
    if (shouldDeactivate) {
      updatePayload.active = false
    }

    const { error } = await adminClient.from('products').update(updatePayload).eq('id', productId)

    if (error) return { error: 'Erro ao atualizar custo de farmácia' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: productId,
      action: AuditAction.UPDATE,
      oldValues: { pharmacy_cost: product.pharmacy_cost },
      newValues: { pharmacy_cost: newCost, reason, ...(shouldDeactivate ? { active: false } : {}) },
    })

    // Notify admins about the cost change (always, when product has a price set)
    if (priceCurrentNum > 0) {
      await notifyAdminsCostUpdated(
        productId,
        product.name,
        product.sku,
        newCost,
        priceCurrentNum,
        shouldDeactivate
      )
    }

    revalidatePath(`/products/${productId}`)
    revalidatePath('/products')
    revalidateTag('dashboard')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function dismissPriceReview(productId: string): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('products')
      .update({ needs_price_review: false, updated_at: new Date().toISOString() })
      .eq('id', productId)

    if (error) return { error: 'Erro ao dispensar revisão' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: productId,
      action: AuditAction.UPDATE,
      newValues: { needs_price_review: false, note: 'Revisão dispensada pelo admin' },
    })

    revalidatePath(`/products/${productId}`)
    revalidatePath('/products')
    revalidateTag('dashboard')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

export async function toggleProductActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('products')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return { error: 'Erro ao atualizar produto' }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: id,
      action: AuditAction.STATUS_CHANGE,
      newValues: { active },
    })

    revalidatePath('/products')
    revalidatePath('/catalog')
    return {}
  } catch {
    return { error: 'Erro interno' }
  }
}

/**
 * Sends an in-app notification to all SUPER_ADMIN and PLATFORM_ADMIN users
 * when a pharmacy creates a product that needs pricing before going live.
 */
async function notifyAdminsCostUpdated(
  productId: string,
  productName: string,
  sku: string,
  newCost: number,
  priceCurrentNum: number,
  autoDeactivated: boolean
): Promise<void> {
  const label = `${productName} (${sku})`
  const link = `/products/${productId}`

  let title: string
  let body: string

  if (autoDeactivated) {
    // Tier 3 — critical: product deactivated to prevent loss
    title = '🔴 Produto desativado — repasse excede preço ao cliente'
    body = `${label}: repasse atualizado para R$ ${newCost.toFixed(2)}, que é ≥ ao preço praticado (R$ ${priceCurrentNum.toFixed(2)}). Produto desativado automaticamente. Atualize o preço ao cliente para reativar.`
  } else {
    const marginPct = ((priceCurrentNum - newCost) / priceCurrentNum) * 100

    if (marginPct <= 15) {
      // Tier 2 — warning: margin critically low
      title = '🟠 Margem crítica após ajuste de repasse'
      body = `${label}: repasse agora R$ ${newCost.toFixed(2)} (margem ${marginPct.toFixed(1)}%). Revise o preço ao cliente com urgência para manter a margem saudável.`
    } else {
      // Tier 1 — info: healthy margin, but admin should still review
      title = '🟡 Repasse atualizado — revise o preço ao cliente'
      body = `${label}: repasse atualizado para R$ ${newCost.toFixed(2)} (margem atual ${marginPct.toFixed(1)}%). Margem parece OK, mas revise o preço ao cliente para confirmar.`
    }
  }

  const payload = {
    type: 'PRODUCT_COST_UPDATED' as const,
    title,
    body,
    link,
    push: true,
  }
  try {
    await Promise.all([
      createNotificationForRole('SUPER_ADMIN', payload),
      createNotificationForRole('PLATFORM_ADMIN', payload),
    ])
  } catch {
    // Notification failure must never block cost update
  }
}

async function notifyAdminsNewProduct(
  productId: string,
  productName: string,
  sku: string
): Promise<void> {
  const payload = {
    type: 'PRODUCT_AWAITING_PRICE' as const,
    title: 'Novo produto aguardando precificação',
    body: `${productName} (${sku}) foi cadastrado por uma farmácia e precisa de preço antes de ir ao catálogo.`,
    link: `/products/${productId}`,
    push: true,
  }
  try {
    await Promise.all([
      createNotificationForRole('SUPER_ADMIN', payload),
      createNotificationForRole('PLATFORM_ADMIN', payload),
    ])
  } catch {
    // Notification failure must never block product creation
  }
}
