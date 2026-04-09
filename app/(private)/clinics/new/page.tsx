import { requireRolePage } from '@/lib/rbac'
import { ClinicForm } from '@/components/clinics/clinic-form'

export const metadata = { title: 'Nova Clínica | Clinipharma' }

export default async function NewClinicPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nova Clínica</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar uma nova clínica
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <ClinicForm />
      </div>
    </div>
  )
}
