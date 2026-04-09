import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://clinipharma.com.br'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email inválido.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${APP_URL}/auth/callback?type=recovery`,
      },
    })

    if (error || !data?.properties?.action_link) {
      // Retornamos sucesso mesmo quando o email não existe — evita user enumeration
      return NextResponse.json({ success: true })
    }

    const actionLink = data.properties.action_link

    await resend.emails.send({
      from: 'Clinipharma <noreply@clinipharma.com.br>',
      to: email,
      subject: 'Redefinição de senha — Clinipharma',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
          <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
            <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
          </div>
          <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
            <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Redefinir senha</h2>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
              Recebemos um pedido de redefinição de senha para a conta associada a
              <strong>${email}</strong>. Clique no botão abaixo para criar uma nova senha.
            </p>
            <div style="text-align:center;margin:28px 0">
              <a href="${actionLink}"
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
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 })
  }
}
