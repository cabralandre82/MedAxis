import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'
import type { Pharmacy } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Distribuidora | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditDistributorPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()
  const { data: distributor } = await supabase
    .from('pharmacies')
    .select('*')
    .eq('id', id)
    .eq('entity_type', 'DISTRIBUTOR')
    .single()

  if (!distributor) notFound()

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/distributors" className="hover:text-primary">
            Distribuidoras
          </Link>
          <span>/</span>
          <Link href={`/distributors/${id}`} className="hover:text-primary">
            {(distributor as unknown as Pharmacy).trade_name}
          </Link>
          <span>/</span>
          <span>Editar</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Distribuidora</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm
          pharmacy={distributor as unknown as Pharmacy}
          entityType="DISTRIBUTOR"
          listPath="/distributors"
        />
      </div>
    </div>
  )
}
