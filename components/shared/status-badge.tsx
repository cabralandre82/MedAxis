'use client'

import { Badge } from '@/components/ui/badge'
import type { EntityStatus, OrderStatus } from '@/types'

const entityStatusConfig: Record<EntityStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'bg-yellow-100 text-yellow-800' },
  ACTIVE: { label: 'Ativo', className: 'bg-green-100 text-green-800' },
  INACTIVE: { label: 'Inativo', className: 'bg-gray-100 text-gray-600' },
  SUSPENDED: { label: 'Suspenso', className: 'bg-red-100 text-red-800' },
  BLOCKED: { label: 'Bloqueado', className: 'bg-red-200 text-red-900' },
}

const orderStatusConfig: Record<OrderStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Rascunho', className: 'bg-gray-100 text-gray-600' },
  AWAITING_DOCUMENTS: { label: 'Docs Pendentes', className: 'bg-yellow-100 text-yellow-800' },
  READY_FOR_REVIEW: { label: 'Em Revisão', className: 'bg-blue-100 text-blue-800' },
  AWAITING_PAYMENT: { label: 'Aguard. Pagamento', className: 'bg-orange-100 text-orange-800' },
  PAYMENT_UNDER_REVIEW: { label: 'Pag. em Análise', className: 'bg-orange-50 text-orange-700' },
  PAYMENT_CONFIRMED: { label: 'Pag. Confirmado', className: 'bg-green-100 text-green-800' },
  COMMISSION_CALCULATED: { label: 'Comissão Calc.', className: 'bg-teal-100 text-teal-800' },
  TRANSFER_PENDING: { label: 'Aguard. Repasse', className: 'bg-purple-100 text-purple-800' },
  TRANSFER_COMPLETED: { label: 'Repasse Feito', className: 'bg-purple-200 text-purple-900' },
  RELEASED_FOR_EXECUTION: { label: 'Lib. Execução', className: 'bg-cyan-100 text-cyan-800' },
  RECEIVED_BY_PHARMACY: { label: 'Recebido Farm.', className: 'bg-cyan-200 text-cyan-900' },
  IN_EXECUTION: { label: 'Em Execução', className: 'bg-blue-100 text-blue-800' },
  READY: { label: 'Pronto', className: 'bg-indigo-100 text-indigo-800' },
  SHIPPED: { label: 'Enviado', className: 'bg-indigo-200 text-indigo-900' },
  DELIVERED: { label: 'Entregue', className: 'bg-green-100 text-green-800' },
  COMPLETED: { label: 'Concluído', className: 'bg-green-200 text-green-900' },
  CANCELED: { label: 'Cancelado', className: 'bg-red-100 text-red-800' },
  WITH_ISSUE: { label: 'Com Problema', className: 'bg-red-200 text-red-900' },
}

export function EntityStatusBadge({ status }: { status: EntityStatus }) {
  const config = entityStatusConfig[status] ?? { label: status, className: 'bg-gray-100' }
  return <Badge className={config.className}>{config.label}</Badge>
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = orderStatusConfig[status] ?? { label: status, className: 'bg-gray-100' }
  return <Badge className={config.className}>{config.label}</Badge>
}
