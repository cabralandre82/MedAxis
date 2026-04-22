'use client'

import { useState } from 'react'
import { ScanText, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ExtractedDoc {
  filename: string
  extracted?: {
    cnpj?: string
    razao_social?: string
    validade?: string
    tipo_documento?: string
    responsavel_tecnico?: string
    municipio?: string
    uf?: string
    raw_confidence: 'high' | 'medium' | 'low'
  } | null
  error?: string
  size?: number
  contentType?: string
}

interface OcrResult {
  registrationId: string
  formData: { cnpj?: string; corporate_name?: string }
  extractions: ExtractedDoc[]
  summary: {
    documentsAnalyzed: number
    cnpjMatch: boolean
    nameMatch: boolean
    overallConfidence: 'high' | 'medium' | 'low'
  }
}

const CONFIDENCE_COLORS = {
  high: 'text-green-600',
  medium: 'text-amber-600',
  low: 'text-red-500',
}

const CONFIDENCE_LABELS = {
  high: 'Alta legibilidade',
  medium: 'Legibilidade parcial',
  low: 'Documento ilegível',
}

export function OcrAnalysisButton({ registrationId }: { registrationId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function handleAnalyze() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/registrations/${registrationId}/ocr`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Erro na análise')
        return
      }
      setResult(json as OcrResult)
      setExpanded(true)
    } catch {
      setError('Erro ao conectar com a API de OCR')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanText className="h-4 w-4 text-indigo-600" aria-hidden="true" />
          <span className="text-sm font-medium text-indigo-800">Análise de documentos com IA</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
            OCR
          </span>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
            >
              {expanded ? (
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              )}
              {expanded ? 'Ocultar' : 'Ver resultado'}
            </button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleAnalyze}
            disabled={loading}
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-100"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Analisando...
              </>
            ) : (
              <>
                <ScanText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {result ? 'Reanalisar' : 'Analisar documentos'}
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}

      {result && expanded && (
        <div className="mt-4 space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Documentos"
              value={`${result.summary.documentsAnalyzed} analisados`}
              ok={result.summary.documentsAnalyzed > 0}
            />
            <SummaryCard
              label="CNPJ"
              value={result.summary.cnpjMatch ? 'Confere ✅' : 'Divergente ⚠️'}
              ok={result.summary.cnpjMatch}
            />
            <SummaryCard
              label="Razão social"
              value={result.summary.nameMatch ? 'Confere ✅' : 'Divergente ⚠️'}
              ok={result.summary.nameMatch}
            />
            <SummaryCard
              label="Legibilidade"
              value={CONFIDENCE_LABELS[result.summary.overallConfidence]}
              ok={result.summary.overallConfidence !== 'low'}
            />
          </div>

          {/* Per-document breakdown */}
          <div className="space-y-2">
            {result.extractions.map((doc, i) => (
              <div key={i} className="rounded-lg border border-indigo-100 bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">{doc.filename}</span>
                  {doc.extracted && (
                    <span
                      className={`text-[10px] font-medium ${CONFIDENCE_COLORS[doc.extracted.raw_confidence]}`}
                    >
                      {CONFIDENCE_LABELS[doc.extracted.raw_confidence]}
                    </span>
                  )}
                </div>
                {doc.error && <p className="mt-1 text-xs text-red-500">{doc.error}</p>}
                {doc.extracted && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    {doc.extracted.tipo_documento && (
                      <Field label="Tipo" value={doc.extracted.tipo_documento} />
                    )}
                    {doc.extracted.cnpj && (
                      <Field
                        label="CNPJ extraído"
                        value={doc.extracted.cnpj}
                        match={
                          doc.extracted.cnpj?.replace(/\D/g, '') ===
                          result.formData.cnpj?.replace(/\D/g, '')
                        }
                      />
                    )}
                    {doc.extracted.razao_social && (
                      <Field label="Razão social" value={doc.extracted.razao_social} />
                    )}
                    {doc.extracted.validade && (
                      <Field label="Validade" value={doc.extracted.validade} />
                    )}
                    {doc.extracted.responsavel_tecnico && (
                      <Field label="Resp. técnico" value={doc.extracted.responsavel_tecnico} />
                    )}
                    {doc.extracted.municipio && (
                      <Field
                        label="Município"
                        value={`${doc.extracted.municipio}/${doc.extracted.uf ?? ''}`}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-right text-[10px] text-indigo-400">
            Análise gerada por IA — confirme os dados manualmente antes de aprovar.
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2 ${ok ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'}`}
    >
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-xs font-medium ${ok ? 'text-green-700' : 'text-amber-700'}`}>{value}</p>
    </div>
  )
}

function Field({ label, value, match }: { label: string; value: string; match?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span
        className={`text-xs font-medium ${match === false ? 'text-red-600' : match === true ? 'text-green-700' : 'text-gray-700'}`}
      >
        {value}
        {match === true && ' ✅'}
        {match === false && ' ⚠️'}
      </span>
    </div>
  )
}
