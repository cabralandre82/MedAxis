'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Phone, RotateCcw } from 'lucide-react'

interface Props {
  clinicId: string
  clinicName: string
  alreadyContacted: boolean
}

export function ChurnContactButton({ clinicId, clinicName, alreadyContacted }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(clear = false) {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/churn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinicId, notes: notes || undefined, clear }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao salvar')
      } else {
        toast.success(clear ? 'Contato removido' : 'Contato registrado')
        setOpen(false)
        setNotes('')
        router.refresh()
      }
    } catch {
      toast.error('Erro de conexão')
    }
    setLoading(false)
  }

  if (alreadyContacted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleSubmit(true)}
        disabled={loading}
        title="Remover registro de contato"
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Phone className="mr-1 h-3 w-3" />
        Contatar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar contato — {clinicName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Registre que esta clínica foi contactada. Ela será movida para o histórico de contatos.
          </p>
          <div className="space-y-2">
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Falei com a Dra. Silva, interessada em retomar pedidos em 2 semanas."
            />
          </div>
          <div className="flex gap-3">
            <Button onClick={() => handleSubmit(false)} disabled={loading}>
              {loading ? 'Salvando...' : 'Confirmar'}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
