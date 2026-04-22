'use client'

import { useState, useTransition } from 'react'
import { Bookmark, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface OrderItem {
  product_id: string
  variant_id?: string | null
  quantity: number
  pharmacy_id: string
  unit_price: number
  pharmacy_cost_per_unit?: number
  product_name?: string
}

interface SaveTemplateModalProps {
  clinicId: string
  items: OrderItem[]
}

export function SaveTemplateModal({ clinicId, items }: SaveTemplateModalProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()

  function save() {
    if (!name.trim()) {
      toast.error('Dê um nome ao template')
      return
    }
    startTransition(async () => {
      const res = await fetch('/api/orders/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clinicId, items }),
      })
      if (!res.ok) {
        toast.error('Erro ao salvar template')
        return
      }
      toast.success(`Template "${name}" salvo!`)
      setOpen(false)
      setName('')
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Bookmark className="h-3.5 w-3.5" />
        Salvar como template
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-template-modal-title"
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="save-template-modal-title" className="text-base font-semibold text-gray-900">
                Salvar como template
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar diálogo"
                title="Fechar"
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-500">
              Salve os produtos deste pedido como template para reutilizá-lo facilmente no futuro.
            </p>
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Nome do template *</Label>
              <Input
                id="tpl-name"
                placeholder="Ex: Tratamento mensal Clínica ABC"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 gap-1" disabled={isPending} onClick={save}>
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
