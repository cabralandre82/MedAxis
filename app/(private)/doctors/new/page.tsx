import { requireRolePage } from '@/lib/rbac'
import { DoctorForm } from '@/components/doctors/doctor-form'
import { BackButton } from '@/components/ui/back-button'

export const metadata = { title: 'Novo Médico | Clinipharma' }

interface NewDoctorPageProps {
  searchParams: Promise<{ cart?: string }>
}

export default async function NewDoctorPage({ searchParams }: NewDoctorPageProps) {
  const user = await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'CLINIC_ADMIN'])
  const isClinicAdmin = user.roles.includes('CLINIC_ADMIN')
  const { cart } = await searchParams

  // Preserve cart in the redirect URL so /orders/new can restore it
  const redirectTo = isClinicAdmin
    ? cart
      ? `/orders/new?cart=${encodeURIComponent(cart)}`
      : '/orders/new'
    : undefined

  return (
    <div className="space-y-6">
      <div>
        <BackButton href="/doctors" label="Médicos" />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Novo Médico</h1>
        <p className="mt-1 text-sm text-gray-500">
          {isClinicAdmin
            ? 'O médico será vinculado automaticamente à sua clínica.'
            : 'Preencha os dados para cadastrar um novo médico'}
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <DoctorForm redirectTo={redirectTo} />
      </div>
    </div>
  )
}
