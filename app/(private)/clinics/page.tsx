import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Clínicas | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function ClinicsPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { page: pageRaw } = await searchParams
  const supabase = createAdminClient()

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: clinics, count } = await supabase
    .from('clinics')
    .select('id, trade_name, corporate_name, cnpj, city, state, status, email, phone', {
      count: 'exact',
    })
    .order('trade_name')
    .range(from, to)

  const columns = [
    { key: 'trade_name', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'city', label: 'Cidade' },
    { key: 'state', label: 'UF' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status', type: 'status' as const },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clínicas</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} clínica(s) no total</p>
        </div>
        <ButtonLink href="/clinics/new">
          <Plus className="mr-2 h-4 w-4" />
          Nova clínica
        </ButtonLink>
      </div>
      <EntityTable data={clinics ?? []} columns={columns} detailPath="/clinics" />
      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
