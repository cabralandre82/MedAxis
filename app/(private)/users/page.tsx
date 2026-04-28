import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { ButtonLink } from '@/components/ui/button-link'

import { UsersTable } from '@/components/users/users-table'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import { parsePage, paginationRange } from '@/lib/utils'
import { logger } from '@/lib/logger'
import { Plus } from 'lucide-react'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

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

  // Source of truth for "is the user active?" is **two-headed**:
  //   1) `profiles.is_active` (mirror, best-effort)
  //   2) `auth.users.banned_until` (canonical)
  //
  // The user details page reads (2) directly via the admin API. This
  // list page used to read only (1), which led to the bug reported on
  // 2026-04-28: deactivating a user banned them in auth but the
  // profile mirror update raced/failed silently → list said "Ativo"
  // while the detail correctly said "Desativado". Two sources of
  // truth, one drift.
  //
  // Fix: cross-check both in the same render. We pull the auth user
  // list (paginated to the same page-size cap so we don't fan out)
  // and union the bans into a Set; the row is "ativo" iff
  // `profiles.is_active === true && !bannedSet.has(user.id)`. A
  // future Supabase trigger should make these sources converge so
  // this client-side reconciliation can be removed.
  const { data: usersRaw, count } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at, is_active, user_roles(role)', {
      count: 'exact',
    })
    .order('is_active', { ascending: false }) // active users first
    .order('full_name')
    .range(from, to)

  // Authoritative ban set — page-aligned. supabase-js admin API caps at
  // 1000 per page, which is well above PAGE_SIZE.
  let bannedSet = new Set<string>()
  try {
    const { data: authPage } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    for (const u of authPage?.users ?? []) {
      const banned = u.banned_until && u.banned_until !== 'none'
      if (banned) bannedSet.add(u.id)
    }
  } catch (err) {
    logger.warn('[users-list] auth.admin.listUsers failed; falling back to profiles.is_active', {
      error: err,
    })
    bannedSet = new Set()
  }

  const users = (usersRaw ?? []).map((u) => ({
    ...(u as {
      id: string
      full_name: string
      email: string
      phone: string | null
      created_at: string
      is_active: boolean
      user_roles: Array<{ role: string }>
    }),
    is_active:
      Boolean((u as { is_active: boolean }).is_active) && !bannedSet.has((u as { id: string }).id),
  })) as Array<{
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
