'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileText, Upload, CheckCircle, AlertCircle, Loader2, Pill } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { OrderItemPrescriptionState } from '@/lib/prescription-rules'

interface PrescriptionManagerProps {
  orderId: string
  items: OrderItemPrescriptionState[]
  canUpload: boolean
}

/**
 * Renders per-item prescription upload UI for orders that have products
 * with requires_prescription=true and max_units_per_prescription set (Model B).
 *
 * For Model A (simple prescription), the regular DocumentManager handles it.
 * This component is only shown when needsPerUnitPrescription=true.
 */
export function PrescriptionManager({ orderId, items, canUpload }: PrescriptionManagerProps) {
  const router = useRouter()
  const [uploading, setUploading] = useState<string | null>(null) // orderItemId being uploaded
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const perUnitItems = items.filter(
    (i) => i.requires_prescription && i.max_units_per_prescription !== null
  )

  if (perUnitItems.length === 0) return null

  async function handleUpload(item: OrderItemPrescriptionState, file: File) {
    setUploading(item.order_item_id)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('orderItemId', item.order_item_id)
      formData.append('unitsCovered', String(item.max_units_per_prescription ?? 1))

      const res = await fetch(`/api/orders/${orderId}/prescriptions`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao enviar receita')
        return
      }
      toast.success('Receita enviada com sucesso!')
      router.refresh()
    } catch {
      toast.error('Erro ao enviar receita. Tente novamente.')
    } finally {
      setUploading(null)
      const ref = fileRefs.current[item.order_item_id]
      if (ref) ref.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
        <Pill className="h-4 w-4 flex-shrink-0 text-blue-600" />
        <p className="text-sm text-blue-800">
          Os produtos abaixo exigem <strong>receita por unidade</strong>. Envie uma receita para
          cada unidade adquirida.
        </p>
      </div>

      {perUnitItems.map((item) => {
        const isUploading = uploading === item.order_item_id
        const progressPct = item.quantity > 0 ? (item.units_covered / item.quantity) * 100 : 0

        return (
          <div
            key={item.order_item_id}
            className={`space-y-3 rounded-lg border p-4 ${
              item.satisfied ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'
            }`}
          >
            {/* Item header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {item.prescription_type && (
                    <Badge variant="outline" className="py-0 text-xs">
                      {PRESCRIPTION_TYPE_LABELS[item.prescription_type] ?? item.prescription_type}
                    </Badge>
                  )}
                  <span className="text-xs text-gray-500">
                    {item.quantity} unidade{item.quantity !== 1 ? 's' : ''} •{' '}
                    {item.max_units_per_prescription === 1
                      ? '1 receita por unidade'
                      : `1 receita por ${item.max_units_per_prescription} unidades`}
                  </span>
                </div>
              </div>
              {item.satisfied ? (
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
              ) : (
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              )}
            </div>

            {/* Progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={item.satisfied ? 'text-green-700' : 'text-amber-700'}>
                  {item.units_covered} de {item.quantity} unidade{item.quantity !== 1 ? 's' : ''}{' '}
                  com receita
                </span>
                <span className={item.satisfied ? 'text-green-600' : 'text-amber-600'}>
                  {item.prescriptions_uploaded} receita
                  {item.prescriptions_uploaded !== 1 ? 's' : ''} enviada
                  {item.prescriptions_uploaded !== 1 ? 's' : ''}
                  {item.prescriptions_needed > 0 && ` · ${item.prescriptions_needed} faltando`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-all ${
                    item.satisfied ? 'bg-green-500' : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.min(progressPct, 100)}%` }}
                />
              </div>
            </div>

            {/* Upload button */}
            {canUpload && !item.satisfied && (
              <div className="space-y-2">
                {selectedItem === item.order_item_id ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isUploading}
                      onClick={() => fileRefs.current[item.order_item_id]?.click()}
                      className="gap-2 text-xs"
                    >
                      {isUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {isUploading ? 'Enviando…' : 'Selecionar arquivo'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-gray-500"
                      onClick={() => setSelectedItem(null)}
                    >
                      Cancelar
                    </Button>
                    <input
                      ref={(el) => {
                        fileRefs.current[item.order_item_id] = el
                      }}
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleUpload(item, file)
                      }}
                    />
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedItem(item.order_item_id)}
                    className="gap-2 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Enviar receita
                  </Button>
                )}
                <p className="text-xs text-gray-400">PDF, JPG, PNG · máx. 10 MB por arquivo</p>
              </div>
            )}

            {/* Uploaded list placeholder — refreshed by router.refresh() */}
            {item.prescriptions_uploaded > 0 && (
              <div className="flex items-center gap-2 border-t border-gray-200/60 pt-1 text-xs text-gray-500">
                <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {item.prescriptions_uploaded} arquivo
                  {item.prescriptions_uploaded !== 1 ? 's' : ''} enviado
                  {item.prescriptions_uploaded !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const PRESCRIPTION_TYPE_LABELS: Record<string, string> = {
  SIMPLE: 'Receita Simples',
  SPECIAL_CONTROL: 'Controle Especial',
  ANTIMICROBIAL: 'Antimicrobiano',
}
