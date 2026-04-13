'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/db/client'

const STATUS_LABELS: Record<string, string> = {
  AWAITING_DOCUMENTS: 'Aguardando Documentação',
  READY_FOR_REVIEW: 'Pronto para Revisão',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  PAYMENT_CONFIRMED: 'Pagamento Confirmado',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  TRANSFER_COMPLETED: 'Repasse Concluído',
  RELEASED_FOR_EXECUTION: 'Liberado para Execução',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Manipulação',
  READY: 'Pronto para Envio',
  SHIPPED: 'Despachado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com Problema',
}

interface Props {
  orderId: string
  /** Rendered by parent to show live connection indicator */
  onConnectionChange?: (connected: boolean) => void
}

/**
 * Invisible component: subscribes to Supabase Realtime for the given order.
 * Calls router.refresh() on any order or status-history change so all
 * open sessions (clinic, pharmacy, admin) see updates without reloading.
 *
 * Requires Realtime enabled on `orders` and `order_status_history` tables
 * in the Supabase dashboard (Table Editor → Replication).
 * RLS SELECT policies must allow the authenticated user to read the row.
 */
export function OrderRealtimeUpdater({ orderId, onConnectionChange }: Props) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const supabase = supabaseRef.current

    const channel = supabase
      .channel(`order:${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        () => {
          router.refresh()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_status_history',
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          const newStatus = (payload.new as Record<string, string>)?.new_status
          if (newStatus) {
            const label = STATUS_LABELS[newStatus] ?? newStatus
            toast.info(`Pedido atualizado: ${label}`, {
              description: 'O status foi alterado agora mesmo.',
              duration: 5000,
            })
          }
          router.refresh()
        }
      )
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED'
        setConnected(ok)
        onConnectionChange?.(ok)
      })

    return () => {
      supabase.removeChannel(channel)
      setConnected(false)
      onConnectionChange?.(false)
    }
  }, [orderId, router, onConnectionChange])

  return null
}

/** Small badge shown in the order detail header when realtime is connected. */
export function LiveBadge({ connected }: { connected: boolean }) {
  if (!connected) return null
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      Ao vivo
    </span>
  )
}
