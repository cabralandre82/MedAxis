'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createTicket } from '@/services/support'

const CATEGORIES = [
  {
    value: 'ORDER',
    emoji: '📦',
    label: 'Pedido',
    hint: 'Problema com um pedido existente',
    placeholder: 'Informe o número do pedido (ex: ORD-2026-00123) e descreva o problema...',
  },
  {
    value: 'PAYMENT',
    emoji: '💳',
    label: 'Pagamento',
    hint: 'Dúvidas ou problemas financeiros',
    placeholder: 'Informe o valor, data da cobrança e descreva o problema...',
  },
  {
    value: 'TECHNICAL',
    emoji: '🔧',
    label: 'Técnico',
    hint: 'Bug, erro ou lentidão no sistema',
    placeholder: 'Descreva o que aconteceu, em qual página, qual mensagem de erro apareceu...',
  },
  {
    value: 'COMPLAINT',
    emoji: '⚠️',
    label: 'Reclamação',
    hint: 'Insatisfação com produto ou serviço',
    placeholder: 'Descreva sua insatisfação com o máximo de detalhes possível...',
  },
  {
    value: 'GENERAL',
    emoji: '💬',
    label: 'Geral',
    hint: 'Dúvidas ou outros assuntos',
    placeholder: 'Descreva sua dúvida ou solicitação...',
  },
] as const

const BODY_MAX = 2000

export function NewTicketForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const selectedCategory = CATEGORIES.find((c) => c.value === category)
  const bodyRemaining = BODY_MAX - body.length
  const bodyTooLong = body.length > BODY_MAX

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category) {
      toast.error('Selecione um tipo de solicitação')
      return
    }
    if (bodyTooLong) {
      toast.error('Descrição muito longa')
      return
    }

    startTransition(async () => {
      const result = await createTicket({
        title,
        category: category as Parameters<typeof createTicket>[0]['category'],
        body,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Ticket ${result.code} aberto! Nossa equipe responderá em breve.`)
      router.push(`/support/${result.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Category picker */}
      <div className="space-y-2">
        <Label>
          Tipo de solicitação <span className="text-red-400">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CATEGORIES.map((cat) => {
            const active = category === cat.value
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                  active
                    ? 'border-primary bg-primary/5 ring-primary ring-1'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="text-2xl leading-none">{cat.emoji}</span>
                <span
                  className={`text-xs font-semibold ${active ? 'text-primary' : 'text-slate-700'}`}
                >
                  {cat.label}
                </span>
                <span className="hidden text-[10px] leading-tight text-slate-400 sm:block">
                  {cat.hint}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="title">
            Assunto <span className="text-red-400">*</span>
          </Label>
          <span className="text-xs text-slate-400">{title.length}/120</span>
        </div>
        <Input
          id="title"
          placeholder="Resumo claro do problema em uma linha..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          minLength={5}
          disabled={isPending}
        />
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="body">
            Descrição <span className="text-red-400">*</span>
          </Label>
          <span
            className={`text-xs ${bodyTooLong ? 'font-medium text-red-500' : 'text-slate-400'}`}
          >
            {bodyTooLong ? (
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {Math.abs(bodyRemaining)} caracteres a mais
              </span>
            ) : (
              `${body.length}/${BODY_MAX}`
            )}
          </span>
        </div>
        <Textarea
          id="body"
          placeholder={selectedCategory?.placeholder ?? 'Descreva com o máximo de detalhes...'}
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={10}
          disabled={isPending}
          className={bodyTooLong ? 'border-red-300 focus:ring-red-400' : ''}
        />
        {selectedCategory && (
          <p className="text-xs text-slate-400">
            💡 Quanto mais detalhes você fornecer, mais rápido nossa equipe consegue ajudar.
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={isPending || bodyTooLong} className="gap-2">
          <Send className="h-4 w-4" />
          {isPending ? 'Abrindo ticket…' : 'Abrir ticket'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
