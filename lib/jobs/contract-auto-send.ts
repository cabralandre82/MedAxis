import { inngest } from '@/lib/inngest'
import { createAdminClient } from '@/lib/db/admin'
import { createAndSendContract } from '@/lib/clicksign'
import { generateContractText, type ContractParty } from '@/lib/ai'
import { createNotification } from '@/lib/notifications'
import { logger } from '@/lib/logger'

/**
 * Background job: auto-send contract after registration approval.
 * Triggered by the registration PATCH route after approve action.
 * Runs async so the approve response is not blocked.
 */
export const contractAutoSendJob = inngest.createFunction(
  {
    id: 'contract-auto-send',
    name: 'Auto-Send Contract After Approval',
    triggers: [{ event: 'registration/contract.auto-send' as const }],
    retries: 2,
    timeouts: { finish: '3m' },
  },
  async ({ event, step }) => {
    const { entityType, entityId } = event.data

    const entityData = await step.run('fetch-entity-data', async () => {
      const admin = createAdminClient()

      if (entityType === 'CLINIC') {
        const { data } = await admin
          .from('clinics')
          .select('id, trade_name, cnpj, city, state, email')
          .eq('id', entityId)
          .single()
        return data
      } else if (entityType === 'DOCTOR') {
        const { data } = await admin
          .from('doctors')
          .select('id, full_name, email')
          .eq('id', entityId)
          .single()
        return data
      } else if (entityType === 'PHARMACY') {
        const { data } = await admin
          .from('pharmacies')
          .select('id, trade_name, cnpj, city, state, email')
          .eq('id', entityId)
          .single()
        return data
      } else if (entityType === 'CONSULTANT') {
        const { data } = await admin
          .from('sales_consultants')
          .select('id, full_name, cnpj, email, commission_rate')
          .eq('id', entityId)
          .single()
        return data
      }

      return null
    })

    if (!entityData) {
      logger.error('[contract-auto-send] entity not found', { entityType, entityId })
      return { ok: false, reason: 'entity_not_found' }
    }

    // Build party descriptor for AI text generation
    const raw = entityData as Record<string, string | number | null>
    const party: ContractParty = {
      type: entityType,
      name: String(raw.trade_name ?? raw.full_name ?? 'Contratante'),
      cnpj: raw.cnpj ? String(raw.cnpj) : undefined,
      email: raw.email ? String(raw.email) : undefined,
      city: raw.city ? String(raw.city) : undefined,
      state: raw.state ? String(raw.state) : undefined,
      commissionRate: raw.commission_rate ? Number(raw.commission_rate) : undefined,
    }

    // Generate personalized contract body with AI (fallback to generic if fails)
    const aiBody = await step.run('generate-contract-text', async () => {
      return generateContractText(party)
    })

    // Send contract via Clicksign
    const result = await step.run('send-via-clicksign', async () => {
      return createAndSendContract({
        type: entityType,
        party: {
          name: party.name,
          email: party.email ?? '',
          cpfCnpj: party.cnpj,
        },
        clinipharmaRepEmail:
          process.env.CLINIPHARMA_REP_EMAIL ?? process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1],
        aiGeneratedBody:
          entityType === 'DOCTOR' || entityType === 'CONSULTANT'
            ? (aiBody ?? undefined)
            : undefined,
      })
    })

    if (!result?.documentKey) {
      logger.error('[contract-auto-send] clicksign failed', { entityType, entityId })
      return { ok: false, reason: 'clicksign_error' }
    }

    // Persist contract record in DB
    await step.run('save-contract-record', async () => {
      const admin = createAdminClient()
      const contractType = `${entityType}_DPA` as const

      await admin.from('contracts').insert({
        type: contractType,
        status: 'SENT',
        entity_type: entityType,
        entity_id: entityId,
        clicksign_document_key: result.documentKey,
        clicksign_request_signature_key: result.signerKey,
        signers: [{ name: party.name, email: party.email, key: result.signerKey }],
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
    })

    // Notify entity user
    await step.run('notify-user', async () => {
      const admin = createAdminClient()

      let userId: string | null = null

      if (entityType === 'CLINIC') {
        const { data: member } = await admin
          .from('clinic_members')
          .select('user_id')
          .eq('clinic_id', entityId)
          .eq('membership_role', 'ADMIN')
          .limit(1)
          .maybeSingle()
        userId = member?.user_id ?? null
      } else if (entityType === 'PHARMACY') {
        const { data: pharmacy } = await admin
          .from('pharmacies')
          .select('profiles(id)')
          .eq('id', entityId)
          .maybeSingle()
        const profiles = (pharmacy as Record<string, unknown> | null)?.profiles as {
          id: string
        } | null
        userId = profiles?.id ?? null
      } else if (entityType === 'CONSULTANT') {
        const { data: consultant } = await admin
          .from('sales_consultants')
          .select('user_id')
          .eq('id', entityId)
          .maybeSingle()
        userId = consultant?.user_id ?? null
      }

      if (userId) {
        await createNotification({
          userId,
          type: 'GENERIC',
          title: '📄 Contrato enviado para assinatura',
          body: 'Seu contrato com a Clinipharma foi enviado por email. Assine digitalmente para ativar sua conta.',
          link: '/profile',
        })
      }
    })

    logger.info('[contract-auto-send] contract sent successfully', {
      entityType,
      entityId,
      documentKey: result.documentKey,
    })

    return { ok: true, documentKey: result.documentKey }
  }
)
