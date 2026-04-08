import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { EntityTable } from '@/components/shared/entity-table'
import { ButtonLink } from '@/components/ui/button-link'
import { Plus } from 'lucide-react'

export const metadata: Metadata = { title: 'Farmácias' }

export default async function PharmaciesPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const supabase = await createClient()

  const { data: pharmacies } = await supabase
    .from('pharmacies')
    .select('id, trade_name, cnpj, city, state, email, phone, responsible_person, status')
    .order('trade_name')

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
          <p className="mt-0.5 text-sm text-gray-500">{pharmacies?.length ?? 0} farmácia(s)</p>
        </div>
        <ButtonLink href="/pharmacies/new">
          <Plus className="mr-2 h-4 w-4" />
          Nova farmácia
        </ButtonLink>
      </div>
      <EntityTable data={pharmacies ?? []} columns={columns} detailPath="/pharmacies" />
    </div>
  )
}
