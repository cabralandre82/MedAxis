import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM = 'Clinipharma <noreply@clinipharma.com.br>'
const APP_URL = 'https://clinipharma.com.br'

interface AuthHookPayload {
  user: {
    id: string
    email: string
    user_metadata?: Record<string, string>
  }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

function buildConfirmUrl(token_hash: string, type: string, redirect_to: string): string {
  const params = new URLSearchParams({ token_hash, type, next: redirect_to })
  return `${APP_URL}/auth/confirm?${params}`
}

function recoveryEmail(email: string, confirmUrl: string): { subject: string; html: string } {
  return {
    subject: 'Redefinição de senha — Clinipharma',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Redefinir senha</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
            Recebemos um pedido de redefinição de senha para a conta associada a <strong>${email}</strong>.
            Clique no botão abaixo para criar uma nova senha.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${confirmUrl}"
               style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">
              Redefinir minha senha
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center">
            Este link expira em 1 hora. Se você não solicitou a redefinição, ignore este email.
          </p>
        </div>
        <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px">
          Clinipharma · Plataforma B2B de intermediação médica
        </p>
      </div>
    `,
  }
}

function signupEmail(email: string, confirmUrl: string): { subject: string; html: string } {
  return {
    subject: 'Confirme seu email — Clinipharma',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Bem-vindo(a) ao Clinipharma</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
            Confirme seu endereço de email <strong>${email}</strong> clicando no botão abaixo.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${confirmUrl}"
               style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">
              Confirmar email
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center">
            Este link expira em 1 hora.
          </p>
        </div>
        <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:16px">
          Clinipharma · Plataforma B2B de intermediação médica
        </p>
      </div>
    `,
  }
}

function magicLinkEmail(email: string, confirmUrl: string): { subject: string; html: string } {
  return {
    subject: 'Seu link de acesso — Clinipharma',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Link de acesso</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
            Clique no botão abaixo para acessar sua conta <strong>${email}</strong>.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${confirmUrl}"
               style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">
              Acessar minha conta
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center">
            Este link expira em 1 hora. Se você não solicitou o acesso, ignore este email.
          </p>
        </div>
      </div>
    `,
  }
}

serve(async (req) => {
  let payload: AuthHookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { user, email_data } = payload
  const { email_action_type, token_hash, redirect_to } = email_data

  const confirmUrl = buildConfirmUrl(token_hash, email_action_type, redirect_to)

  let emailContent: { subject: string; html: string }

  switch (email_action_type) {
    case 'recovery':
      emailContent = recoveryEmail(user.email, confirmUrl)
      break
    case 'signup':
    case 'email_change':
      emailContent = signupEmail(user.email, confirmUrl)
      break
    case 'magiclink':
      emailContent = magicLinkEmail(user.email, confirmUrl)
      break
    default:
      emailContent = {
        subject: `Ação necessária na sua conta — Clinipharma`,
        html: `<p>Clique <a href="${confirmUrl}">aqui</a> para confirmar a ação.</p>`,
      }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 })
})
