'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle, FileQuestion, Loader2, X, FileSignature } from 'lucide-react'
import { ALL_REQUESTABLE_DOCS } from '@/lib/registration-constants'

interface RegistrationActionsProps {
  requestId: string
  entityType?: 'CLINIC' | 'DOCTOR'
  entityId?: string
}

type Panel = null | 'reject' | 'docs'

export function RegistrationActions({ requestId, entityType, entityId }: RegistrationActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [contractLoading, setContractLoading] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedDocs, setSelectedDocs] = useState<
    Array<{ type: string; label: string; custom_text: string }>
  >([])
  const [customDocText, setCustomDocText] = useState<Record<string, string>>({})

  async function callAction(body: object) {
    setLoading(true)
    try {
      const res = await fetch(`/api/registration/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Erro ao processar ação')
        return false
      }
      return true
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    const ok = await callAction({ action: 'approve' })
    if (ok) {
      toast.success('Cadastro aprovado! Email enviado ao solicitante.')
      router.push('/registrations')
      router.refresh()
    }
  }

  async function handleSendContract() {
    if (!entityType || !entityId) return
    setContractLoading(true)
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error('Erro ao enviar contrato: ' + (json.error ?? 'Tente novamente'))
        return
      }
      toast.success('Contrato enviado para assinatura digital via Clicksign!')
    } finally {
      setContractLoading(false)
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      toast.error('Informe o motivo da reprovação')
      return
    }
    const ok = await callAction({ action: 'reject', admin_notes: rejectReason })
    if (ok) {
      toast.success('Solicitação reprovada. Email enviado ao solicitante.')
      router.push('/registrations')
      router.refresh()
    }
  }

  async function handleRequestDocs() {
    if (selectedDocs.length === 0) {
      toast.error('Selecione ao menos um documento')
      return
    }
    const docs = selectedDocs.map((d) => ({
      type: d.type,
      label: d.label,
      custom_text: customDocText[d.type] ?? '',
    }))
    const ok = await callAction({ action: 'request_docs', requested_docs: docs })
    if (ok) {
      toast.success('Solicitação enviada ao cadastrante.')
      router.refresh()
      setPanel(null)
    }
  }

  function toggleDoc(type: string, label: string) {
    setSelectedDocs((prev) =>
      prev.find((d) => d.type === type)
        ? prev.filter((d) => d.type !== type)
        : [...prev, { type, label, custom_text: '' }]
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold tracking-wider text-gray-500 uppercase">Ações</h2>

      {panel === null && (
        <div className="flex flex-wrap gap-3">
          {entityType && entityId && (
            <Button
              variant="outline"
              onClick={handleSendContract}
              disabled={contractLoading}
              className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
            >
              {contractLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSignature className="h-4 w-4" />
              )}
              Enviar contrato
            </Button>
          )}
          <Button
            onClick={handleApprove}
            disabled={loading}
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Aprovar cadastro
          </Button>
          <Button
            variant="outline"
            onClick={() => setPanel('docs')}
            disabled={loading}
            className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            <FileQuestion className="h-4 w-4" />
            Pedir documentos
          </Button>
          <Button
            variant="outline"
            onClick={() => setPanel('reject')}
            disabled={loading}
            className="gap-2 border-red-300 text-red-600 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4" />
            Reprovar
          </Button>
        </div>
      )}

      {/* Reject panel */}
      {panel === 'reject' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-red-700">Motivo da reprovação</p>
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Fechar painel de reprovação"
              title="Fechar"
            >
              <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </button>
          </div>
          <Textarea
            placeholder="Explique ao solicitante o motivo da reprovação..."
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setPanel(null)} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={handleReject}
              disabled={loading}
              className="flex-1 gap-2 bg-red-600 hover:bg-red-700"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar reprovação
            </Button>
          </div>
        </div>
      )}

      {/* Request docs panel */}
      {panel === 'docs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-amber-700">
              Selecione os documentos necessários
            </p>
            <button
              type="button"
              onClick={() => setPanel(null)}
              aria-label="Fechar painel de solicitação de documentos"
              title="Fechar"
            >
              <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {ALL_REQUESTABLE_DOCS.map((doc) => {
              const selected = !!selectedDocs.find((d) => d.type === doc.type)
              return (
                <div key={doc.type} className="space-y-1">
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${selected ? 'border-amber-300 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleDoc(doc.type, doc.label)}
                      className="accent-amber-600"
                    />
                    <span className="text-sm text-gray-700">{doc.label}</span>
                  </label>
                  {selected && doc.type === 'OTHER' && (
                    <input
                      type="text"
                      placeholder="Descreva o documento..."
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      value={customDocText[doc.type] ?? ''}
                      onChange={(e) =>
                        setCustomDocText((prev) => ({ ...prev, [doc.type]: e.target.value }))
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setPanel(null)} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={handleRequestDocs}
              disabled={loading}
              className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar solicitação
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
