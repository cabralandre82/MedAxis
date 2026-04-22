'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Upload, FileText, X, CheckCircle2, Loader2 } from 'lucide-react'
import type { RequestedDoc } from '@/types'

interface PendingDocsUploadProps {
  requestedDocs: RequestedDoc[]
}

interface UploadedFile {
  docType: string
  label: string
  file: File
}

export function PendingDocsUpload({ requestedDocs }: PendingDocsUploadProps) {
  const router = useRouter()
  const [uploads, setUploads] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeDoc, setActiveDoc] = useState<{ type: string; label: string } | null>(null)

  function handleSelect(type: string, label: string) {
    setActiveDoc({ type, label })
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeDoc) return
    setUploads((prev) => [
      ...prev.filter((u) => u.docType !== activeDoc.type),
      { docType: activeDoc.type, label: activeDoc.label, file },
    ])
    e.target.value = ''
  }

  function removeUpload(docType: string) {
    setUploads((prev) => prev.filter((u) => u.docType !== docType))
  }

  async function handleSubmit() {
    if (uploads.length === 0) {
      toast.error('Selecione ao menos um documento para enviar')
      return
    }

    setLoading(true)
    try {
      const fd = new FormData()
      uploads.forEach((u) => {
        fd.append(`doc_${u.docType}`, u.file)
        fd.append(`doc_${u.docType}_label`, u.label)
      })

      const res = await fetch('/api/registration/upload-docs', { method: 'POST', body: fd })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? 'Erro ao enviar documentos')
        return
      }

      setDone(true)
      toast.success('Documentos enviados! Nossa equipe irá analisar em breve.')
      setTimeout(() => router.refresh(), 2000)
    } catch {
      toast.error('Erro ao enviar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
        <p className="font-semibold text-gray-900">Documentos enviados com sucesso!</p>
        <p className="text-sm text-gray-500">
          Nossa equipe foi notificada e irá analisar sua solicitação em breve.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Envie os documentos listados abaixo. Formatos aceitos: PDF, JPG, PNG (máx. 10 MB cada).
      </p>

      <div className="space-y-2">
        {requestedDocs.map((doc) => {
          const uploaded = uploads.find((u) => u.docType === doc.type)
          return (
            <div
              key={doc.type}
              className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                uploaded ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText
                  className={`h-4 w-4 flex-shrink-0 ${uploaded ? 'text-green-600' : 'text-orange-500'}`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{doc.label}</p>
                  {doc.custom_text && <p className="text-xs text-gray-500">{doc.custom_text}</p>}
                  {uploaded && (
                    <p className="truncate text-xs text-green-600">{uploaded.file.name}</p>
                  )}
                </div>
              </div>
              <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelect(doc.type, doc.label)}
                  className={
                    uploaded
                      ? 'border-green-300 text-green-700'
                      : 'border-orange-300 text-orange-700'
                  }
                >
                  <Upload className="mr-1 h-3.5 w-3.5" />
                  {uploaded ? 'Trocar' : 'Enviar'}
                </Button>
                {uploaded && (
                  <button
                    type="button"
                    onClick={() => removeUpload(doc.type)}
                    aria-label={`Remover documento ${doc.label}`}
                    title="Remover"
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileChange}
      />

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-gray-400">
          {uploads.length} de {requestedDocs.length} documento(s) selecionado(s)
        </p>
        <Button onClick={handleSubmit} disabled={loading || uploads.length === 0}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enviando...
            </>
          ) : (
            'Enviar documentos'
          )}
        </Button>
      </div>
    </div>
  )
}
