import { notFound } from 'next/navigation'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { DoctorForm } from '@/components/doctors/doctor-form'
import { BackButton } from '@/components/ui/back-button'
import type { Doctor } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Médico | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditDoctorPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()
  const { data: doctor } = await supabase.from('doctors').select('*').eq('id', id).single()

  if (!doctor) notFound()

  return (
    <div className="space-y-6">
      <div>
        <BackButton href={`/doctors/${id}`} label={(doctor as unknown as Doctor).full_name} />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Médico</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <DoctorForm doctor={doctor as unknown as Doctor} />
      </div>
    </div>
  )
}
