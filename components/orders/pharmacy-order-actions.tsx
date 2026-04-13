'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import type { OrderStatus } from '@/types'
import { PackageCheck, FlaskConical, CheckCircle, Truck, MapPin, ChevronRight } from 'lucide-react'

interface StepConfig {
  status: OrderStatus
  label: string
  shortLabel: string
  icon: React.ComponentType<{ className?: string }>
}

const STEPS: StepConfig[] = [
  {
    status: 'RELEASED_FOR_EXECUTION',
    label: 'Pedido Liberado',
    shortLabel: 'Liberado',
    icon: PackageCheck,
  },
  {
    status: 'RECEIVED_BY_PHARMACY',
    label: 'Recebido pela Farmácia',
    shortLabel: 'Recebido',
    icon: PackageCheck,
  },
  {
    status: 'IN_EXECUTION',
    label: 'Em Manipulação',
    shortLabel: 'Manipulação',
    icon: FlaskConical,
  },
  {
    status: 'READY',
    label: 'Pronto para Envio',
    shortLabel: 'Pronto',
    icon: CheckCircle,
  },
  {
    status: 'SHIPPED',
    label: 'Despachado',
    shortLabel: 'Enviado',
    icon: Truck,
  },
  {
    status: 'DELIVERED',
    label: 'Entregue',
    shortLabel: 'Entregue',
    icon: MapPin,
  },
]

interface ActionConfig {
  next: OrderStatus
  buttonLabel: string
  description: string
  notesLabel: string
  notesPlaceholder: string
  notesRequired?: boolean
  trackingField?: boolean
}

const ACTIONS: Partial<Record<OrderStatus, ActionConfig>> = {
  RELEASED_FOR_EXECUTION: {
    next: 'RECEIVED_BY_PHARMACY',
    buttonLabel: 'Confirmar Recebimento do Pedido',
    description:
      'Confirme que sua farmácia recebeu e aceita executar este pedido. A partir daqui você será responsável pela manipulação e entrega.',
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: pedido recebido em perfeitas condições, conferido com a guia…',
  },
  RECEIVED_BY_PHARMACY: {
    next: 'IN_EXECUTION',
    buttonLabel: 'Iniciar Manipulação',
    description: 'Informe que a manipulação ou preparação do produto foi iniciada.',
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: farmacêutico responsável, lote iniciado…',
  },
  IN_EXECUTION: {
    next: 'READY',
    buttonLabel: 'Marcar como Pronto',
    description: 'O produto está manipulado, embalado e pronto para envio ou retirada.',
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: produto embalado e lacrado, aguardando coleta…',
  },
  READY: {
    next: 'SHIPPED',
    buttonLabel: 'Registrar Envio / Despacho',
    description:
      'Informe que o pedido foi despachado. Adicione o código de rastreamento se disponível.',
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: transportadora utilizada, previsão de entrega…',
    trackingField: true,
  },
  SHIPPED: {
    next: 'DELIVERED',
    buttonLabel: 'Confirmar Entrega',
    description: 'Confirme que o pedido foi entregue ao destinatário final.',
    notesLabel: 'Observações (opcional)',
    notesPlaceholder: 'Ex: entregue em mãos, assinatura coletada, canhoto retornado…',
  },
}

interface Props {
  orderId: string
  currentStatus: OrderStatus
}

export function PharmacyOrderActions({ orderId, currentStatus }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [trackingCode, setTrackingCode] = useState('')
  const [loading, setLoading] = useState(false)

  const action = ACTIONS[currentStatus]
  const currentStepIndex = STEPS.findIndex((s) => s.status === currentStatus)
  const isCompleted = currentStatus === 'DELIVERED' || currentStatus === 'COMPLETED'

  // Only render for statuses we manage
  const isPharmacyStep = currentStepIndex !== -1

  if (!isPharmacyStep) return null

  async function handleAction() {
    if (!action) return
    if (action.notesRequired && !notes.trim()) {
      toast.error(`${action.notesLabel} é obrigatório`)
      return
    }

    setLoading(true)
    const reasonParts: string[] = []
    if (trackingCode.trim()) reasonParts.push(`Rastreio: ${trackingCode.trim()}`)
    if (notes.trim()) reasonParts.push(notes.trim())
    const reason = reasonParts.join(' | ') || undefined

    try {
      const res = await fetch(`/api/orders/${orderId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: action.next, reason }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao atualizar status')
      } else {
        toast.success('Status do pedido atualizado!')
        setOpen(false)
        setNotes('')
        setTrackingCode('')
        router.refresh()
      }
    } catch {
      toast.error('Erro de conexão')
    }
    setLoading(false)
  }

  return (
    <Card className="border-blue-100 bg-blue-50/40">
      <CardContent className="pt-4">
        {/* Stepper */}
        <div className="mb-4">
          <p className="mb-3 text-xs font-semibold tracking-wide text-blue-700 uppercase">
            Progresso do Pedido
          </p>
          <div className="flex items-center gap-0">
            {STEPS.map((step, idx) => {
              const Icon = step.icon
              const isDone = idx < currentStepIndex
              const isCurrent = idx === currentStepIndex
              const isFuture = idx > currentStepIndex

              return (
                <div key={step.status} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1" style={{ minWidth: 48 }}>
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                        isDone
                          ? 'bg-green-500 text-white'
                          : isCurrent
                            ? 'bg-blue-600 text-white ring-2 ring-blue-200'
                            : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <span
                      className={`text-center text-[10px] leading-tight font-medium ${
                        isDone
                          ? 'text-green-600'
                          : isCurrent
                            ? 'text-blue-700'
                            : isFuture
                              ? 'text-gray-400'
                              : 'text-gray-400'
                      }`}
                      style={{ maxWidth: 48 }}
                    >
                      {step.shortLabel}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 ${idx < currentStepIndex ? 'bg-green-400' : 'bg-gray-200'}`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Action button or completed state */}
        {isCompleted ? (
          <p className="text-center text-sm font-medium text-green-700">
            ✓ Pedido entregue com sucesso
          </p>
        ) : action ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="w-full" size="sm" />}>
              <ChevronRight className="mr-2 h-4 w-4" />
              {action.buttonLabel}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{action.buttonLabel}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">{action.description}</p>

                {action.trackingField && (
                  <div className="space-y-1.5">
                    <Label htmlFor="tracking">
                      Código de rastreamento{' '}
                      <span className="font-normal text-gray-400">(opcional)</span>
                    </Label>
                    <Input
                      id="tracking"
                      value={trackingCode}
                      onChange={(e) => setTrackingCode(e.target.value)}
                      placeholder="Ex: BR123456789BR"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="notes">
                    {action.notesLabel}
                    {action.notesRequired && <span className="ml-1 text-red-500">*</span>}
                  </Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={action.notesPlaceholder}
                  />
                </div>

                <div className="flex gap-3">
                  <Button onClick={handleAction} disabled={loading}>
                    {loading ? 'Salvando...' : 'Confirmar'}
                  </Button>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardContent>
    </Card>
  )
}
