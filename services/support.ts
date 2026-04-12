'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/db/admin'
import { requireAuth } from '@/lib/auth/session'
import { requireRole } from '@/lib/rbac'
import { createNotification, createNotificationForRole } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const createTicketSchema = z.object({
  title: z.string().min(5, 'Título deve ter ao menos 5 caracteres').max(120),
  category: z.enum(['ORDER', 'PAYMENT', 'TECHNICAL', 'GENERAL', 'COMPLAINT']),
  body: z.string().min(10, 'Descreva o problema com ao menos 10 caracteres'),
})

const addMessageSchema = z.object({
  ticket_id: z.string().uuid(),
  body: z.string().min(1, 'Mensagem não pode estar vazia'),
  is_internal: z.boolean().optional().default(false),
})

export type CreateTicketData = z.infer<typeof createTicketSchema>

export async function createTicket(
  data: CreateTicketData
): Promise<{ id?: string; code?: string; error?: string }> {
  try {
    const user = await requireAuth()
    const parsed = createTicketSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const adminClient = createAdminClient()

    const { data: ticket, error } = await adminClient
      .from('support_tickets')
      .insert({
        title: parsed.data.title,
        category: parsed.data.category,
        created_by_user_id: user.id,
      })
      .select('id, code')
      .single()

    if (error) {
      logger.error('[createTicket] insert failed', { error })
      return { error: 'Erro ao abrir ticket' }
    }

    // First message = the description
    const { error: msgError } = await adminClient.from('support_messages').insert({
      ticket_id: ticket.id,
      sender_id: user.id,
      body: parsed.data.body,
      is_internal: false,
    })
    if (msgError) logger.error('[createTicket] first message failed', { error: msgError })

    // Notify admins
    await createNotificationForRole('SUPER_ADMIN', {
      type: 'SUPPORT_TICKET',
      title: `Novo ticket: ${ticket.code}`,
      message: parsed.data.title,
      link: `/support/${ticket.id}`,
    })

    revalidatePath('/support')
    return { id: ticket.id, code: ticket.code }
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return { error: 'Sessão expirada' }
    return { error: 'Erro interno' }
  }
}

export async function addMessage(data: {
  ticket_id: string
  body: string
  is_internal?: boolean
}): Promise<{ error?: string }> {
  try {
    const user = await requireAuth()
    const parsed = addMessageSchema.safeParse(data)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }

    const isAdmin = user.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

    // Internal notes are admin-only
    if (parsed.data.is_internal && !isAdmin) return { error: 'Sem permissão' }

    const adminClient = createAdminClient()

    // Fetch ticket to notify the other party
    const { data: ticket } = await adminClient
      .from('support_tickets')
      .select('id, code, title, created_by_user_id, assigned_to_user_id, status')
      .eq('id', parsed.data.ticket_id)
      .single()

    if (!ticket) return { error: 'Ticket não encontrado' }

    // Clients can only reply to their own open tickets
    if (!isAdmin && ticket.created_by_user_id !== user.id) return { error: 'Sem permissão' }
    if (!isAdmin && ['RESOLVED', 'CLOSED'].includes(ticket.status))
      return { error: 'Este ticket já foi encerrado' }

    const { error: msgError } = await adminClient.from('support_messages').insert({
      ticket_id: parsed.data.ticket_id,
      sender_id: user.id,
      body: parsed.data.body,
      is_internal: parsed.data.is_internal ?? false,
    })
    if (msgError) {
      logger.error('[addMessage] insert failed', { error: msgError })
      return { error: 'Erro ao enviar mensagem' }
    }

    // Auto-assign first admin to reply
    if (isAdmin && !ticket.assigned_to_user_id) {
      const { error: assignError } = await adminClient
        .from('support_tickets')
        .update({
          assigned_to_user_id: user.id,
          status: 'IN_PROGRESS',
          updated_at: new Date().toISOString(),
        })
        .eq('id', parsed.data.ticket_id)
      if (assignError) logger.error('[addMessage] auto-assign failed', { error: assignError })
    }

    // Status: if client replies to WAITING_CLIENT → back to IN_PROGRESS
    if (!isAdmin && ticket.status === 'WAITING_CLIENT') {
      const { error: statusError } = await adminClient
        .from('support_tickets')
        .update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
        .eq('id', parsed.data.ticket_id)
      if (statusError) logger.error('[addMessage] status reopen failed', { error: statusError })
    }

    // Notifications (skip for internal notes)
    if (!parsed.data.is_internal) {
      if (isAdmin) {
        // Notify ticket creator
        await createNotification({
          userId: ticket.created_by_user_id,
          type: 'SUPPORT_REPLY',
          title: `Resposta no ${ticket.code}`,
          message: `Um atendente respondeu ao seu ticket: "${ticket.title}"`,
          link: `/support/${ticket.id}`,
        })
      } else {
        // Notify assigned admin or all SUPER_ADMINs
        if (ticket.assigned_to_user_id) {
          await createNotification({
            userId: ticket.assigned_to_user_id,
            type: 'SUPPORT_REPLY',
            title: `Nova resposta — ${ticket.code}`,
            message: `O solicitante respondeu no ticket: "${ticket.title}"`,
            link: `/support/${ticket.id}`,
          })
        } else {
          await createNotificationForRole('SUPER_ADMIN', {
            type: 'SUPPORT_REPLY',
            title: `Nova resposta — ${ticket.code}`,
            message: `Resposta recebida no ticket: "${ticket.title}"`,
            link: `/support/${ticket.id}`,
          })
        }
      }
    }

    revalidatePath(`/support/${parsed.data.ticket_id}`)
    revalidatePath('/support')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') return { error: 'Sessão expirada' }
    return { error: 'Erro interno' }
  }
}

export async function updateTicketStatus(
  ticketId: string,
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'RESOLVED' | 'CLOSED'
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'RESOLVED') updates.resolved_at = new Date().toISOString()

    const { error } = await adminClient.from('support_tickets').update(updates).eq('id', ticketId)

    if (error) {
      logger.error('[updateTicketStatus] update failed', { ticketId, status, error })
      return { error: 'Erro ao atualizar status' }
    }

    // Notify creator when resolved
    if (status === 'RESOLVED') {
      const { data: ticket } = await adminClient
        .from('support_tickets')
        .select('created_by_user_id, code, title')
        .eq('id', ticketId)
        .single()
      if (ticket) {
        await createNotification({
          userId: ticket.created_by_user_id,
          type: 'SUPPORT_RESOLVED',
          title: `Ticket ${ticket.code} resolvido`,
          message: `Seu ticket "${ticket.title}" foi marcado como resolvido.`,
          link: `/support/${ticketId}`,
        })
      }
    }

    revalidatePath(`/support/${ticketId}`)
    revalidatePath('/support')
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}

export async function updateTicketPriority(
  ticketId: string,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
): Promise<{ error?: string }> {
  try {
    await requireRole(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('support_tickets')
      .update({ priority, updated_at: new Date().toISOString() })
      .eq('id', ticketId)

    if (error) {
      logger.error('[updateTicketPriority] update failed', { error })
      return { error: 'Erro ao atualizar prioridade' }
    }

    revalidatePath(`/support/${ticketId}`)
    return {}
  } catch (err) {
    if (err instanceof Error && err.message === 'FORBIDDEN') return { error: 'Sem permissão' }
    return { error: 'Erro interno' }
  }
}
