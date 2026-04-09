import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange, formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { Plus, Package, ExternalLink } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Produtos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function ProductsPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { page: pageRaw } = await searchParams
  const supabase = await createClient()

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: products, count } = await supabase
    .from('products')
    .select(
      `id, name, sku, concentration, presentation, price_current,
       estimated_deadline_days, active, featured,
       product_categories (name), pharmacies (trade_name)`,
      { count: 'exact' }
    )
    .order('name')
    .range(from, to)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Produtos</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} produto(s) no total</p>
        </div>
        <ButtonLink href="/products/new">
          <Plus className="mr-2 h-4 w-4" />
          Novo produto
        </ButtonLink>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Produto</TableHead>
                <TableHead className="font-semibold">SKU</TableHead>
                <TableHead className="font-semibold">Categoria</TableHead>
                <TableHead className="font-semibold">Farmácia</TableHead>
                <TableHead className="text-right font-semibold">Preço</TableHead>
                <TableHead className="text-center font-semibold">Prazo</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center">
                    <Package className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                    <p className="text-gray-400">Nenhum produto cadastrado</p>
                    <ButtonLink href="/products/new" size="sm" className="mt-3">
                      Adicionar produto
                    </ButtonLink>
                  </TableCell>
                </TableRow>
              ) : (
                products?.map((p) => (
                  <TableRow key={p.id} className="hover:bg-gray-50">
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-400">
                          {p.concentration} · {p.presentation}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-gray-500">{p.sku}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {(p.product_categories as unknown as { name: string } | null)?.name ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {(p.pharmacies as unknown as { trade_name: string } | null)?.trade_name ??
                          '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold text-[hsl(213,75%,24%)]">
                        {formatCurrency(p.price_current)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm text-gray-600">{p.estimated_deadline_days}d</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {p.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/products/${p.id}`}
                        className="text-gray-400 hover:text-[hsl(196,91%,36%)]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
