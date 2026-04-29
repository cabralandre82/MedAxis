import { APP_URL } from './index'

const BRAND_COLOR = '#2563eb'
const BG = '#f8fafc'
const BORDER = '#e2e8f0'

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:${BRAND_COLOR};padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Clinipharma</span>
            <span style="color:#93c5fd;font-size:12px;margin-left:8px;">Plataforma B2B</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid ${BORDER};background:#f8fafc;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              Este é um email automático da plataforma Clinipharma. Não responda a este email.<br />
              <a href="${APP_URL}" style="color:${BRAND_COLOR};">Acessar plataforma</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function heading(text: string) {
  return `<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${text}</h1>`
}

function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">${text}</p>`
}

function infoTable(rows: Array<[string, string]>) {
  const rowsHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#64748b;width:45%;border-bottom:1px solid ${BORDER};">${label}</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;border-bottom:1px solid ${BORDER};">${value}</td>
      </tr>`
    )
    .join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;margin:20px 0;border-collapse:collapse;">${rowsHtml}</table>`
}

function ctaButton(label: string, href: string) {
  return `<a href="${href}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-top:8px;">${label}</a>`
}

function badge(text: string, color: string) {
  return `<span style="display:inline-block;background:${color}22;color:${color};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid ${color}44;">${text}</span>`
}

// ─── Templates ───────────────────────────────────────────────

export interface NewOrderEmailData {
  orderCode: string
  orderId: string
  productName: string
  quantity: number
  totalPrice: string
  clinicName: string
  doctorName: string
  deadline: string
}

export function newOrderEmail(data: NewOrderEmailData): { subject: string; html: string } {
  const subject = `Novo pedido ${data.orderCode} — ${data.productName}`
  const body = `
    ${heading('Novo pedido recebido')}
    ${paragraph(`O pedido <strong>${data.orderCode}</strong> foi criado e está aguardando seus documentos e processamento.`)}
    ${infoTable([
      ['Código', data.orderCode],
      ['Produto', data.productName],
      ['Quantidade', String(data.quantity)],
      ['Valor total', data.totalPrice],
      ['Clínica', data.clinicName],
      ['Médico', data.doctorName],
      ['Prazo estimado', data.deadline],
    ])}
    ${ctaButton('Ver pedido', `${APP_URL}/orders/${data.orderId}`)}
  `
  return { subject, html: layout(subject, body) }
}

export interface PaymentConfirmedEmailData {
  orderCode: string
  orderId: string
  productName: string
  totalPrice: string
  clinicName: string
}

export function paymentConfirmedEmail(data: PaymentConfirmedEmailData): {
  subject: string
  html: string
} {
  const subject = `Pagamento confirmado — Pedido ${data.orderCode}`
  const body = `
    ${heading('Pagamento confirmado')}
    ${badge('Pagamento confirmado', '#16a34a')}
    ${paragraph(`O pagamento do pedido <strong>${data.orderCode}</strong> foi confirmado. O pedido está liberado para execução.`)}
    ${infoTable([
      ['Código', data.orderCode],
      ['Produto', data.productName],
      ['Valor', data.totalPrice],
      ['Clínica', data.clinicName],
    ])}
    ${ctaButton('Acompanhar pedido', `${APP_URL}/orders/${data.orderId}`)}
  `
  return { subject, html: layout(subject, body) }
}

export interface TransferRegisteredEmailData {
  orderId: string
  orderCode: string
  pharmacyName: string
  netAmount: string
  reference: string
}

export function transferRegisteredEmail(data: TransferRegisteredEmailData): {
  subject: string
  html: string
} {
  const subject = `Repasse registrado — Pedido ${data.orderCode}`
  const body = `
    ${heading('Repasse registrado')}
    ${badge('Repasse enviado', '#2563eb')}
    ${paragraph(`O repasse referente ao pedido <strong>${data.orderCode}</strong> foi registrado pela plataforma.`)}
    ${infoTable([
      ['Farmácia', data.pharmacyName],
      ['Valor líquido', data.netAmount],
      ['Referência', data.reference],
      ['Pedido', data.orderCode],
    ])}
    ${ctaButton('Ver detalhes', `${APP_URL}/orders/${data.orderId}`)}
  `
  return { subject, html: layout(subject, body) }
}

export interface OrderStatusUpdatedEmailData {
  orderCode: string
  orderId: string
  newStatus: string
  statusLabel: string
  productName: string
}

const STATUS_COLORS: Record<string, string> = {
  IN_EXECUTION: '#d97706',
  READY: '#16a34a',
  SHIPPED: '#2563eb',
  DELIVERED: '#16a34a',
  COMPLETED: '#16a34a',
  CANCELED: '#dc2626',
  WITH_ISSUE: '#dc2626',
}

export function orderStatusUpdatedEmail(data: OrderStatusUpdatedEmailData): {
  subject: string
  html: string
} {
  const color = STATUS_COLORS[data.newStatus] ?? '#64748b'
  const subject = `Pedido ${data.orderCode} — ${data.statusLabel}`
  const body = `
    ${heading('Status do pedido atualizado')}
    ${badge(data.statusLabel, color)}
    ${paragraph(`O status do pedido <strong>${data.orderCode}</strong> foi atualizado.`)}
    ${infoTable([
      ['Código', data.orderCode],
      ['Produto', data.productName],
      ['Novo status', data.statusLabel],
    ])}
    ${ctaButton('Ver pedido', `${APP_URL}/orders/${data.orderId}`)}
  `
  return { subject, html: layout(subject, body) }
}

// ─── Payment reminders (replaces Asaas-side e-mails since 2026-04-29) ─

export type PaymentReminderKind = 'D_MINUS_3' | 'D_MINUS_1' | 'D_DAY' | 'OVERDUE'

export interface PaymentReminderEmailData {
  orderCode: string
  orderId: string
  totalPrice: string
  dueDate: string
  /** Days from due date. Negative = before due, 0 = today, positive = overdue. */
  daysFromDue: number
  /** Customer-facing copy hint (e.g. clinic trade name) — appears in the salutation. */
  recipientName?: string
}

const REMINDER_PROFILES: Record<
  PaymentReminderKind,
  {
    subjectPrefix: string
    badgeText: string
    badgeColor: string
    headline: string
    leadCopy: (data: PaymentReminderEmailData) => string
    ctaLabel: string
  }
> = {
  D_MINUS_3: {
    subjectPrefix: 'Lembrete: pagamento em 3 dias',
    badgeText: 'Vence em 3 dias',
    badgeColor: '#2563eb',
    headline: 'Seu pedido está aguardando pagamento',
    leadCopy: (d) =>
      `O pagamento do pedido <strong>${d.orderCode}</strong> vence em <strong>${d.dueDate}</strong>. Você pode pagar agora pelo painel da Clinipharma — temos PIX, boleto e cartão prontos pra você.`,
    ctaLabel: 'Ver formas de pagar',
  },
  D_MINUS_1: {
    subjectPrefix: 'Pagamento vence amanhã',
    badgeText: 'Vence amanhã',
    badgeColor: '#d97706',
    headline: 'Seu pagamento vence amanhã',
    leadCopy: (d) =>
      `O pedido <strong>${d.orderCode}</strong> vence em <strong>${d.dueDate}</strong> (amanhã). Para evitar atrasos no envio dos itens, finalize o pagamento agora — leva menos de um minuto pelo PIX.`,
    ctaLabel: 'Pagar agora',
  },
  D_DAY: {
    subjectPrefix: 'Pagamento vence hoje',
    badgeText: 'Vence hoje',
    badgeColor: '#d97706',
    headline: 'Seu pagamento vence hoje',
    leadCopy: (d) =>
      `O pedido <strong>${d.orderCode}</strong> vence <strong>hoje (${d.dueDate})</strong>. Após o vencimento o boleto perde a validade e o pedido pode ser cancelado automaticamente. Pague agora pelo painel.`,
    ctaLabel: 'Pagar agora',
  },
  OVERDUE: {
    subjectPrefix: 'Pagamento em atraso',
    badgeText: 'Em atraso',
    badgeColor: '#dc2626',
    headline: 'Pagamento em atraso',
    leadCopy: (d) =>
      `O pedido <strong>${d.orderCode}</strong> venceu em <strong>${d.dueDate}</strong> (${d.daysFromDue} dia${
        d.daysFromDue === 1 ? '' : 's'
      } de atraso). Para evitar o cancelamento automático, regularize o pagamento agora — você pode gerar um novo PIX ou boleto pelo painel.`,
    ctaLabel: 'Regularizar pagamento',
  },
}

/**
 * Build the Clinipharma-branded payment reminder e-mail. Every cadence
 * shares the same layout (same brand colors, same CTA target — the
 * order detail page) and only the copy + badge change. Keeping them
 * in one function makes it impossible to forget a button or send a
 * 'D-1' subject with 'D-3' body.
 *
 * The CTA always lands on `/orders/<id>` because that's where our own
 * UI exposes PIX / boleto / cartão — we deliberately do NOT link to
 * the Asaas invoice URL directly. Linking to our page keeps branding
 * tight and means a future "split payment" or "renegotiate" feature
 * can be exposed on the same screen.
 */
export function paymentReminderEmail(
  kind: PaymentReminderKind,
  data: PaymentReminderEmailData
): { subject: string; html: string } {
  const profile = REMINDER_PROFILES[kind]
  const subject = `${profile.subjectPrefix} — Pedido ${data.orderCode}`
  const greeting = data.recipientName
    ? paragraph(`Olá, <strong>${data.recipientName}</strong>!`)
    : ''
  const body = `
    ${heading(profile.headline)}
    ${badge(profile.badgeText, profile.badgeColor)}
    ${greeting}
    ${paragraph(profile.leadCopy(data))}
    ${infoTable([
      ['Pedido', data.orderCode],
      ['Valor', data.totalPrice],
      ['Vencimento', data.dueDate],
    ])}
    ${ctaButton(profile.ctaLabel, `${APP_URL}/orders/${data.orderId}`)}
    ${paragraph(
      `<span style="font-size:13px;color:#64748b;">Se já pagou, pode ignorar este e-mail — a confirmação chega automaticamente assim que o banco compensa.</span>`
    )}
  `
  return { subject, html: layout(subject, body) }
}

export interface ConsultantTransferEmailData {
  consultantName: string
  totalAmount: string
  reference: string
  commissionCount: number
}

export function consultantTransferEmail(data: ConsultantTransferEmailData): {
  subject: string
  html: string
} {
  const subject = `Repasse de comissão registrado — ${data.totalAmount}`
  const body = `
    ${heading('Repasse de comissão')}
    ${badge('Pago', '#16a34a')}
    ${paragraph(`Olá, <strong>${data.consultantName}</strong>! Um repasse de comissões foi registrado pela plataforma Clinipharma.`)}
    ${infoTable([
      ['Valor total', data.totalAmount],
      ['Referência', data.reference],
      ['Pedidos incluídos', String(data.commissionCount)],
    ])}
    ${ctaButton('Ver extrato', `${APP_URL}/dashboard`)}
  `
  return { subject, html: layout(subject, body) }
}

// ─── Consultant onboarding & lifecycle ────────────────────────

export interface ConsultantWelcomeEmailData {
  consultantName: string
  /** Magic-link URL produced by `auth.admin.generateLink` (action_link). */
  inviteUrl: string
  commissionRate: string
}

export function consultantWelcomeEmail(data: ConsultantWelcomeEmailData): {
  subject: string
  html: string
} {
  const subject = 'Bem-vindo(a) à Clinipharma — defina sua senha'
  const body = `
    ${heading('Sua conta de consultor(a) foi criada')}
    ${badge('Acesso liberado', '#2563eb')}
    ${paragraph(`Olá, <strong>${data.consultantName}</strong>! O time da Clinipharma criou sua conta de consultor(a) de vendas. Para começar a acompanhar suas clínicas e comissões, defina uma senha clicando no botão abaixo.`)}
    ${infoTable([
      ['Taxa de comissão', `${data.commissionRate}% sobre cada pedido pago`],
      ['Onde acompanhar', 'Área "Dashboard" depois do login'],
    ])}
    ${ctaButton('Definir minha senha', data.inviteUrl)}
    ${paragraph(`Se o botão não funcionar, copie e cole este link no navegador:<br /><span style="word-break:break-all;color:#64748b;font-size:12px;">${data.inviteUrl}</span>`)}
  `
  return { subject, html: layout(subject, body) }
}

export interface ConsultantSaleConfirmedEmailData {
  consultantName: string
  orderCode: string
  orderId: string
  clinicName: string
  commissionAmount: string
  commissionRate: string
}

export function consultantSaleConfirmedEmail(data: ConsultantSaleConfirmedEmailData): {
  subject: string
  html: string
} {
  const subject = `Nova comissão a receber — Pedido ${data.orderCode}`
  const body = `
    ${heading('Você tem uma nova comissão')}
    ${badge('Pendente de repasse', '#d97706')}
    ${paragraph(`Olá, <strong>${data.consultantName}</strong>! Um pedido de uma de suas clínicas foi pago e gerou comissão para você.`)}
    ${infoTable([
      ['Pedido', data.orderCode],
      ['Clínica', data.clinicName],
      ['Comissão', data.commissionAmount],
      ['Taxa aplicada', `${data.commissionRate}%`],
    ])}
    ${ctaButton('Ver no dashboard', `${APP_URL}/dashboard`)}
  `
  return { subject, html: layout(subject, body) }
}

export interface ConsultantClinicLinkedEmailData {
  consultantName: string
  clinicName: string
  commissionRate: string
}

export function consultantClinicLinkedEmail(data: ConsultantClinicLinkedEmailData): {
  subject: string
  html: string
} {
  const subject = `Nova clínica vinculada — ${data.clinicName}`
  const body = `
    ${heading('Uma clínica foi vinculada a você')}
    ${badge('Vínculo ativo', '#16a34a')}
    ${paragraph(`Olá, <strong>${data.consultantName}</strong>! A clínica abaixo foi associada a você. A partir de agora, todos os pedidos pagos por essa clínica gerarão comissão na sua conta.`)}
    ${infoTable([
      ['Clínica', data.clinicName],
      ['Sua taxa', `${data.commissionRate}%`],
    ])}
    ${ctaButton('Ver minhas clínicas', `${APP_URL}/dashboard`)}
  `
  return { subject, html: layout(subject, body) }
}
