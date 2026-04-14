import { requireRolePage } from '@/lib/rbac'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'

export const metadata = { title: 'Nova Distribuidora | Clinipharma' }

export default async function NewDistributorPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nova Distribuidora</h1>
        <p className="mt-1 text-sm text-gray-500">
          Preencha os dados para cadastrar uma nova distribuidora parceira
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm entityType="DISTRIBUTOR" listPath="/distributors" />
      </div>
    </div>
  )
}
