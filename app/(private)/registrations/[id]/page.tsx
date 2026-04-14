import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatDate } from '@/lib/utils'
import { Building2, Stethoscope, FileText, ExternalLink } from 'lucide-react'
import { BackButton } from '@/components/ui/back-button'
import {
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUS_COLORS,
} from '@/lib/registration-constants'
import { RegistrationActions } from './registration-actions'
import { OcrAnalysisButton } from '@/components/registrations/ocr-analysis-button'

export const metadata: Metadata = { title: 'Analisar solicitação | Clinipharma' }

export default async function RegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRolePage(['SUPER_ADMIN'])

  const { id } = await params
  const admin = createAdminClient()

  const { data: request } = await admin
    .from('registration_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (!request) notFound()

  const { data: documents } = await admin
    .from('registration_documents')
    .select('*')
    .eq('request_id', id)
    .order('uploaded_at')

  const fd = request.form_data as Record<string, string>
  const isClinic = request.type === 'CLINIC'

  const fields = isClinic
    ? [
        { label: 'Nome do responsável', value: fd.full_name },
        { label: 'Nome da clínica', value: fd.trade_name },
        { label: 'CNPJ', value: fd.cnpj },
        { label: 'Email', value: fd.email },
        { label: 'Telefone', value: fd.phone },
        { label: 'Endereço', value: fd.address_line_1 },
        { label: 'Complemento', value: fd.address_line_2 },
        { label: 'Cidade/UF', value: fd.city && fd.state ? `${fd.city} / ${fd.state}` : undefined },
      ]
    : [
        { label: 'Nome', value: fd.full_name },
        { label: 'CRM', value: fd.crm ? `${fd.crm}/${fd.crm_state}` : undefined },
        { label: 'Especialidade', value: fd.specialty },
        { label: 'Email', value: fd.email },
        { label: 'Telefone', value: fd.phone },
        { label: 'CNPJ da clínica', value: fd.clinic_cnpj },
        { label: 'Nome da clínica', value: fd.clinic_name },
      ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton href="/registrations" label="Solicitações de cadastro" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            {isClinic ? (
              <Building2 className="h-5 w-5 text-blue-600" />
            ) : (
              <Stethoscope className="h-5 w-5 text-purple-600" />
            )}
            <h1 className="text-xl font-bold text-gray-900">
              Solicitação de {isClinic ? 'Clínica' : 'Médico'}
            </h1>
          </div>
          <p className="text-sm text-gray-500">Recebida em {formatDate(request.created_at)}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${REGISTRATION_STATUS_COLORS[request.status]}`}
        >
          {REGISTRATION_STATUS_LABELS[request.status]}
        </span>
      </div>

      {/* Data */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-gray-500 uppercase">
          Dados informados
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields
            .filter((f) => f.value)
            .map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-gray-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm font-medium text-gray-900">{f.value}</dd>
              </div>
            ))}
        </dl>
      </div>

      {/* Documents */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-gray-500 uppercase">
          Documentos enviados ({documents?.length ?? 0})
        </h2>
        {(documents ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum documento enviado ainda.</p>
        ) : (
          <div className="space-y-2">
            {(documents ?? []).map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{doc.label}</p>
                    <p className="text-xs text-gray-400">{doc.filename}</p>
                  </div>
                </div>
                {doc.public_url && (
                  <a
                    href={doc.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-[hsl(196,91%,36%)] hover:underline"
                  >
                    Abrir <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin notes */}
      {request.admin_notes && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="mb-1 text-xs font-semibold tracking-wider text-red-600 uppercase">
            Motivo da reprovação
          </p>
          <p className="text-sm text-red-800">{request.admin_notes}</p>
        </div>
      )}

      {/* Requested docs */}
      {request.requested_docs &&
        (request.requested_docs as Array<{ label: string; custom_text?: string }>).length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <p className="mb-2 text-xs font-semibold tracking-wider text-amber-700 uppercase">
              Documentos solicitados
            </p>
            <ul className="space-y-1">
              {(request.requested_docs as Array<{ label: string; custom_text?: string }>).map(
                (d, i) => (
                  <li key={i} className="text-sm text-amber-900">
                    • {d.label}
                    {d.custom_text ? `: ${d.custom_text}` : ''}
                  </li>
                )
              )}
            </ul>
          </div>
        )}

      {/* OCR Document Analysis */}
      <OcrAnalysisButton registrationId={id} />

      {/* Actions */}
      {request.status !== 'APPROVED' && request.status !== 'REJECTED' && (
        <RegistrationActions requestId={id} />
      )}
    </div>
  )
}
