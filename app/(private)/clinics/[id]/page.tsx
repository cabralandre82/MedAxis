import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { formatCNPJ, formatPhone, formatDate } from '@/lib/utils'
import { EntityStatusBadge } from '@/components/shared/status-badge'
import { ButtonLink } from '@/components/ui/button-link'
import { ClinicStatusActions } from '@/components/clinics/clinic-status-actions'
import { AssignConsultantDialog } from '@/components/consultants/assign-consultant-dialog'
import type { Clinic, EntityStatus, SalesConsultant } from '@/types'

export const metadata = { title: 'Detalhe da Clínica | MedAxis' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ClinicDetailPage({ params }: PageProps) {
  const { id } = await params
  const currentUser = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN')
  const supabase = await createServerClient()
  const { data: clinic } = await supabase
    .from('clinics')
    .select('*, sales_consultants(id, full_name, commission_rate, status)')
    .eq('id', id)
    .single()

  if (!clinic) notFound()

  const typedClinic = clinic as unknown as Clinic & {
    sales_consultants: Pick<SalesConsultant, 'id' | 'full_name' | 'status'> | null
  }

  const { data: allConsultants } = await supabase
    .from('sales_consultants')
    .select('id, full_name, commission_rate, status')
    .order('full_name')

  const { data: membersRaw } = await supabase
    .from('clinic_members')
    .select('id, role, profiles(full_name, email)')
    .eq('clinic_id', id)

  const members = membersRaw as unknown as Array<{
    id: string
    role: string
    profiles: { full_name: string; email: string } | null
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/clinics" className="hover:text-primary">
              Clínicas
            </Link>
            <span>/</span>
            <span>{typedClinic.trade_name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{typedClinic.trade_name}</h1>
          <p className="text-sm text-gray-500">{typedClinic.corporate_name}</p>
        </div>
        <div className="flex gap-3">
          <ButtonLink href={`/clinics/${id}/edit`} variant="outline">
            Editar
          </ButtonLink>
          <ClinicStatusActions clinicId={id} currentStatus={typedClinic.status as EntityStatus} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Informações Gerais</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <EntityStatusBadge status={typedClinic.status as EntityStatus} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">CNPJ</dt>
              <dd className="text-sm font-medium">{formatCNPJ(typedClinic.cnpj)}</dd>
            </div>
            {typedClinic.state_registration && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Inscrição Estadual</dt>
                <dd className="text-sm font-medium">{typedClinic.state_registration}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium">{typedClinic.email}</dd>
            </div>
            {typedClinic.phone && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Telefone</dt>
                <dd className="text-sm font-medium">{formatPhone(typedClinic.phone)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cadastrado em</dt>
              <dd className="text-sm font-medium">{formatDate(typedClinic.created_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Endereço</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Logradouro</dt>
              <dd className="text-right text-sm font-medium">{typedClinic.address_line_1}</dd>
            </div>
            {typedClinic.address_line_2 && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Complemento</dt>
                <dd className="text-sm font-medium">{typedClinic.address_line_2}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cidade/UF</dt>
              <dd className="text-sm font-medium">
                {typedClinic.city} / {typedClinic.state}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">CEP</dt>
              <dd className="text-sm font-medium">{typedClinic.zip_code}</dd>
            </div>
          </dl>
        </div>

        {members && members.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
            <h2 className="font-semibold text-gray-900">Membros</h2>
            <div className="divide-y">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{member.profiles?.full_name}</p>
                    <p className="text-xs text-gray-500">{member.profiles?.email}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Consultor de vendas */}
        <div className="space-y-3 rounded-lg border bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Consultor de vendas</h2>
            {isSuperAdmin && (
              <AssignConsultantDialog
                clinicId={id}
                currentConsultantId={typedClinic.consultant_id}
                consultants={(allConsultants ?? []) as unknown as SalesConsultant[]}
              />
            )}
          </div>
          {typedClinic.sales_consultants ? (
            <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-blue-900">
                  {typedClinic.sales_consultants.full_name}
                </p>
                <p className="text-xs text-blue-700">Taxa global configurada em Configurações</p>
              </div>
              <Link
                href={`/consultants/${typedClinic.sales_consultants.id}`}
                className="text-xs text-blue-600 hover:underline"
              >
                Ver perfil
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Nenhum consultor vinculado — comissão integral para a plataforma.
            </p>
          )}
        </div>

        {typedClinic.notes && (
          <div className="space-y-2 rounded-lg border bg-white p-6 md:col-span-2">
            <h2 className="font-semibold text-gray-900">Observações</h2>
            <p className="text-sm text-gray-600">{typedClinic.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
