import { requireRolePage } from '@/lib/rbac'
import { ConsultantForm } from '@/components/consultants/consultant-form'
import { BackButton } from '@/components/ui/back-button'

export const metadata = { title: 'Novo Consultor — Clinipharma' }

export default async function NewConsultantPage() {
  await requireRolePage(['SUPER_ADMIN'])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackButton href="/consultants" label="Consultores" />
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Novo consultor de vendas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre um consultor para vincular a clínicas e acompanhar comissões
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <ConsultantForm />
      </div>
    </div>
  )
}
