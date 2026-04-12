'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addMessage, updateTicketStatus, updateTicketPriority } from '@/services/support'
import { formatDate } from '@/lib/utils'

interface Message {
  id: string
  body: string
  is_internal: boolean
  created_at: string
  sender: { id: string; full_name: string } | null
}

interface Ticket {
  id: string
  code: string
  title: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string
  resolved_at: string | null
  created_by: { id: string; full_name: string; email: string } | null
  assigned_to: { id: string; full_name: string } | null
}

interface TicketConversationProps {
  ticket: Ticket
  messages: Message[]
  currentUserId: string
  isAdmin: boolean
  categoryLabels: Record<string, string>
  statusLabels: Record<string, string>
  statusColors: Record<string, string>
  priorityLabels: Record<string, string>
  priorityColors: Record<string, string>
}

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'] as const
const PRIORITY_OPTIONS = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export function TicketConversation({
  ticket,
  messages,
  currentUserId,
  isAdmin,
  categoryLabels,
  statusLabels,
  statusColors,
  priorityLabels,
  priorityColors,
}: TicketConversationProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isClosed = ['RESOLVED', 'CLOSED'].includes(ticket.status)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    if (!reply.trim()) return
    startTransition(async () => {
      const result = await addMessage({
        ticket_id: ticket.id,
        body: reply.trim(),
        is_internal: isInternal,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setReply('')
      router.refresh()
    })
  }

  function handleStatus(status: string) {
    startTransition(async () => {
      const result = await updateTicketStatus(
        ticket.id,
        status as Parameters<typeof updateTicketStatus>[1]
      )
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  function handlePriority(priority: string) {
    startTransition(async () => {
      const result = await updateTicketPriority(
        ticket.id,
        priority as Parameters<typeof updateTicketPriority>[1]
      )
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Conversation panel */}
      <div className="flex flex-1 flex-col gap-0 overflow-hidden rounded-xl border bg-white">
        {/* Header */}
        <div className="border-b bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{ticket.code}</span>
            <Badge className={`text-xs ${statusColors[ticket.status] ?? ''}`}>
              {statusLabels[ticket.status] ?? ticket.status}
            </Badge>
            <Badge className={`text-xs ${priorityColors[ticket.priority] ?? ''}`}>
              {priorityLabels[ticket.priority] ?? ticket.priority}
            </Badge>
            <span className="text-xs text-slate-400">
              {categoryLabels[ticket.category] ?? ticket.category}
            </span>
          </div>
          <h2 className="mt-1 text-base font-semibold text-slate-900">{ticket.title}</h2>
          {ticket.assigned_to && (
            <p className="mt-0.5 text-xs text-slate-500">
              Atendendo: <strong>{ticket.assigned_to.full_name}</strong>
            </p>
          )}
        </div>

        {/* Messages */}
        <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto p-4">
          {messages.map((msg) => {
            const isMine = msg.sender?.id === currentUserId
            const senderName = msg.sender?.full_name ?? 'Usuário'

            if (msg.is_internal) {
              return (
                <div key={msg.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-amber-700">
                    <Lock className="h-3 w-3" />
                    <strong>Nota interna</strong> · {senderName} · {formatDate(msg.created_at)}
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-amber-900">{msg.body}</p>
                </div>
              )
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {!isMine && <span className="font-medium text-slate-600">{senderName}</span>}
                  <span>{formatDate(msg.created_at)}</span>
                  {isMine && <span className="font-medium text-slate-600">Você</span>}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    isMine
                      ? 'bg-primary rounded-tr-sm text-white'
                      : 'rounded-tl-sm bg-slate-100 text-slate-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Reply box */}
        {!isClosed ? (
          <div className="border-t p-4">
            {isAdmin && (
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsInternal(false)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    !isInternal ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  Responder ao cliente
                </button>
                <button
                  type="button"
                  onClick={() => setIsInternal(true)}
                  className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    isInternal
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-amber-50'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  Nota interna
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                rows={2}
                placeholder={
                  isInternal
                    ? 'Nota interna — visível apenas para admins...'
                    : 'Digite sua mensagem...'
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                }}
                className={isInternal ? 'border-amber-300 bg-amber-50' : ''}
              />
              <Button
                onClick={handleSend}
                disabled={isPending || !reply.trim()}
                className="gap-1.5 self-end"
                size="sm"
              >
                <Send className="h-3.5 w-3.5" />
                Enviar
              </Button>
            </div>
            <p className="mt-1 text-right text-xs text-slate-400">Ctrl+Enter para enviar</p>
          </div>
        ) : (
          <div className="border-t bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
            Este ticket está {statusLabels[ticket.status]?.toLowerCase()}. Abra um novo ticket se
            precisar de mais ajuda.
          </div>
        )}
      </div>

      {/* Admin sidebar */}
      {isAdmin && (
        <div className="w-full space-y-4 lg:w-56 lg:shrink-0">
          <div className="rounded-xl border bg-white p-4">
            <p className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Gerenciar
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => v && handleStatus(v)}
                  disabled={isPending}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">
                        {statusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Prioridade</label>
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => v && handlePriority(v)}
                  disabled={isPending}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {priorityLabels[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4 text-xs text-slate-500">
            <p className="mb-1 font-semibold tracking-wider text-slate-400 uppercase">
              Solicitante
            </p>
            <p className="font-medium text-slate-700">{ticket.created_by?.full_name ?? '—'}</p>
            <p className="text-slate-400">{ticket.created_by?.email ?? ''}</p>
            <p className="mt-2 text-slate-400">Aberto em {formatDate(ticket.created_at)}</p>
            {ticket.resolved_at && (
              <p className="text-slate-400">Resolvido em {formatDate(ticket.resolved_at)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
