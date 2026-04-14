import { requireRolePage } from '@/lib/rbac'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'
import { BackButton } from '@/components/ui/back-button'

export const metadata = { title: 'Nova Farmácia | Clinipharma' }

export default async function NewPharmacyPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  return (
    <div className="space-y-6">
      <div>
        <BackButton href="/pharmacies" label="Farmácias" />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Nova Farmácia</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar uma nova farmácia parceira
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm />
      </div>
    </div>
  )
}
