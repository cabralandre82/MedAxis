import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { CategoriesManager } from '@/components/categories/categories-manager'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Categorias de Produtos | Clinipharma' }

export default async function CategoriesPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()

  const { data: categoriesRaw } = await supabase
    .from('product_categories')
    .select('id, name, slug, description, is_active, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  // Count products per category
  const { data: counts } = await supabase.from('products').select('category_id')

  const productCountMap: Record<string, number> = {}
  for (const row of counts ?? []) {
    if (row.category_id) {
      productCountMap[row.category_id] = (productCountMap[row.category_id] ?? 0) + 1
    }
  }

  const categories = (categoriesRaw ?? []).map((c) => ({
    ...c,
    product_count: productCountMap[c.id] ?? 0,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Categorias de Produtos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Organize o catálogo agrupando produtos por tipo. As categorias também são usadas no SKU
          gerado automaticamente.
        </p>
      </div>
      <CategoriesManager categories={categories} />
    </div>
  )
}
