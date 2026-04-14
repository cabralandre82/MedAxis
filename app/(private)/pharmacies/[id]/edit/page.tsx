import { notFound } from 'next/navigation'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'
import { BackButton } from '@/components/ui/back-button'
import type { Pharmacy } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Farmácia | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditPharmacyPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()
  const { data: pharmacy } = await supabase.from('pharmacies').select('*').eq('id', id).single()

  if (!pharmacy) notFound()

  return (
    <div className="space-y-6">
      <div>
        <BackButton
          href={`/pharmacies/${id}`}
          label={(pharmacy as unknown as Pharmacy).trade_name}
        />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Farmácia</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm pharmacy={pharmacy as unknown as Pharmacy} />
      </div>
    </div>
  )
}
