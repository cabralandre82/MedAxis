'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send, Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addMessage, updateTicketStatus, updateTicketPriority } from '@/services/support'

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
  currentUserName: string
  isAdmin: boolean
  categoryLabels: Record<string, string>
  statusLabels: Record<string, string>
  statusColors: Record<string, string>
  priorityLabels: Record<string, string>
  priorityColors: Record<string, string>
}

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'RESOLVED', 'CLOSED'] as const
const PRIORITY_OPTIONS = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
const POLL_INTERVAL_MS = 10_000

function formatMessageDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function getDayKey(dateStr: string): string {
  return new Date(dateStr).toDateString()
}

export function TicketConversation({
  ticket,
  messages: initialMessages,
  currentUserId,
  currentUserName,
  isAdmin,
  categoryLabels,
  statusLabels,
  statusColors,
  priorityLabels,
  priorityColors,
}: TicketConversationProps) {
  const router = useRouter()
  const [isSending, startSendTransition] = useTransition()
  const [isChangingStatus, startStatusTransition] = useTransition()
  const [isChangingPriority, startPriorityTransition] = useTransition()

  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  // Optimistic messages: shown immediately while server processes
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const isClosed = ['RESOLVED', 'CLOSED'].includes(ticket.status)

  const allMessages = [...initialMessages, ...optimisticMessages]

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length])

  // Auto-refresh polling — silently refreshes server data every 10s
  const refresh = useCallback(() => router.refresh(), [router])
  useEffect(() => {
    if (isClosed) return
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isClosed, refresh])

  // Clear optimistic messages when server data arrives (after router.refresh)
  useEffect(() => {
    if (optimisticMessages.length > 0) {
      // If server messages now include our optimistic ones, clear them
      const serverIds = new Set(initialMessages.map((m) => m.id))
      const stillPending = optimisticMessages.filter((m) => !serverIds.has(m.id))
      if (stillPending.length !== optimisticMessages.length) {
        setOptimisticMessages(stillPending)
      }
    }
  }, [initialMessages, optimisticMessages])

  function handleSend() {
    const body = reply.trim()
    if (!body) return

    // Add optimistic message immediately
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      body,
      is_internal: isInternal,
      created_at: new Date().toISOString(),
      sender: { id: currentUserId, full_name: currentUserName },
    }
    setOptimisticMessages((prev) => [...prev, optimistic])
    setReply('')

    startSendTransition(async () => {
      const result = await addMessage({ ticket_id: ticket.id, body, is_internal: isInternal })
      if (result.error) {
        toast.error(result.error)
        // Remove optimistic message on failure
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setReply(body)
        return
      }
      router.refresh()
    })
  }

  function handleStatus(status: string) {
    startStatusTransition(async () => {
      const result = await updateTicketStatus(
        ticket.id,
        status as Parameters<typeof updateTicketStatus>[1]
      )
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  function handlePriority(priority: string) {
    startPriorityTransition(async () => {
      const result = await updateTicketPriority(
        ticket.id,
        priority as Parameters<typeof updateTicketPriority>[1]
      )
      if (result.error) toast.error(result.error)
      else router.refresh()
    })
  }

  // Group messages by day
  const groupedMessages: { dayKey: string; dayLabel: string; messages: Message[] }[] = []
  for (const msg of allMessages) {
    const key = getDayKey(msg.created_at)
    const last = groupedMessages[groupedMessages.length - 1]
    if (last?.dayKey === key) {
      last.messages.push(msg)
    } else {
      groupedMessages.push({
        dayKey: key,
        dayLabel: formatDayLabel(msg.created_at),
        messages: [msg],
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Conversation panel */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-white">
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
            {!isClosed && (
              <button
                onClick={refresh}
                className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                title="Atualizar agora"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            )}
          </div>
          <h2 className="mt-1 text-base font-semibold text-slate-900">{ticket.title}</h2>
          {ticket.assigned_to && (
            <p className="mt-0.5 text-xs text-slate-500">
              Atendendo: <strong>{ticket.assigned_to.full_name}</strong>
            </p>
          )}
        </div>

        {/* Messages with day grouping */}
        <div className="flex max-h-[560px] flex-col gap-1 overflow-y-auto p-4">
          {groupedMessages.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma mensagem ainda.</p>
          )}
          {groupedMessages.map((group) => (
            <div key={group.dayKey}>
              {/* Day separator */}
              <div className="my-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-100" />
                <span className="text-xs font-medium text-slate-400">{group.dayLabel}</span>
                <div className="h-px flex-1 bg-slate-100" />
              </div>

              <div className="flex flex-col gap-2">
                {group.messages.map((msg) => {
                  const isMine = msg.sender?.id === currentUserId
                  const senderName = msg.sender?.full_name ?? 'Usuário'
                  const isOptimistic = msg.id.startsWith('optimistic-')

                  if (msg.is_internal) {
                    return (
                      <div
                        key={msg.id}
                        className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                      >
                        <div className="mb-1 flex items-center gap-1.5 text-xs text-amber-700">
                          <Lock className="h-3 w-3" />
                          <strong>Nota interna</strong> · {senderName} ·{' '}
                          {formatMessageDate(msg.created_at)}
                        </div>
                        <p className="text-sm whitespace-pre-wrap text-amber-900">{msg.body}</p>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-0.5 ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        {!isMine && (
                          <span className="font-medium text-slate-600">{senderName}</span>
                        )}
                        <span>{formatMessageDate(msg.created_at)}</span>
                        {isMine && <span className="font-medium text-slate-600">Você</span>}
                        {isOptimistic && <span className="text-slate-300 italic">enviando…</span>}
                      </div>
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm transition-opacity ${
                          isMine
                            ? 'bg-primary rounded-tr-sm text-white'
                            : 'rounded-tl-sm bg-slate-100 text-slate-800'
                        } ${isOptimistic ? 'opacity-60' : 'opacity-100'}`}
                      >
                        <p className="whitespace-pre-wrap">{msg.body}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
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
                    !isInternal
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                    : 'Digite sua mensagem... (Ctrl+Enter para enviar)'
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                }}
                className={isInternal ? 'border-amber-300 bg-amber-50' : ''}
                disabled={isSending}
              />
              <Button
                onClick={handleSend}
                disabled={isSending || !reply.trim()}
                className="gap-1.5 self-end"
                size="sm"
              >
                <Send className="h-3.5 w-3.5" />
                {isSending ? 'Enviando…' : 'Enviar'}
              </Button>
            </div>
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
                <Label className="mb-1 block text-xs text-slate-600">Status</Label>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => v && handleStatus(v)}
                  disabled={isChangingStatus}
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
                <Label className="mb-1 block text-xs text-slate-600">Prioridade</Label>
                <Select
                  value={ticket.priority}
                  onValueChange={(v) => v && handlePriority(v)}
                  disabled={isChangingPriority}
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
            <p className="mt-3 text-slate-400">
              Aberto em{' '}
              {new Date(ticket.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </p>
            {ticket.resolved_at && (
              <p className="text-slate-400">
                Resolvido em{' '}
                {new Date(ticket.resolved_at).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
