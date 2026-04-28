// @rbac-view: ok — buyer-only feature (TemplatesList renders order
// templates owned by a clinic; mounted from /orders for clinics, never
// shown to pharmacies). `unit_price` here is the buyer's own price.
'use client'

import { useState, useEffect, useTransition } from 'react'
import { Bookmark, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReorderButton } from '@/components/orders/reorder-button'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Template {
  id: string
  name: string
  items: Array<{
    product_id: string
    variant_id?: string
    quantity: number
    unit_price: number
    product_name?: string
  }>
  created_at: string
}

interface TemplatesListProps {
  clinicId: string
}

export function TemplatesList({ clinicId }: TemplatesListProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    fetch(`/api/orders/templates?clinicId=${clinicId}`)
      .then((r) => r.json())
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clinicId])

  function deleteTemplate(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/orders/templates?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Erro ao remover template')
        return
      }
      setTemplates((t) => t.filter((x) => x.id !== id))
      toast.success('Template removido')
    })
  }

  if (loading) return null
  if (!templates.length) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-blue-500" />
          Templates salvos
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
            {templates.length}
          </span>
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="divide-y border-t">
          {templates.map((t) => {
            const total = t.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
            return (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="mr-3 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{t.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {t.items.length} {t.items.length === 1 ? 'produto' : 'produtos'} ·{' '}
                    {formatCurrency(total)} ·{' '}
                    {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ReorderButton templateId={t.id} label="Usar" />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                    disabled={isPending}
                    onClick={() => deleteTemplate(t.id)}
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
