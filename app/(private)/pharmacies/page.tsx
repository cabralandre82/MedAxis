import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Farmácias | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function PharmaciesPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { page: pageRaw } = await searchParams
  const supabase = await createClient()

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: pharmacies, count } = await supabase
    .from('pharmacies')
    .select('id, trade_name, cnpj, city, state, email, phone, responsible_person, status', {
      count: 'exact',
    })
    .order('trade_name')
    .range(from, to)

  const columns = [
    { key: 'trade_name', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'responsible_person', label: 'Responsável' },
    { key: 'city', label: 'Cidade' },
    { key: 'state', label: 'UF' },
    { key: 'status', label: 'Status', type: 'status' as const },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Farmácias</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} farmácia(s) no total</p>
        </div>
        <ButtonLink href="/pharmacies/new">
          <Plus className="mr-2 h-4 w-4" />
          Nova farmácia
        </ButtonLink>
      </div>
      <EntityTable data={pharmacies ?? []} columns={columns} detailPath="/pharmacies" />
      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
