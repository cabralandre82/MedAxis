import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { DoctorForm } from '@/components/doctors/doctor-form'

export const dynamic = 'force-dynamic'
import type { Doctor } from '@/types'

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
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/doctors" className="hover:text-primary">
            Médicos
          </Link>
          <span>/</span>
          <Link href={`/doctors/${id}`} className="hover:text-primary">
            {(doctor as unknown as Doctor).full_name}
          </Link>
          <span>/</span>
          <span>Editar</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Médico</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <DoctorForm doctor={doctor as unknown as Doctor} />
      </div>
    </div>
  )
}
