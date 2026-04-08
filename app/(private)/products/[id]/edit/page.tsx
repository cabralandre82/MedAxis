import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { ProductForm } from '@/components/products/product-form'
import type { ProductWithRelations, ProductCategory, Pharmacy } from '@/types'

export const metadata = { title: 'Editar Produto | MedAxis' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditProductPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()

  const [{ data: productRaw }, { data: categoriesRaw }, { data: pharmaciesRaw }] =
    await Promise.all([
      supabase.from('products').select('*').eq('id', id).single(),
      supabase.from('product_categories').select('*').order('name'),
      supabase
        .from('pharmacies')
        .select('id, trade_name, status')
        .eq('status', 'ACTIVE')
        .order('trade_name'),
    ])

  if (!productRaw) notFound()

  const product = productRaw as unknown as ProductWithRelations
  const categories = (categoriesRaw ?? []) as unknown as ProductCategory[]
  const pharmacies = (pharmaciesRaw ?? []) as unknown as Pharmacy[]

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
        <ProductForm product={product} categories={categories} pharmacies={pharmacies} />
      </div>
    </div>
  )
}
