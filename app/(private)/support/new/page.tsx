import { requireRolePage } from '@/lib/rbac'
import { NewTicketForm } from '@/components/support/new-ticket-form'
import { BackButton } from '@/components/ui/back-button'

export const metadata = { title: 'Abrir Ticket | Clinipharma' }

export default async function NewTicketPage() {
  await requireRolePage([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton href="/support" label="Suporte" />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Abrir ticket de suporte</h1>
        <p className="mt-1 text-sm text-gray-500">
          Descreva o problema com o máximo de detalhes. Nossa equipe responde em até 1 dia útil.
        </p>
      </div>
      <div className="rounded-xl border bg-white p-6">
        <NewTicketForm />
      </div>
    </div>
  )
}
