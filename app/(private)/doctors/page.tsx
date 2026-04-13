import { Metadata } from 'next'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Médicos | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function DoctorsPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { page: pageRaw } = await searchParams
  const admin = createAdminClient()

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: doctors, count } = await admin
    .from('doctors')
    .select('id, full_name, crm, crm_state, specialty, email, phone, status', { count: 'exact' })
    .order('full_name')
    .range(from, to)

  const columns = [
    { key: 'full_name', label: 'Nome' },
    { key: 'crm', label: 'CRM' },
    { key: 'crm_state', label: 'UF' },
    { key: 'specialty', label: 'Especialidade' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status', type: 'status' as const },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Médicos</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} médico(s) no total</p>
        </div>
        <ButtonLink href="/doctors/new">
          <Plus className="mr-2 h-4 w-4" />
          Novo médico
        </ButtonLink>
      </div>
      <EntityTable data={doctors ?? []} columns={columns} detailPath="/doctors" />
      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
