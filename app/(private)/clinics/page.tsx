import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Clínicas' }

export default async function ClinicsPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const { data: clinics } = await supabase
    .from('clinics')
    .select('id, trade_name, corporate_name, cnpj, city, state, status, email, phone')
    .order('trade_name')

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
          <p className="mt-0.5 text-sm text-gray-500">{clinics?.length ?? 0} clínica(s)</p>
        </div>
        <ButtonLink href="/clinics/new">
          <Plus className="mr-2 h-4 w-4" />
          Nova clínica
        </ButtonLink>
      </div>
      <EntityTable data={clinics ?? []} columns={columns} detailPath="/clinics" />
    </div>
  )
}
