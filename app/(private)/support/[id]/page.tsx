import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { getCurrentUser } from '@/lib/auth/session'
import { TicketConversation } from '@/components/support/ticket-conversation'
import {
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_COLORS,
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_COLORS,
} from '@/lib/support-constants'

export const metadata = { title: 'Ticket | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SupportTicketPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
  ])

  const user = await getCurrentUser()
  const supabase = await createServerClient()
  const isAdmin = user?.roles?.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r)) ?? false

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select(
      `id, code, title, category, priority, status, created_at, updated_at, resolved_at,
       created_by:profiles!created_by_user_id(id, full_name, email),
       assigned_to:profiles!assigned_to_user_id(id, full_name)`
    )
    .eq('id', id)
    .single()

  if (!ticket) notFound()

  // Clients can only see their own tickets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdBy = ticket.created_by as any as {
    id: string
    full_name: string
    email: string
  } | null
  if (!isAdmin && createdBy?.id !== user?.id) notFound()

  // Fetch messages (clients don't see internal notes — filtered by RLS)
  const { data: messages } = await supabase
    .from('support_messages')
    .select('id, body, is_internal, created_at, sender:profiles!sender_id(id, full_name)')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true })

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/support" className="hover:text-primary">
          Suporte
        </Link>
        <span>/</span>
        <span className="font-mono">{ticket.code}</span>
      </div>

      <TicketConversation
        ticket={ticket as unknown as Parameters<typeof TicketConversation>[0]['ticket']}
        messages={
          (messages ?? []) as unknown as Parameters<typeof TicketConversation>[0]['messages']
        }
        currentUserId={user!.id}
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
