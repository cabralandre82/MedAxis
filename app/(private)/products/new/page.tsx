import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { ProductForm } from '@/components/products/product-form'
import type { ProductCategory, Pharmacy } from '@/types'

export const metadata = { title: 'Novo Produto | MedAxis' }

export default async function NewProductPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()

  const [{ data: categoriesRaw }, { data: pharmaciesRaw }] = await Promise.all([
    supabase.from('product_categories').select('*').order('name'),
    supabase
      .from('pharmacies')
      .select('id, trade_name, status')
      .eq('status', 'ACTIVE')
      .order('trade_name'),
  ])

  const categories = (categoriesRaw ?? []) as unknown as ProductCategory[]
  const pharmacies = (pharmaciesRaw ?? []) as unknown as Pharmacy[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Novo Produto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar um produto no catálogo
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ProductForm categories={categories} pharmacies={pharmacies} />
      </div>
    </div>
  )
}
