import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { ButtonLink } from '@/components/ui/button-link'
import { UsersTable } from '@/components/users/users-table'
import { Plus } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usuários | MedAxis' }

export default async function UsersPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()

  const { data: usersRaw } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at, user_roles(role)')
    .order('full_name')

  const users = (usersRaw ?? []) as unknown as Array<{
    id: string
    full_name: string
    email: string
    phone: string | null
    created_at: string
    user_roles: Array<{ role: string }>
  }>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
          <p className="mt-0.5 text-sm text-gray-500">{users.length} usuário(s) cadastrado(s)</p>
        </div>
        <ButtonLink href="/users/new">
          <Plus className="mr-2 h-4 w-4" />
          Novo usuário
        </ButtonLink>
      </div>
      <UsersTable users={users} />
    </div>
  )
}
