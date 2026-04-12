export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  ORDER: 'Pedido',
  PAYMENT: 'Pagamento',
  TECHNICAL: 'Técnico',
  GENERAL: 'Geral',
  COMPLAINT: 'Reclamação',
}

export const TICKET_PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em atendimento',
  WAITING_CLIENT: 'Aguardando você',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
}

export const TICKET_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  WAITING_CLIENT: 'bg-purple-100 text-purple-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-500',
}

export const TICKET_PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-500',
  NORMAL: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-red-100 text-red-600',
}
