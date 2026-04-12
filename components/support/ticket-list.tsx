'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, Clock, User, Search } from 'lucide-react'

interface Ticket {
  id: string
  code: string
  title: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string
  created_by: { id: string; full_name: string } | null
  assigned_to: { id: string; full_name: string } | null
}

interface TicketListProps {
  tickets: Ticket[]
  isAdmin: boolean
  categoryLabels: Record<string, string>
  statusLabels: Record<string, string>
  statusColors: Record<string, string>
  priorityLabels: Record<string, string>
  priorityColors: Record<string, string>
}

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
const STATUS_FILTERS = ['TODOS', 'OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED']

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export function TicketList({
  tickets,
  isAdmin,
  categoryLabels,
  statusLabels,
  statusColors,
  priorityLabels,
  priorityColors,
}: TicketListProps) {
  const [filter, setFilter] = useState('TODOS')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => {
    const c: Record<string, number> = { TODOS: tickets.length }
    for (const t of tickets) c[t.status] = (c[t.status] ?? 0) + 1
    return c
  }, [tickets])

  // Only show tabs that have tickets (except TODOS)
  const visibleFilters = useMemo(
    () => STATUS_FILTERS.filter((s) => s === 'TODOS' || (counts[s] ?? 0) > 0),
    [counts]
  )

  const filtered = useMemo(() => {
    let result = filter === 'TODOS' ? tickets : tickets.filter((t) => t.status === filter)

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.code.toLowerCase().includes(q) ||
          t.created_by?.full_name.toLowerCase().includes(q)
      )
    }

    // Sort: urgent/high first, then by updated_at desc
    return [...result].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
  }, [tickets, filter, search])

  return (
    <div className="space-y-3">
      {/* Search + filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por assunto, código ou solicitante..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus:border-primary focus:ring-primary h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm outline-none placeholder:text-slate-400 focus:ring-1"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {visibleFilters.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === s
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s === 'TODOS' ? 'Todos' : statusLabels[s]}
              <span className="ml-1.5 opacity-70">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Ticket table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">
              {search
                ? `Nenhum ticket encontrado para "${search}".`
                : filter === 'TODOS'
                  ? 'Nenhum ticket ainda. Clique em "Abrir ticket" para começar.'
                  : `Nenhum ticket com status "${statusLabels[filter] ?? filter}".`}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase">
                <th className="px-4 py-3">Ticket</th>
                {isAdmin && <th className="hidden px-4 py-3 md:table-cell">Solicitante</th>}
                <th className="hidden px-4 py-3 sm:table-cell">Categoria</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 lg:table-cell">Prioridade</th>
                <th className="hidden px-4 py-3 md:table-cell">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((ticket) => (
                <tr
                  key={ticket.id}
                  className={`transition-colors hover:bg-slate-50/60 ${
                    ticket.priority === 'URGENT' ? 'bg-red-50/30' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link href={`/support/${ticket.id}`} className="group block">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="group-hover:text-primary h-4 w-4 shrink-0 text-slate-300" />
                        <div>
                          <p className="group-hover:text-primary font-medium text-slate-900">
                            {ticket.title}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">{ticket.code}</p>
                        </div>
                      </div>
                    </Link>
                  </td>

                  {isAdmin && (
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <User className="h-3.5 w-3.5 text-slate-300" />
                        {ticket.created_by?.full_name ?? '—'}
                      </div>
                      {ticket.assigned_to ? (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Atendendo: {ticket.assigned_to.full_name}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-amber-500">Sem atendente</p>
                      )}
                    </td>
                  )}

                  <td className="hidden px-4 py-3 sm:table-cell">
                    <span className="text-xs text-slate-500">
                      {categoryLabels[ticket.category] ?? ticket.category}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <Badge
                      className={`text-xs ${statusColors[ticket.status] ?? 'bg-slate-100 text-slate-500'}`}
                    >
                      {statusLabels[ticket.status] ?? ticket.status}
                    </Badge>
                  </td>

                  <td className="hidden px-4 py-3 lg:table-cell">
                    <Badge
                      className={`text-xs ${priorityColors[ticket.priority] ?? 'bg-slate-100'}`}
                    >
                      {priorityLabels[ticket.priority] ?? ticket.priority}
                    </Badge>
                  </td>

                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="h-3.5 w-3.5" />
                      {timeAgo(ticket.updated_at)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
