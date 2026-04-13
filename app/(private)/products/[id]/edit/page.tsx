import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { ProductForm } from '@/components/products/product-form'
import type { ProductWithRelations, ProductCategory, Pharmacy } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Produto | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditProductPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])

  const supabase = createAdminClient()
  const currentUser = await getCurrentUser()
  const isPharmacy = currentUser?.roles.includes('PHARMACY_ADMIN') ?? false

  // Resolve pharmacy membership for ownership check
  let myPharmacyId: string | undefined
  if (isPharmacy && currentUser) {
    const { data: membership } = await supabase
      .from('pharmacy_members')
      .select('pharmacy_id')
      .eq('user_id', currentUser.id)
      .single()
    myPharmacyId = membership?.pharmacy_id ?? undefined
  }

  const { data: productRaw } = await supabase.from('products').select('*').eq('id', id).single()

  if (!productRaw) notFound()

  const product = productRaw as unknown as ProductWithRelations

  // PHARMACY_ADMIN can only edit products belonging to their own pharmacy
  if (isPharmacy && product.pharmacy_id !== myPharmacyId) notFound()

  const [{ data: categoriesRaw }, { data: pharmaciesRaw }, { data: settingRaw }] =
    await Promise.all([
      supabase.from('product_categories').select('*').order('name'),
      isPharmacy && myPharmacyId
        ? supabase.from('pharmacies').select('id, trade_name, status').eq('id', myPharmacyId)
        : supabase
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
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/products" className="hover:text-primary">
            Produtos
          </Link>
          <span>/</span>
          <Link href={`/products/${id}`} className="hover:text-primary">
            {product.name}
          </Link>
          <span>/</span>
          <span>Editar</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Produto</h1>
        <p className="mt-1 text-sm text-amber-600">
          Para alterar o preço, use o botão &quot;Atualizar preço&quot; na página de detalhe.
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ProductForm
          product={product}
          categories={categories}
          pharmacies={pharmacies}
          consultantRate={consultantRate}
        />
      </div>
    </div>
  )
}
