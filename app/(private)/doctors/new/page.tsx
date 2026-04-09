import { requireRolePage } from '@/lib/rbac'
import { DoctorForm } from '@/components/doctors/doctor-form'

export const metadata = { title: 'Novo Médico | Clinipharma' }

export default async function NewDoctorPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Novo Médico</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar um novo médico
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <DoctorForm />
      </div>
    </div>
  )
}
