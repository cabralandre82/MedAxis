import { notFound } from 'next/navigation'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { ClinicForm } from '@/components/clinics/clinic-form'
import { BackButton } from '@/components/ui/back-button'
import type { Clinic } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Clínica | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditClinicPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()
  const { data: clinic } = await supabase.from('clinics').select('*').eq('id', id).single()

  if (!clinic) notFound()

  return (
    <div className="space-y-6">
      <div>
        <BackButton href={`/clinics/${id}`} label={(clinic as unknown as Clinic).trade_name} />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Clínica</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ClinicForm clinic={clinic as unknown as Clinic} />
      </div>
    </div>
  )
}
