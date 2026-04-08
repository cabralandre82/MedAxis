import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Médicos' }

export default async function DoctorsPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const { data: doctors } = await supabase
    .from('doctors')
    .select('id, full_name, crm, crm_state, specialty, email, phone, status')
    .order('full_name')

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
          <p className="mt-0.5 text-sm text-gray-500">{doctors?.length ?? 0} médico(s)</p>
        </div>
        <ButtonLink href="/doctors/new">
          <Plus className="mr-2 h-4 w-4" />
          Novo médico
        </ButtonLink>
      </div>
      <EntityTable data={doctors ?? []} columns={columns} detailPath="/doctors" />
    </div>
  )
}
