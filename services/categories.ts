'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { createAuditLog, AuditAction, AuditEntity } from '@/lib/audit'
import { requireRole } from '@/lib/rbac'
import { slugify } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const categorySchema = z.object({
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  description: z.string().optional(),
  sort_order: z.number().int().min(0).optional(),
})

export type CategoryFormData = z.infer<typeof categorySchema>

export async function createCategory(
  data: CategoryFormData
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const parsed = categorySchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()
    const slug = slugify(parsed.data.name)

    const { data: category, error } = await adminClient
      .from('product_categories')
      .insert({
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? null,
        sort_order: parsed.data.sort_order ?? 0,
        is_active: true,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'Já existe uma categoria com esse nome ou slug' }
      logger.error('[createCategory] insert failed', { error })
      return { error: 'Erro ao criar categoria' }
    }

    await createAuditLog({
      actorUserId: user.id,
      actorRole: user.roles[0],
      entityType: AuditEntity.PRODUCT,
      entityId: category.id,
      action: AuditAction.CREATE,
      newValues: { name: parsed.data.name, slug } as Record<string, unknown>,
    })

    revalidatePath('/categories')
    revalidatePath('/products/new')
    return { id: category.id }
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updateCategory(
  id: string,
  data: Partial<CategoryFormData>
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (data.name !== undefined) {
      updateData.name = data.name
      updateData.slug = slugify(data.name)
    }
    if (data.description !== undefined) updateData.description = data.description
    if (data.sort_order !== undefined) updateData.sort_order = data.sort_order

    const { error } = await adminClient.from('product_categories').update(updateData).eq('id', id)

    if (error) {
      if (error.code === '23505') return { error: 'Já existe uma categoria com esse nome' }
      logger.error('[updateCategory] update failed', { id, error })
      return { error: 'Erro ao atualizar categoria' }
    }

    revalidatePath('/categories')
    revalidatePath('/products/new')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function toggleCategoryActive(
  id: string,
  is_active: boolean
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('product_categories')
      .update({ is_active, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      logger.error('[toggleCategoryActive] update failed', { id, is_active, error })
      return { error: 'Erro ao alterar status da categoria' }
    }

    revalidatePath('/categories')
    revalidatePath('/catalog')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function reorderCategory(id: string, sort_order: number): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('product_categories')
      .update({ sort_order, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      logger.error('[reorderCategory] update failed', { id, sort_order, error })
      return { error: 'Erro ao reordenar categoria' }
    }

    revalidatePath('/categories')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}
