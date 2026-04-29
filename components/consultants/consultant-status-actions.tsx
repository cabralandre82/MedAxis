'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { deleteConsultant, updateConsultantStatus } from '@/services/consultants'

type ConsultantStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

interface ConsultantStatusActionsProps {
  consultantId: string
  consultantName: string
  currentStatus: ConsultantStatus
}

const STATUS_LABEL: Record<ConsultantStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
}

/**
 * Status switcher + destructive delete for sales consultants.
 *
 * Until 2026-04-28 the consultant detail page only exposed an "Edit"
 * link to the form, but the form never carried a `status` field, so
 * SUPER_ADMIN had no UI to deactivate or suspend a consultant. The
 * server action `updateConsultantStatus` already existed — this surface
 * wires it up. Delete was added 2026-04-29 because the operator had no
 * way to clear out a mistakenly-created record (the "consultor teste"
 * row was stuck forever).
 *
 * Mirrors the `ClinicStatusActions` ergonomics: highlight the current
 * status, dim the others, prompt for confirmation on destructive moves.
 * Delete requires a TWO-step confirmation (typed name) since it's
 * irreversible — and the server-side guard refuses if there are any
 * commissions/transfers tied to the consultant (LGPD/fiscal retention).
 */
export function ConsultantStatusActions({
  consultantId,
  consultantName,
  currentStatus,
}: ConsultantStatusActionsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<ConsultantStatus | null>(null)
  const [deleting, setDeleting] = useState(false)

  function handleClick(next: ConsultantStatus) {
    if (next === currentStatus) return

    const message =
      next === 'INACTIVE'
        ? 'Inativar este consultor? Ele deixará de aparecer para vínculo a novas clínicas.'
        : next === 'SUSPENDED'
          ? 'Suspender este consultor? Ele será mantido cadastrado mas sem novos repasses.'
          : 'Reativar este consultor?'

    if (!confirm(message)) return

    setTarget(next)
    startTransition(async () => {
      const result = await updateConsultantStatus(consultantId, next)
      setTarget(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Status alterado para ${STATUS_LABEL[next].toLowerCase()}`)
      router.refresh()
    })
  }

  function handleDelete() {
    // Two-step confirmation: explain the consequences, then require
    // typing the consultant's name to confirm. Mirrors the safety
    // pattern used elsewhere for irreversible destructive actions.
    const ack = confirm(
      `EXCLUSÃO IRREVERSÍVEL\n\n` +
        `Você está prestes a excluir o consultor "${consultantName}".\n\n` +
        `• O cadastro será removido permanentemente.\n` +
        `• A conta de login será removida (se houver e ele só tiver papel de consultor).\n` +
        `• Clínicas vinculadas serão desvinculadas (não excluídas).\n` +
        `• Se houver comissões ou repasses registrados, a exclusão será bloqueada por obrigação fiscal/LGPD.\n\n` +
        `Para prosseguir, clique OK e digite o nome do consultor na próxima etapa.`
    )
    if (!ack) return

    const typed = prompt(`Digite o nome do consultor para confirmar:\n${consultantName}`)
    if (!typed) return
    if (typed.trim().toLowerCase() !== consultantName.trim().toLowerCase()) {
      toast.error('Nome digitado não confere. Exclusão cancelada.')
      return
    }

    setDeleting(true)
    startTransition(async () => {
      const result = await deleteConsultant(consultantId)
      setDeleting(false)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const detail = result.unlinkedClinics
        ? ` (${result.unlinkedClinics} clínica(s) desvinculada(s))`
        : ''
      toast.success(`Consultor excluído${detail}.`)
      router.push('/consultants')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">Status</span>
        {(Object.keys(STATUS_LABEL) as ConsultantStatus[]).map((s) => {
          const isCurrent = s === currentStatus
          const isPendingThis = pending && target === s
          return (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={isCurrent ? 'default' : 'outline'}
              disabled={pending || deleting}
              onClick={() => handleClick(s)}
              aria-pressed={isCurrent}
            >
              {isPendingThis ? 'Salvando…' : STATUS_LABEL[s]}
            </Button>
          )
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || deleting}
        onClick={handleDelete}
        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
      >
        {deleting ? 'Excluindo…' : 'Excluir consultor'}
      </Button>
    </div>
  )
}
