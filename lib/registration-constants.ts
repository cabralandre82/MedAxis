export const CLINIC_REQUIRED_DOCS = [
  { type: 'CNPJ_CARD', label: 'Cartão CNPJ' },
  { type: 'OPERATING_LICENSE', label: 'Alvará de funcionamento' },
  { type: 'RESPONSIBLE_ID', label: 'RG/CPF do responsável' },
]

export const DOCTOR_REQUIRED_DOCS = [
  { type: 'CRM_CARD', label: 'Carteira CRM' },
  { type: 'IDENTITY_DOC', label: 'RG/CPF' },
]

export const EXTRA_DOC_OPTIONS = [
  { type: 'SPECIALTY_CERT', label: 'Certificado de especialidade' },
  { type: 'SOCIAL_CONTRACT', label: 'Contrato social' },
  { type: 'PROXY', label: 'Procuração' },
  { type: 'OTHER', label: 'Outro (descreva abaixo)' },
]

export const ALL_REQUESTABLE_DOCS = [
  ...CLINIC_REQUIRED_DOCS,
  ...DOCTOR_REQUIRED_DOCS,
  ...EXTRA_DOC_OPTIONS,
]

export const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Aguardando análise',
  PENDING_DOCS: 'Documentos pendentes',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
}

export const REGISTRATION_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PENDING_DOCS: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}
