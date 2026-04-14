import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireRolePage } from '@/lib/rbac'
import { BackButton } from '@/components/ui/back-button'
import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'
import type { Pharmacy } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Editar Farmácia | Clinipharma' }

export default async function MyPharmacyEditPage() {
  await requireRolePage(['PHARMACY_ADMIN'])

  const user = await getCurrentUser()
  const supabase = createAdminClient()

  const { data: memberRow } = await supabase
    .from('pharmacy_members')
    .select('pharmacy_id')
    .eq('user_id', user!.id)
    .single()

  if (!memberRow?.pharmacy_id) notFound()

  const { data: pharmacyRaw } = await supabase
    .from('pharmacies')
    .select('*')
    .eq('id', memberRow.pharmacy_id)
    .single()

  if (!pharmacyRaw) notFound()

  const pharmacy = pharmacyRaw as unknown as Pharmacy

  return (
    <div className="space-y-6">
      <div>
        <BackButton href="/my-pharmacy" label="Minha Farmácia" />
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar dados da farmácia</h1>
        <p className="mt-1 text-sm text-gray-500">
          Atualize contato, endereço e dados bancários. O CNPJ não pode ser alterado.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm pharmacy={pharmacy} disableCnpj redirectAfterSave="/my-pharmacy" />
      </div>
    </div>
  )
}
