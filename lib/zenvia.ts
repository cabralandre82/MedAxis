/**
 * Zenvia unified messaging client — SMS and WhatsApp via the same REST API.
 *
 * Docs: https://zenvia.github.io/zenvia-openapi-spec/v2/
 * Auth: X-API-TOKEN header (token created at app.zenvia.com → Developers → Tokens & Webhooks)
 *
 * SETUP STEPS (SMS — required):
 * 1. Create a Zenvia account at https://app.zenvia.com
 * 2. Developers → Tokens & Webhooks → Create new token → ZENVIA_API_TOKEN
 * 3. Canais → SMS → approved sender ID → ZENVIA_SMS_FROM (e.g. "Clinipharma")
 *
 * WhatsApp is OFF-by-design for the initial launch — `WHATSAPP_ENABLED` is
 * read as the kill-switch so `sendWhatsApp()` is a no-op on every order /
 * payment / registration path without emitting warn log noise. To enable
 * later: set `WHATSAPP_ENABLED=true` AND `ZENVIA_WHATSAPP_FROM` (E.164, no
 * leading '+') AND verify the business number in Meta Business Manager.
 */

import { withCircuitBreaker, CircuitOpenError } from '@/lib/circuit-breaker'
import { logger } from '@/lib/logger'

const BASE_URL = 'https://api.zenvia.com/v2/channels'

function getToken(): string | null {
  return process.env.ZENVIA_API_TOKEN ?? null
}

/** Normalize Brazilian phone number to Zenvia format: 5511999999999 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55')) return digits
  return `55${digits}`
}

async function zenviaPost(
  channel: 'sms' | 'whatsapp',
  from: string,
  to: string,
  text: string
): Promise<void> {
  const token = getToken()
  if (!token) {
    logger.warn('ZENVIA_API_TOKEN not configured — message skipped', {
      module: 'zenvia',
      channel,
    })
    return
  }

  const body = {
    from,
    to,
    contents: [{ type: 'text', text }],
  }

  try {
    await withCircuitBreaker(
      async () => {
        const res = await fetch(`${BASE_URL}/${channel}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-TOKEN': token,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`Zenvia ${channel} API error ${res.status}: ${detail}`)
        }
      },
      { name: `zenvia-${channel}`, failureThreshold: 3, recoveryTimeMs: 30_000 }
    )
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn('Circuit OPEN — message skipped', { module: 'zenvia', channel })
    } else {
      logger.error('Failed to send message', { module: 'zenvia', channel, error: err })
    }
  }
}

// ── SMS ────────────────────────────────────────────────────────────────────────

export async function sendSms(to: string, text: string): Promise<void> {
  if (!to?.trim()) return

  const digits = to.replace(/\D/g, '')
  if (digits.length < 10) {
    logger.warn('Invalid phone number, skipping', {
      module: 'zenvia',
      channel: 'sms',
      // Don't log the raw number — the redactor would mask it, but being
      // explicit documents the intent.
    })
    return
  }

  const from = process.env.ZENVIA_SMS_FROM
  if (!from) {
    logger.warn('ZENVIA_SMS_FROM not configured', { module: 'zenvia', channel: 'sms' })
    return
  }

  await zenviaPost('sms', from, normalizePhone(to), text)
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────

export async function sendWhatsApp(phone: string, text: string): Promise<void> {
  if (!phone?.trim()) return

  // Kill-switch: WhatsApp is intentionally disabled at launch. Silent
  // skip (no warn log) so the production log isn't noisy on every
  // order/payment/registration. Flip WHATSAPP_ENABLED=true only when
  // Meta Business verification is complete AND ZENVIA_WHATSAPP_FROM
  // is set to the verified business number.
  if (process.env.WHATSAPP_ENABLED !== 'true') return

  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) {
    logger.warn('Invalid phone number, skipping', { module: 'zenvia', channel: 'whatsapp' })
    return
  }

  const from = process.env.ZENVIA_WHATSAPP_FROM
  if (!from) {
    // WHATSAPP_ENABLED=true but FROM missing → real config bug, warn loud.
    logger.warn('ZENVIA_WHATSAPP_FROM not configured', { module: 'zenvia', channel: 'whatsapp' })
    return
  }

  await zenviaPost('whatsapp', from, normalizePhone(phone), text)
}

// ── SMS templates ──────────────────────────────────────────────────────────────

export const SMS = {
  orderCreated: (code: string) =>
    `Clinipharma: Pedido ${code} recebido com sucesso. Acompanhe em clinipharma.com.br`,

  paymentConfirmed: (code: string) =>
    `Clinipharma: Pagamento do pedido ${code} confirmado! Em breve a farmácia iniciará a execução.`,

  orderReady: (code: string) =>
    `Clinipharma: Pedido ${code} pronto para entrega! Entre em contato com a farmácia.`,

  orderShipped: (code: string) =>
    `Clinipharma: Pedido ${code} enviado! Aguarde a entrega em seu endereço.`,

  orderDelivered: (code: string) => `Clinipharma: Pedido ${code} entregue com sucesso. Obrigado!`,

  orderCanceled: (code: string) =>
    `Clinipharma: Pedido ${code} foi cancelado. Dúvidas? Acesse clinipharma.com.br`,

  registrationApproved: (name: string) =>
    `Clinipharma: Olá, ${name}! Seu cadastro foi aprovado. Acesse seu email para definir a senha e começar a usar a plataforma.`,

  registrationRejected: (name: string) =>
    `Clinipharma: Olá, ${name}. Infelizmente seu cadastro não foi aprovado. Entre em contato conosco para mais informações.`,

  pendingDocs: (name: string) =>
    `Clinipharma: Olá, ${name}. Precisamos de documentos adicionais para concluir seu cadastro. Acesse clinipharma.com.br`,

  prescriptionRequired: (code: string) =>
    `Clinipharma: Pedido ${code} requer receita médica para avançar. Acesse a plataforma para enviar.`,

  staleOrder: (code: string, days: number) =>
    `Clinipharma: O pedido ${code} está parado há ${days} dias. Acesse clinipharma.com.br para verificar.`,
}

// ── WhatsApp templates ─────────────────────────────────────────────────────────

export const WA = {
  orderCreated: (code: string, clinicName: string) =>
    `✅ *Clinipharma* — Olá, ${clinicName}!\n\nSeu pedido *${code}* foi recebido com sucesso.\n\nAcompanhe o status em: https://clinipharma.com.br`,

  paymentConfirmed: (code: string) =>
    `💳 *Clinipharma* — Pagamento do pedido *${code}* confirmado!\n\nEm breve a farmácia iniciará a execução. Acompanhe em: https://clinipharma.com.br`,

  orderReady: (code: string) =>
    `📦 *Clinipharma* — Pedido *${code}* pronto!\n\nSeu pedido está pronto para entrega. Entre em contato com a farmácia para combinar a entrega.`,

  orderShipped: (code: string) =>
    `🚚 *Clinipharma* — Pedido *${code}* enviado!\n\nSeu pedido saiu para entrega. Acesse clinipharma.com.br para detalhes.`,

  orderDelivered: (code: string) =>
    `🎉 *Clinipharma* — Pedido *${code}* entregue!\n\nObrigado pela confiança. Qualquer dúvida, estamos à disposição.`,

  registrationApproved: (name: string) =>
    `✅ *Clinipharma* — Olá, ${name}!\n\nSeu cadastro foi *aprovado*! Você já pode acessar a plataforma e realizar pedidos em: https://clinipharma.com.br`,

  registrationRejected: (name: string, reason: string) =>
    `❌ *Clinipharma* — Olá, ${name}.\n\nInfelizmente seu cadastro não foi aprovado.\n\n*Motivo:* ${reason}\n\nEm caso de dúvidas, entre em contato conosco.`,

  contractSent: (name: string) =>
    `📝 *Clinipharma* — Olá, ${name}!\n\nUm contrato foi enviado para sua assinatura. Verifique seu email para assinar digitalmente via Clicksign.`,

  staleOrderAlert: (code: string, days: number) =>
    `⚠️ *Clinipharma* — Alerta: o pedido *${code}* está parado há *${days} dias* sem movimentação.\n\nAcesse https://clinipharma.com.br para verificar.`,

  productInterestConfirm: (name: string, productName: string) =>
    `👋 *Clinipharma* — Olá, ${name}!\n\nRegistramos seu interesse no produto *${productName}*. Assim que estiver disponível, entraremos em contato.`,
}
