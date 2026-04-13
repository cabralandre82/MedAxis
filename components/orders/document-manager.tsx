'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  FileText,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { reviewDocument } from '@/services/document-review'

export const REQUIRED_DOCUMENT_TYPES: {
  type: string
  label: string
  description: string
  required: boolean
}[] = [
  {
    type: 'PRESCRIPTION',
    label: 'Receita médica',
    description: 'Receita original ou digitalizada',
    required: true,
  },
  {
    type: 'IDENTITY',
    label: 'Documento de identidade',
    description: 'RG, CNH ou passaporte do paciente',
    required: false,
  },
  {
    type: 'MEDICAL_REPORT',
    label: 'Relatório médico',
    description: 'Justificativa clínica do uso',
    required: false,
  },
  {
    type: 'AUTHORIZATION',
    label: 'Autorização especial',
    description: 'Para substâncias controladas',
    required: false,
  },
  { type: 'OTHER', label: 'Outro', description: 'Demais documentos', required: false },
]

const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  REQUIRED_DOCUMENT_TYPES.map((d) => [d.type, d.label])
)

interface DocumentManagerProps {
  orderId: string
  documents: Array<{
    id: string
    document_type: string
    original_filename: string
    mime_type: string
    file_size: number
    created_at: string
    status?: string
    rejection_reason?: string | null
  }>
  canUpload: boolean
  canReview?: boolean
}

const DOC_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Aguardando análise', className: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Aprovado', className: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Rejeitado', className: 'bg-red-100 text-red-800' },
}

export function DocumentManager({
  orderId,
  documents,
  canUpload,
  canReview = false,
}: DocumentManagerProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [selectedType, setSelectedType] = useState('PRESCRIPTION')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const uploadedTypes = new Set(documents.map((d) => d.document_type))

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('orderId', orderId)
      formData.append('documentType', selectedType)
      for (const file of files) formData.append('files', file)

      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? 'Erro ao fazer upload')
        return
      }
      toast.success('Documento(s) enviado(s) com sucesso!')
      router.refresh()
    } catch {
      toast.error('Erro ao enviar documento. Tente novamente.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDownload(docId: string, filename: string) {
    setDownloading(docId)
    try {
      const res = await fetch(`/api/documents/${docId}/download`)
      if (!res.ok) {
        toast.error('Erro ao gerar link de download')
        return
      }
      const { url } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.target = '_blank'
      a.click()
    } catch {
      toast.error('Erro ao baixar documento')
    } finally {
      setDownloading(null)
    }
  }

  async function handleReview(docId: string, decision: 'APPROVED' | 'REJECTED') {
    if (decision === 'REJECTED' && !rejectionReason.trim()) {
      toast.error('Informe o motivo da rejeição')
      return
    }
    setReviewingId(docId)
    try {
      const result = await reviewDocument(docId, decision, rejectionReason || undefined)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(decision === 'APPROVED' ? 'Documento aprovado' : 'Documento rejeitado')
      setRejectionReason('')
      router.refresh()
    } catch {
      toast.error('Erro ao revisar documento')
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Required types checklist */}
      <div className="space-y-2">
        {REQUIRED_DOCUMENT_TYPES.filter((t) => t.required).map((docType) => {
          const present = uploadedTypes.has(docType.type)
          return (
            <div
              key={docType.type}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                present ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'
              }`}
            >
              {present ? (
                <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
              )}
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${present ? 'text-green-800' : 'text-amber-800'}`}
                >
                  {docType.label}
                </p>
                <p className={`text-xs ${present ? 'text-green-600' : 'text-amber-600'}`}>
                  {present ? 'Enviado' : docType.description + ' (obrigatório)'}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Uploaded documents list */}
      {documents.length > 0 && (
        <ul className="space-y-3">
          {documents.map((doc) => {
            const statusCfg = DOC_STATUS_CONFIG[doc.status ?? 'PENDING']
            const isPending = !doc.status || doc.status === 'PENDING'
            return (
              <li key={doc.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-800">{doc.original_filename}</p>
                    <p className="text-xs text-gray-400">
                      {(doc.file_size / 1024).toFixed(0)} KB · {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0 text-xs">
                    {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                  </Badge>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusCfg.className}`}
                  >
                    {statusCfg.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDownload(doc.id, doc.original_filename)}
                    disabled={downloading === doc.id}
                    className="flex-shrink-0 text-gray-400 hover:text-blue-600 disabled:opacity-50"
                    title="Baixar documento"
                  >
                    {downloading === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* Rejection reason display */}
                {doc.status === 'REJECTED' && doc.rejection_reason && (
                  <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 px-2 py-1.5">
                    <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                    <p className="text-xs text-red-700">{doc.rejection_reason}</p>
                  </div>
                )}

                {/* Review controls — pharmacy only, pending docs only */}
                {canReview && isPending && (
                  <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                    <input
                      type="text"
                      placeholder="Motivo da rejeição (obrigatório se rejeitar)"
                      value={reviewingId === doc.id ? rejectionReason : ''}
                      onChange={(e) => {
                        setReviewingId(doc.id)
                        setRejectionReason(e.target.value)
                      }}
                      onFocus={() => setReviewingId(doc.id)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={reviewingId === doc.id && uploading}
                        onClick={() => handleReview(doc.id, 'APPROVED')}
                        className="gap-1.5 border-green-200 text-green-700 hover:bg-green-50"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Aprovar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleReview(doc.id, 'REJECTED')}
                        className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Rejeitar
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {documents.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <p>Nenhum documento anexado. O pedido não avançará sem a receita médica.</p>
        </div>
      )}

      {/* Upload form */}
      {canUpload && (
        <div className="space-y-3 rounded-lg border border-dashed border-gray-200 p-4">
          <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Adicionar documento
          </p>
          <div className="flex gap-2">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
            >
              {REQUIRED_DOCUMENT_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploading ? 'Enviando…' : 'Enviar arquivo'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleUpload}
            />
          </div>
          <p className="text-xs text-gray-400">Formatos aceitos: PDF, JPG, PNG (máx. 10 MB)</p>
        </div>
      )}
    </div>
  )
}

// Re-export for convenience in order-detail
export { DOC_TYPE_LABELS }
