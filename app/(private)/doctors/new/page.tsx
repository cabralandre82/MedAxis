import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { DoctorForm } from '@/components/doctors/doctor-form'

export const metadata = { title: 'Novo Médico | Clinipharma' }

export default async function NewDoctorPage() {
  const user = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])
  const isClinicAdmin = user.roles.includes('CLINIC_ADMIN')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Novo Médico</h1>
        <p className="mt-1 text-sm text-gray-500">
          {isClinicAdmin
            ? 'O médico será vinculado automaticamente à sua clínica.'
            : 'Preencha os dados para cadastrar um novo médico'}
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <DoctorForm redirectTo={isClinicAdmin ? '/orders/new' : undefined} />
      </div>
    </div>
  )
}
