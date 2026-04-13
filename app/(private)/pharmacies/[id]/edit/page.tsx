import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { PharmacyForm } from '@/components/pharmacies/pharmacy-form'

export const dynamic = 'force-dynamic'
import type { Pharmacy } from '@/types'

export const metadata = { title: 'Editar Farmácia | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditPharmacyPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = createAdminClient()
  const { data: pharmacy } = await supabase.from('pharmacies').select('*').eq('id', id).single()

  if (!pharmacy) notFound()

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/pharmacies" className="hover:text-primary">
            Farmácias
          </Link>
          <span>/</span>
          <Link href={`/pharmacies/${id}`} className="hover:text-primary">
            {(pharmacy as unknown as Pharmacy).trade_name}
          </Link>
          <span>/</span>
          <span>Editar</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Editar Farmácia</h1>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <PharmacyForm pharmacy={pharmacy as unknown as Pharmacy} />
      </div>
    </div>
  )
}
