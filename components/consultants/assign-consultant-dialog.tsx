'use client'

import { useState } from 'react'
import Link from 'next/link'
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
            {(() => {
              const activeConsultants = consultants.filter((c) => c.status === 'ACTIVE')
              const hasInactive = consultants.length > activeConsultants.length

              if (activeConsultants.length === 0) {
                // Empty-state: covers both "no consultants registered yet"
                // and "all registered consultants are inactive/suspended".
                // The dropdown by itself was the silent failure mode users
                // reported on 2026-04-28 — the new copy spells out the
                // *why* and points them at the action they need next.
                return (
                  <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <p>
                      {hasInactive
                        ? 'Nenhum consultor com status “Ativo” disponível. Reative um consultor existente ou cadastre um novo para vinculá-lo a esta clínica.'
                        : 'Você ainda não cadastrou nenhum consultor. Cadastre o primeiro para conseguir vinculá-lo a esta clínica.'}
                    </p>
                    <Link
                      href={hasInactive ? '/consultants' : '/consultants/new'}
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline hover:no-underline"
                    >
                      {hasInactive ? 'Abrir lista de consultores' : 'Cadastrar consultor'} →
                    </Link>
                  </div>
                )
              }

              return (
                <select
                  id="consultant_select"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="__platform__">
                    Plataforma (sem consultor — comissão integral)
                  </option>
                  {activeConsultants.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              )
            })()}
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
