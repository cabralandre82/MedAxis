import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ButtonLink } from '@/components/ui/button-link'
import { PriceUpdateForm } from '@/components/products/price-update-form'
import { Badge } from '@/components/ui/badge'
import { Package } from 'lucide-react'
import type { ProductWithRelations, ProductCategory, Pharmacy, ProductPriceHistory } from '@/types'

export const metadata = { title: 'Detalhe do Produto | MedAxis' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProductDetailAdminPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()

  const { data: productRaw } = await supabase
    .from('products')
    .select('*, product_categories(*), pharmacies(*)')
    .eq('id', id)
    .single()

  if (!productRaw) notFound()

  const product = productRaw as unknown as ProductWithRelations & {
    product_categories: ProductCategory | null
    pharmacies: Pharmacy | null
  }

  const { data: priceHistoryRaw } = await supabase
    .from('product_price_history')
    .select('*, profiles(full_name)')
    .eq('product_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  const priceHistory = (priceHistoryRaw ?? []) as unknown as Array<
    ProductPriceHistory & { profiles: { full_name: string } | null }
  >

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/products" className="hover:text-primary">
              Produtos
            </Link>
            <span>/</span>
            <span>{product.name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-500">SKU: {product.sku}</p>
        </div>
        <div className="flex gap-3">
          <PriceUpdateForm productId={id} currentPrice={product.price_current} />
          <ButtonLink href={`/products/${id}/edit`} variant="outline">
            Editar
          </ButtonLink>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
          <h2 className="font-semibold text-gray-900">Informações do Produto</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Categoria</dt>
              <dd className="mt-1 text-sm font-medium">
                {product.product_categories?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Farmácia</dt>
              <dd className="mt-1 text-sm font-medium">
                <Link
                  href={`/pharmacies/${product.pharmacy_id}`}
                  className="text-primary hover:underline"
                >
                  {product.pharmacies?.trade_name ?? '—'}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Concentração</dt>
              <dd className="mt-1 text-sm font-medium">{product.concentration}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Apresentação</dt>
              <dd className="mt-1 text-sm font-medium">{product.presentation}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Prazo de Entrega</dt>
              <dd className="mt-1 text-sm font-medium">{product.estimated_deadline_days} dias</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Cadastrado em</dt>
              <dd className="mt-1 text-sm font-medium">{formatDate(product.created_at)}</dd>
            </div>
          </dl>
          {product.short_description && (
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Descrição Curta</dt>
              <dd className="mt-1 text-sm text-gray-700">{product.short_description}</dd>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Preço & Status</h2>
            <div className="text-primary text-3xl font-bold">
              {formatCurrency(product.price_current)}
            </div>
            <div className="flex gap-2">
              <Badge
                className={
                  product.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }
              >
                {product.active ? 'Ativo' : 'Inativo'}
              </Badge>
              {product.featured && <Badge className="bg-amber-100 text-amber-800">Destaque</Badge>}
            </div>
          </div>

          <div className="flex min-h-[150px] flex-col items-center justify-center rounded-lg border bg-white p-6 text-gray-400">
            <Package className="mb-2 h-12 w-12" />
            <p className="text-sm">Sem imagens</p>
            <p className="text-xs">Upload via Supabase Storage</p>
          </div>
        </div>
      </div>

      {priceHistory.length > 0 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Histórico de Preço</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">Data</th>
                  <th className="pb-3 font-medium">Preço</th>
                  <th className="pb-3 font-medium">Alterado por</th>
                  <th className="pb-3 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {priceHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-3 text-gray-500">{formatDate(entry.created_at)}</td>
                    <td className="py-3 font-medium">{formatCurrency(entry.price)}</td>
                    <td className="py-3">{entry.profiles?.full_name ?? '—'}</td>
                    <td className="py-3 text-gray-600">{entry.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
