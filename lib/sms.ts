import twilio from 'twilio'

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!to?.trim()) return

  const from = process.env.TWILIO_PHONE_NUMBER
  if (!from) {
    console.warn('[sms] TWILIO_PHONE_NUMBER not configured')
    return
  }

  // Normalize BR phone: ensure +55 prefix
  const digits = to.replace(/\D/g, '')
  if (digits.length < 10) {
    console.warn('[sms] Invalid phone number, skipping:', to)
    return
  }
  const normalizedTo = to.startsWith('+') ? to : `+55${digits}`

  try {
    const client = getTwilioClient()
    if (!client) {
      console.warn('[sms] Twilio not configured')
      return
    }
    await client.messages.create({ to: normalizedTo, from, body })
  } catch (err) {
    console.warn('[sms] Failed to send SMS:', err)
  }
}

// ── SMS templates ─────────────────────────────────────────────────────────────

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
