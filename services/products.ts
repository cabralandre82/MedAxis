'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { productSchema, priceUpdateSchema } from '@/lib/validators'
import type { ProductFormData, PriceUpdateFormData } from '@/lib/validators'
import { slugify } from '@/lib/utils'

export async function createProduct(
  data: ProductFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = productSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()

    const slug = parsed.data.slug || slugify(parsed.data.name)
    const { data: product, error } = await adminClient
      .from('products')
      .insert({
        ...parsed.data,
        slug,
        active: parsed.data.active ?? true,
        featured: parsed.data.featured ?? false,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'SKU ou slug já existente' }
      return { error: 'Erro ao criar produto' }
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: product.id,
      action: AuditAction.CREATE,
      newValues: parsed.data as Record<string, unknown>,
    })

    revalidatePath('/products')
    revalidatePath('/catalog')
    return { id: product.id }
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
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { data: existing } = await adminClient.from('products').select('*').eq('id', id).single()

    const updateData: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() }
    delete updateData['price_current']

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
      price: product.price_current,
      changed_by_user_id: user.id,
      reason: parsed.data.reason,
    })

    const { error } = await adminClient
      .from('products')
      .update({ price_current: parsed.data.new_price, updated_at: new Date().toISOString() })
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
