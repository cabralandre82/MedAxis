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
import { updateOrderStatus } from '@/services/orders'
import type { OrderStatus } from '@/types'
import { Truck, PlayCircle, CheckCircle } from 'lucide-react'

const pharmacyTransitions: Partial<
  Record<
    OrderStatus,
    { next: OrderStatus; label: string; icon: React.ComponentType<{ className?: string }> }
  >
> = {
  RELEASED_FOR_EXECUTION: {
    next: 'IN_EXECUTION',
    label: 'Iniciar Execução',
    icon: PlayCircle,
  },
  IN_EXECUTION: {
    next: 'SHIPPED',
    label: 'Marcar como Enviado',
    icon: Truck,
  },
  SHIPPED: {
    next: 'DELIVERED',
    label: 'Confirmar Entrega',
    icon: CheckCircle,
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
  const [loading, setLoading] = useState(false)

  const transition = pharmacyTransitions[currentStatus]

  if (!transition) return null

  const Icon = transition.icon

  async function handleAction() {
    setLoading(true)
    const result = await updateOrderStatus(orderId, transition!.next, notes || undefined)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Status atualizado para: ${transition!.next}`)
      setOpen(false)
      setNotes('')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Icon className="mr-2 h-4 w-4" />
        {transition.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transition.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Confirme a atualização do status deste pedido.</p>
          <div className="space-y-2">
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informe código de rastreio, observações, etc."
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
  )
}
