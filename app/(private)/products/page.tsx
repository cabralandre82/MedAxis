import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange, formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { Plus, Package, ExternalLink, X } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Produtos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string; needs_review?: string }>
}

export default async function ProductsPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])
  const { page: pageRaw, needs_review } = await searchParams
  const supabase = createAdminClient()
  const currentUser = await getCurrentUser()
  const isPharmacy = currentUser?.roles.includes('PHARMACY_ADMIN') ?? false
  const filterReview = needs_review === '1' && !isPharmacy

  // Resolve pharmacy membership for scoping
  let pharmacyId: string | undefined
  if (isPharmacy && currentUser) {
    const { data: membership } = await supabase
      .from('pharmacy_members')
      .select('pharmacy_id')
      .eq('user_id', currentUser.id)
      .single()
    pharmacyId = membership?.pharmacy_id ?? undefined
  }

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  let q = supabase
    .from('products')
    .select(
      `id, name, sku, concentration, presentation, price_current,
       estimated_deadline_days, active, featured, needs_price_review,
       product_categories (name), pharmacies (trade_name)`,
      { count: 'exact' }
    )
    .order('price_current', { ascending: true }) // unpriced (0) float to top
    .order('name')

  if (isPharmacy && pharmacyId) q = q.eq('pharmacy_id', pharmacyId)
  if (filterReview) q = q.eq('needs_price_review', true)

  const { data: products, count } = await q.range(from, to)

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

      {filterReview && (
        <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-sm font-medium text-orange-800">
            ⚠️ Mostrando apenas produtos com repasse atualizado — verifique o preço ao cliente
          </p>
          <Link
            href="/products"
            className="ml-4 flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtro
          </Link>
        </div>
      )}

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
                      <div className="flex flex-col gap-1">
                        {p.price_current === 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            ⏳ Aguardando preço
                          </span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              p.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {p.active ? 'Ativo' : 'Inativo'}
                          </span>
                        )}
                        {!isPharmacy && p.needs_price_review && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                            ⚠️ Revisar preço
                          </span>
                        )}
                      </div>
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
