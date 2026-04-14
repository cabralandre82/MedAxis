import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatPhone, formatDate } from '@/lib/utils'
import { EntityStatusBadge } from '@/components/shared/status-badge'
import { ButtonLink } from '@/components/ui/button-link'
import { DoctorStatusActions } from '@/components/doctors/doctor-status-actions'
import { BackButton } from '@/components/ui/back-button'
import type { Doctor, EntityStatus } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Detalhe do Médico | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DoctorDetailPage({ params }: PageProps) {
  const { id } = await params
  const currentUser = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])

  const supabase = createAdminClient()
  const { data: doctor } = await supabase.from('doctors').select('*').eq('id', id).single()

  if (!doctor) notFound()

  // CLINIC_ADMIN can only view doctors linked to their clinic
  if (
    currentUser.roles.includes('CLINIC_ADMIN') &&
    !currentUser.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  ) {
    const { data: membership } = await supabase
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', currentUser.id)
      .single()
    if (membership) {
      const { data: link } = await supabase
        .from('doctor_clinic_links')
        .select('doctor_id')
        .eq('doctor_id', id)
        .eq('clinic_id', membership.clinic_id)
        .single()
      if (!link) notFound()
    }
  }

  const typedDoctor = doctor as unknown as Doctor

  const { data: linksRaw } = await supabase
    .from('doctor_clinic_links')
    .select('is_primary, clinics(id, trade_name)')
    .eq('doctor_id', id)

  const links = linksRaw as unknown as Array<{
    is_primary: boolean
    clinics: { id: string; trade_name: string } | null
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BackButton href="/doctors" label="Médicos" />
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{typedDoctor.full_name}</h1>
          <p className="text-sm text-gray-500">
            CRM {typedDoctor.crm}/{typedDoctor.crm_state}
          </p>
        </div>
        <div className="flex gap-2">
          <DoctorStatusActions doctorId={id} currentStatus={typedDoctor.status as EntityStatus} />
          <ButtonLink href={`/doctors/${id}/edit`} variant="outline">
            Editar
          </ButtonLink>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <EntityStatusBadge status={typedDoctor.status as EntityStatus} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">CRM</dt>
              <dd className="text-sm font-medium">
                {typedDoctor.crm}/{typedDoctor.crm_state}
              </dd>
            </div>
            {typedDoctor.specialty && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Especialidade</dt>
                <dd className="text-sm font-medium">{typedDoctor.specialty}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium">{typedDoctor.email}</dd>
            </div>
            {typedDoctor.phone && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Telefone</dt>
                <dd className="text-sm font-medium">{formatPhone(typedDoctor.phone)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cadastrado em</dt>
              <dd className="text-sm font-medium">{formatDate(typedDoctor.created_at)}</dd>
            </div>
          </dl>
        </div>

        {links && links.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Clínicas Vinculadas</h2>
            <div className="divide-y">
              {links.map((link, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <Link
                    href={`/clinics/${link.clinics?.id}`}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    {link.clinics?.trade_name}
                  </Link>
                  {link.is_primary && (
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                      Principal
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
