'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { updateConsultantStatus } from '@/services/consultants'

type ConsultantStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

interface ConsultantStatusActionsProps {
  consultantId: string
  currentStatus: ConsultantStatus
}

const STATUS_LABEL: Record<ConsultantStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
}

/**
 * Triple-button status switcher for sales consultants.
 *
 * Until 2026-04-28 the consultant detail page only exposed an "Edit"
 * link to the form, but the form never carried a `status` field, so
 * SUPER_ADMIN had no UI to deactivate or suspend a consultant. The
 * server action `updateConsultantStatus` already existed — this is the
 * missing surface that wires it up.
 *
 * Mirrors the `ClinicStatusActions` ergonomics: highlight the current
 * status, dim the others, prompt for confirmation on destructive moves
 * (away from ACTIVE) so a fat-finger doesn't accidentally suspend a
 * consultant mid-quarter.
 */
export function ConsultantStatusActions({
  consultantId,
  currentStatus,
}: ConsultantStatusActionsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<ConsultantStatus | null>(null)

  function handleClick(next: ConsultantStatus) {
    if (next === currentStatus) return

    // Confirm destructive transitions (anything that takes the
    // consultant out of ACTIVE — INACTIVE or SUSPENDED — and the
    // explicit re-activation, just to be symmetric).
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

  return (
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
            disabled={pending}
            onClick={() => handleClick(s)}
            aria-pressed={isCurrent}
          >
            {isPendingThis ? 'Salvando…' : STATUS_LABEL[s]}
          </Button>
        )
      })}
    </div>
  )
}
