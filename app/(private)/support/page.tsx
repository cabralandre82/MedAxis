import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
import { TicketList } from '@/components/support/ticket-list'
import { ButtonLink } from '@/components/ui/button-link'
import {
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_COLORS,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_COLORS,
} from '@/lib/support-constants'

export const metadata = { title: 'Suporte | Clinipharma' }

export default async function SupportPage() {
  await requireRolePage([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
  ])

  const user = await getCurrentUser()
  const supabase = createAdminClient()
  const isAdmin = user?.roles?.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r)) ?? false

  const query = supabase
    .from('support_tickets')
    .select(
      `id, code, title, category, priority, status, created_at, updated_at,
       created_by:profiles!created_by_user_id(id, full_name),
       assigned_to:profiles!assigned_to_user_id(id, full_name)`
    )
    .order('updated_at', { ascending: false })

  if (!isAdmin) query.eq('created_by_user_id', user!.id)

  const { data: tickets } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Suporte</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isAdmin
              ? 'Gerencie todos os tickets de suporte da plataforma.'
              : 'Acompanhe suas solicitações de suporte e converse com nossa equipe.'}
          </p>
        </div>
        <ButtonLink href="/support/new" className="gap-2">
          <Plus className="h-4 w-4" />
          Abrir ticket
        </ButtonLink>
      </div>

      <TicketList
        tickets={(tickets ?? []) as unknown as Parameters<typeof TicketList>[0]['tickets']}
        isAdmin={isAdmin}
        categoryLabels={TICKET_CATEGORY_LABELS}
        statusLabels={TICKET_STATUS_LABELS}
        statusColors={TICKET_STATUS_COLORS}
        priorityLabels={TICKET_PRIORITY_LABELS}
        priorityColors={TICKET_PRIORITY_COLORS}
      />
    </div>
  )
}
