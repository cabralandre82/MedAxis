'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createTicket } from '@/services/support'

const CATEGORIES = [
  { value: 'ORDER', label: '📦 Pedido', hint: 'Problema com um pedido existente' },
  { value: 'PAYMENT', label: '💳 Pagamento', hint: 'Dúvidas ou problemas financeiros' },
  { value: 'TECHNICAL', label: '🔧 Técnico', hint: 'Bug, erro ou lentidão no sistema' },
  { value: 'COMPLAINT', label: '⚠️ Reclamação', hint: 'Insatisfação com produto ou serviço' },
  { value: 'GENERAL', label: '💬 Geral', hint: 'Dúvidas ou outros assuntos' },
]

export function NewTicketForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const selectedCategory = CATEGORIES.find((c) => c.value === category)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category) {
      toast.error('Selecione uma categoria')
      return
    }
    setLoading(true)
    try {
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
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Category */}
      <div className="space-y-2">
        <Label>Tipo de solicitação *</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`rounded-lg border p-3 text-left text-sm transition-all ${
                category === cat.value
                  ? 'border-primary bg-primary/5 ring-primary ring-1'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="font-medium text-slate-800">{cat.label}</span>
              <p className="mt-0.5 text-xs text-slate-500">{cat.hint}</p>
            </button>
          ))}
        </div>
        {selectedCategory && (
          <p className="text-xs text-slate-500">
            Selecionado: <strong>{selectedCategory.label}</strong> — {selectedCategory.hint}
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Assunto *</Label>
        <Input
          id="title"
          placeholder="Resumo claro do problema em uma linha..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          minLength={5}
        />
        <p className="text-right text-xs text-slate-400">{title.length}/120</p>
      </div>

      {/* Body */}
      <div className="space-y-2">
        <Label htmlFor="body">Descrição *</Label>
        <Textarea
          id="body"
          placeholder={
            category === 'ORDER'
              ? 'Informe o número do pedido e descreva o problema...'
              : category === 'PAYMENT'
                ? 'Informe o valor, data e descreva o problema...'
                : category === 'TECHNICAL'
                  ? 'Descreva o que aconteceu, qual página, mensagem de erro...'
                  : 'Descreva com o máximo de detalhes...'
          }
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={10}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading} className="gap-2">
          <Send className="h-4 w-4" />
          {loading ? 'Abrindo ticket...' : 'Abrir ticket'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
