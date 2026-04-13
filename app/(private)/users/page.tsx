import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { ButtonLink } from '@/components/ui/button-link'

export const dynamic = 'force-dynamic'
import { UsersTable } from '@/components/users/users-table'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { Plus } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Usuários | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function UsersPage({ searchParams }: Props) {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const { page: pageRaw } = await searchParams

  const supabase = createAdminClient()

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: usersRaw, count } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at, is_active, user_roles(role)', {
      count: 'exact',
    })
    .order('is_active', { ascending: false }) // active users first
    .order('full_name')
    .range(from, to)

  const users = (usersRaw ?? []) as unknown as Array<{
    id: string
    full_name: string
    email: string
    phone: string | null
    created_at: string
    is_active: boolean
    user_roles: Array<{ role: string }>
  }>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuários</h1>
          <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} usuário(s) no total</p>
        </div>
        <ButtonLink href="/users/new">
          <Plus className="mr-2 h-4 w-4" />
          Novo usuário
        </ButtonLink>
      </div>
      <UsersTable users={users} />
      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
