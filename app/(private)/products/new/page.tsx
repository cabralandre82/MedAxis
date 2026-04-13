import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { ProductForm } from '@/components/products/product-form'

export const dynamic = 'force-dynamic'
import type { ProductCategory, Pharmacy } from '@/types'

export const metadata = { title: 'Novo Produto | Clinipharma' }

export default async function NewProductPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()

  const [{ data: categoriesRaw }, { data: pharmaciesRaw }, { data: settingRaw }] =
    await Promise.all([
      supabase.from('product_categories').select('*').order('name'),
      supabase
        .from('pharmacies')
        .select('id, trade_name, status')
        .eq('status', 'ACTIVE')
        .order('trade_name'),
      supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'consultant_commission_rate')
        .single(),
    ])

  const categories = (categoriesRaw ?? []) as unknown as ProductCategory[]
  const pharmacies = (pharmaciesRaw ?? []) as unknown as Pharmacy[]
  const consultantRate = Number(settingRaw?.value_json ?? 5)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Novo Produto</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar um produto no catálogo
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ProductForm
          categories={categories}
          pharmacies={pharmacies}
          consultantRate={consultantRate}
        />
      </div>
    </div>
  )
}
