import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { createServerClient } from '@/lib/db/server'
import { UserForm } from '@/components/users/user-form'
import type { Clinic, Pharmacy } from '@/types'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Novo Usuário | MedAxis' }

export default async function NewUserPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const currentUser = await getCurrentUser()
  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN') ?? false

  const supabase = await createServerClient()

  const [{ data: clinicsRaw }, { data: pharmaciesRaw }] = await Promise.all([
    supabase
      .from('clinics')
      .select('id, trade_name, status')
      .eq('status', 'ACTIVE')
      .order('trade_name'),
    supabase
      .from('pharmacies')
      .select('id, trade_name, status')
      .eq('status', 'ACTIVE')
      .order('trade_name'),
  ])

  const clinics = (clinicsRaw ?? []) as unknown as Clinic[]
  const pharmacies = (pharmaciesRaw ?? []) as unknown as Pharmacy[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Novo Usuário</h1>
        <p className="mt-1 text-sm text-gray-500">
          Crie credenciais de acesso para um novo usuário da plataforma
        </p>
      </div>
      <div className="rounded-lg border bg-white p-6">
        <UserForm clinics={clinics} pharmacies={pharmacies} isSuperAdmin={isSuperAdmin} />
      </div>
    </div>
  )
}
