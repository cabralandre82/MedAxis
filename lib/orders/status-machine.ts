/**
 * Order Status State Machine
 *
 * Defines which status transitions are allowed per role.
 * Any transition NOT listed here is blocked at the application level.
 */

export type OrderStatus =
  | 'DRAFT'
  | 'AWAITING_DOCUMENTS'
  | 'READY_FOR_REVIEW'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_UNDER_REVIEW'
  | 'PAYMENT_CONFIRMED'
  | 'COMMISSION_CALCULATED'
  | 'TRANSFER_PENDING'
  | 'TRANSFER_COMPLETED'
  | 'RELEASED_FOR_EXECUTION'
  | 'RECEIVED_BY_PHARMACY'
  | 'IN_EXECUTION'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'WITH_ISSUE'

/** Transitions allowed for SUPER_ADMIN and PLATFORM_ADMIN */
const ADMIN_TRANSITIONS: Record<string, OrderStatus[]> = {
  DRAFT: ['AWAITING_DOCUMENTS', 'CANCELED'],
  AWAITING_DOCUMENTS: ['READY_FOR_REVIEW', 'AWAITING_DOCUMENTS', 'CANCELED'],
  READY_FOR_REVIEW: ['AWAITING_PAYMENT', 'AWAITING_DOCUMENTS', 'CANCELED'],
  AWAITING_PAYMENT: ['PAYMENT_UNDER_REVIEW', 'PAYMENT_CONFIRMED', 'CANCELED'],
  PAYMENT_UNDER_REVIEW: ['PAYMENT_CONFIRMED', 'AWAITING_PAYMENT', 'CANCELED'],
  PAYMENT_CONFIRMED: ['COMMISSION_CALCULATED', 'CANCELED'],
  COMMISSION_CALCULATED: ['TRANSFER_PENDING', 'CANCELED'],
  TRANSFER_PENDING: ['TRANSFER_COMPLETED', 'RELEASED_FOR_EXECUTION', 'CANCELED'],
  TRANSFER_COMPLETED: ['RELEASED_FOR_EXECUTION', 'CANCELED'],
  RELEASED_FOR_EXECUTION: ['RECEIVED_BY_PHARMACY', 'CANCELED', 'WITH_ISSUE'],
  RECEIVED_BY_PHARMACY: ['IN_EXECUTION', 'WITH_ISSUE', 'CANCELED'],
  IN_EXECUTION: ['READY', 'WITH_ISSUE', 'CANCELED'],
  READY: ['SHIPPED', 'WITH_ISSUE', 'CANCELED'],
  SHIPPED: ['DELIVERED', 'WITH_ISSUE', 'CANCELED'],
  DELIVERED: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
  WITH_ISSUE: ['RELEASED_FOR_EXECUTION', 'CANCELED'],
}

/** Transitions allowed for PHARMACY_ADMIN */
const PHARMACY_TRANSITIONS: Record<string, OrderStatus[]> = {
  RELEASED_FOR_EXECUTION: ['RECEIVED_BY_PHARMACY', 'WITH_ISSUE'],
  RECEIVED_BY_PHARMACY: ['IN_EXECUTION', 'WITH_ISSUE'],
  IN_EXECUTION: ['READY', 'WITH_ISSUE'],
  READY: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  WITH_ISSUE: ['IN_EXECUTION'],
}

export function isValidTransition(
  currentStatus: string,
  newStatus: string,
  role: 'admin' | 'pharmacy'
): boolean {
  const map = role === 'admin' ? ADMIN_TRANSITIONS : PHARMACY_TRANSITIONS
  return (map[currentStatus] ?? []).includes(newStatus as OrderStatus)
}

export function getAllowedTransitions(
  currentStatus: string,
  role: 'admin' | 'pharmacy'
): OrderStatus[] {
  const map = role === 'admin' ? ADMIN_TRANSITIONS : PHARMACY_TRANSITIONS
  return map[currentStatus] ?? []
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  AWAITING_DOCUMENTS: 'Aguardando Documentos',
  READY_FOR_REVIEW: 'Em Revisão',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  PAYMENT_CONFIRMED: 'Pagamento Confirmado',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  TRANSFER_COMPLETED: 'Repasse Concluído',
  RELEASED_FOR_EXECUTION: 'Liberado para Execução',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Manipulação',
  READY: 'Pronto',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com Problema',
}

/**
 * Canonical Tailwind color classes for each status pill.
 * Centralised so dashboard, list, detail, and timeline use the same
 * palette and we can audit i18n+colour drift in a single place.
 */
export const STATUS_BADGE_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  AWAITING_DOCUMENTS: 'bg-yellow-100 text-yellow-800',
  READY_FOR_REVIEW: 'bg-blue-100 text-blue-800',
  AWAITING_PAYMENT: 'bg-orange-100 text-orange-800',
  PAYMENT_UNDER_REVIEW: 'bg-orange-100 text-orange-800',
  PAYMENT_CONFIRMED: 'bg-teal-100 text-teal-800',
  COMMISSION_CALCULATED: 'bg-teal-100 text-teal-800',
  TRANSFER_PENDING: 'bg-blue-100 text-blue-800',
  TRANSFER_COMPLETED: 'bg-blue-100 text-blue-800',
  RELEASED_FOR_EXECUTION: 'bg-indigo-100 text-indigo-800',
  RECEIVED_BY_PHARMACY: 'bg-purple-100 text-purple-800',
  IN_EXECUTION: 'bg-purple-100 text-purple-800',
  READY: 'bg-green-100 text-green-800',
  SHIPPED: 'bg-green-100 text-green-800',
  DELIVERED: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELED: 'bg-red-100 text-red-800',
  WITH_ISSUE: 'bg-red-100 text-red-800',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function statusBadgeClass(status: string): string {
  return STATUS_BADGE_COLORS[status] ?? 'bg-gray-100 text-gray-700'
}
