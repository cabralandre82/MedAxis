import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/db/admin'
import { requireRolePage } from '@/lib/rbac'

import { ConsultantForm } from '@/components/consultants/consultant-form'
import { BackButton } from '@/components/ui/back-button'
import type { SalesConsultant } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Editar Consultor — Clinipharma' }

export default async function EditConsultantPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRolePage(['SUPER_ADMIN'])
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase.from('sales_consultants').select('*').eq('id', id).single()
  if (!data) notFound()

  const consultant = data as unknown as SalesConsultant

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton href={`/consultants/${id}`} label={consultant.full_name} />
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Editar consultor</h1>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <ConsultantForm consultant={consultant} />
      </div>
    </div>
  )
}
