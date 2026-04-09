import { notFound } from 'next/navigation'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { ConsultantForm } from '@/components/consultants/consultant-form'
import type { SalesConsultant } from '@/types'

export const metadata = { title: 'Editar Consultor — MedAxis' }

export default async function EditConsultantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRolePage(['SUPER_ADMIN'])
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase.from('sales_consultants').select('*').eq('id', id).single()
  if (!data) notFound()

  const consultant = data as unknown as SalesConsultant

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Editar consultor</h1>
        <p className="mt-1 text-sm text-slate-500">{consultant.full_name}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <ConsultantForm consultant={consultant} />
      </div>
    </div>
  )
}
