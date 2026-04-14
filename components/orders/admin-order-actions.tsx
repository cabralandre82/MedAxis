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
import { getAllowedTransitions } from '@/lib/orders/status-machine'
import type { OrderStatus } from '@/types'
import { updateOrderStatus } from '@/services/orders'
import { XCircle, CheckCircle, ChevronRight, AlertTriangle } from 'lucide-react'

interface Props {
  orderId: string
  currentStatus: OrderStatus
}

/** Human-readable labels for admin-initiated transitions */
const TRANSITION_CONFIG: Record<
  string,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    variant: 'destructive' | 'default' | 'outline'
    requiresReason: boolean
    confirmMessage?: string
  }
> = {
  CANCELED: {
    label: 'Cancelar pedido',
    icon: XCircle,
    variant: 'destructive',
    requiresReason: true,
    confirmMessage:
      'O cancelamento não pode ser desfeito. Informe o motivo para registrar no histórico.',
  },
  COMPLETED: {
    label: 'Marcar como concluído',
    icon: CheckCircle,
    variant: 'default',
    requiresReason: false,
  },
  RELEASED_FOR_EXECUTION: {
    label: 'Liberar para execução',
    icon: ChevronRight,
    variant: 'outline',
    requiresReason: false,
  },
}

/** Statuses that already have a dedicated UI or don't need an admin button */
const SKIP_STATUSES = new Set([
  'AWAITING_DOCUMENTS',
  'READY_FOR_REVIEW',
  'AWAITING_PAYMENT',
  'PAYMENT_UNDER_REVIEW',
  'PAYMENT_CONFIRMED',
  'COMMISSION_CALCULATED',
  'TRANSFER_PENDING',
  'TRANSFER_COMPLETED',
  'RECEIVED_BY_PHARMACY',
  'IN_EXECUTION',
  'READY',
  'SHIPPED',
  'WITH_ISSUE',
])

function ActionButton({ orderId, targetStatus }: { orderId: string; targetStatus: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const cfg = TRANSITION_CONFIG[targetStatus]
  if (!cfg) return null

  const Icon = cfg.icon

  async function handleConfirm() {
    if (cfg.requiresReason && !reason.trim()) return
    setLoading(true)
    const result = await updateOrderStatus(orderId, targetStatus, reason.trim() || undefined)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Pedido ${cfg.label.toLowerCase()} com sucesso`)
      setOpen(false)
      setReason('')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={cfg.variant} size="sm" className="gap-1.5" />}>
        <Icon className="h-4 w-4" />
        {cfg.label}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {cfg.variant === 'destructive' && <AlertTriangle className="h-5 w-5 text-red-500" />}
            {cfg.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {cfg.confirmMessage && <p className="text-sm text-gray-600">{cfg.confirmMessage}</p>}
          <div>
            <Label htmlFor="admin-reason">
              Motivo {cfg.requiresReason ? <span className="text-red-500">*</span> : '(opcional)'}
            </Label>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={cfg.requiresReason ? 'Informe o motivo…' : 'Observação opcional…'}
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Voltar
            </Button>
            <Button
              variant={cfg.variant}
              onClick={handleConfirm}
              disabled={loading || (cfg.requiresReason && !reason.trim())}
            >
              {loading ? 'Salvando…' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AdminOrderActions({ orderId, currentStatus }: Props) {
  const allowed = getAllowedTransitions(currentStatus, 'admin')

  // Show buttons only for transitions that have an explicit config
  // and are not handled elsewhere in the page flow
  const actionTargets = allowed.filter((s) => TRANSITION_CONFIG[s] && !SKIP_STATUSES.has(s))

  if (actionTargets.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actionTargets.map((target) => (
        <ActionButton key={target} orderId={orderId} targetStatus={target} />
      ))}
    </div>
  )
}
