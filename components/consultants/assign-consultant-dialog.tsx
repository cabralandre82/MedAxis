'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { assignConsultantToClinic } from '@/services/consultants'
import type { SalesConsultant } from '@/types'

interface AssignConsultantDialogProps {
  clinicId: string
  currentConsultantId?: string | null
  consultants: SalesConsultant[]
}

export function AssignConsultantDialog({
  clinicId,
  currentConsultantId,
  consultants,
}: AssignConsultantDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string>(currentConsultantId ?? '__platform__')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setLoading(true)
    setError(null)
    const consultantId = selected === '__platform__' ? null : selected
    const result = await assignConsultantToClinic(clinicId, consultantId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Alterar consultor
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir consultor de vendas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-sm text-slate-600">
            Selecione o consultor responsável por esta clínica. As comissões serão calculadas
            automaticamente a cada pedido confirmado.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="consultant_select">Consultor</Label>
            <select
              id="consultant_select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="__platform__">Plataforma (sem consultor — comissão integral)</option>
              {consultants
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button onClick={handleSave} disabled={loading}>
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
