import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { ClinicForm } from '@/components/clinics/clinic-form'
import type { Clinic } from '@/types'

export const metadata = { title: 'Editar Clínica | MedAxis' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditClinicPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()
  const { data: clinic } = await supabase.from('clinics').select('*').eq('id', id).single()

  if (!clinic) notFound()

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/clinics" className="hover:text-primary">
            Clínicas
          </Link>
          <span>/</span>
          <Link href={`/clinics/${id}`} className="hover:text-primary">
            {(clinic as unknown as Clinic).trade_name}
          </Link>
          <span>/</span>
          <span>Editar</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Clínica</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ClinicForm clinic={clinic as unknown as Clinic} />
      </div>
    </div>
  )
}
