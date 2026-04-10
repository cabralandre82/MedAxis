import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { Resend } from 'resend'
import { registrationLimiter } from '@/lib/rate-limit'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = 'https://clinipharma.com.br'

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 3 registration attempts per 10 minutes per IP
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
    const rl = await registrationLimiter.check(`registration:${ip}`)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Muitas tentativas de cadastro. Aguarde antes de tentar novamente.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
        }
      )
    }

    const fd = await req.formData()
    const type = fd.get('type') as 'CLINIC' | 'DOCTOR'
    const formDataRaw = fd.get('form_data') as string

    if (!type || !formDataRaw) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const formData = JSON.parse(formDataRaw)
    const { email, password, full_name } = formData

    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, senha e nome são obrigatórios' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 1. Create auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, registration_type: type },
    })

    if (authError || !authData.user) {
      if (authError?.message?.includes('already')) {
        return NextResponse.json({ error: 'Este email já está cadastrado' }, { status: 409 })
      }
      return NextResponse.json(
        { error: authError?.message ?? 'Erro ao criar conta' },
        { status: 500 }
      )
    }

    const userId = authData.user.id

    // 2. Create profile with PENDING status
    await admin.from('profiles').upsert({
      id: userId,
      full_name,
      email,
      registration_status: 'PENDING',
    })

    // 3. Assign role (restricted until approved)
    const role = type === 'CLINIC' ? 'CLINIC_ADMIN' : 'DOCTOR'
    await admin.from('user_roles').insert({ user_id: userId, role })

    // 4. Create registration request
    const { data: request, error: reqError } = await admin
      .from('registration_requests')
      .insert({ type, form_data: formData, user_id: userId, status: 'PENDING' })
      .select('id')
      .single()

    if (reqError || !request) {
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Erro ao registrar solicitação' }, { status: 500 })
    }

    const requestId = request.id

    // 5. Upload documents to Supabase Storage
    const docTypes: string[] = []
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith('doc_') || key.endsWith('_label')) continue
      const docType = key.replace('doc_', '')
      const label = (fd.get(`doc_${docType}_label`) as string) ?? docType
      const file = value as File

      const ext = file.name.split('.').pop()
      const storagePath = `${requestId}/${docType}.${ext}`

      const { error: storageError } = await admin.storage
        .from('registration-documents')
        .upload(storagePath, file, { contentType: file.type, upsert: true })

      if (!storageError) {
        const { data: urlData } = admin.storage
          .from('registration-documents')
          .getPublicUrl(storagePath)

        await admin.from('registration_documents').insert({
          request_id: requestId,
          document_type: docType,
          label,
          filename: file.name,
          storage_path: storagePath,
          public_url: urlData?.publicUrl ?? null,
        })

        docTypes.push(label)
      }
    }

    // 6. Notify SUPER_ADMIN in-app
    const { data: admins } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'SUPER_ADMIN')

    if (admins && admins.length > 0) {
      await admin.from('notifications').insert(
        admins.map((a) => ({
          user_id: a.user_id,
          type: 'REGISTRATION_REQUEST',
          title: `Nova solicitação: ${type === 'CLINIC' ? 'Clínica' : 'Médico'}`,
          body: `${full_name} solicitou cadastro na plataforma`,
          link: `/registrations/${requestId}`,
        }))
      )

      // 7. Email to SUPER_ADMIN
      const { data: adminProfiles } = await admin
        .from('profiles')
        .select('email')
        .in(
          'id',
          admins.map((a) => a.user_id)
        )

      const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean) as string[]

      if (adminEmails.length > 0) {
        const entityLabel = type === 'CLINIC' ? 'Clínica' : 'Médico'
        const detailsHtml =
          type === 'CLINIC'
            ? `<tr><td style="color:#64748b;padding:6px 0">Clínica</td><td style="padding:6px 0;font-weight:600">${formData.trade_name ?? '—'}</td></tr>
             <tr><td style="color:#64748b;padding:6px 0">CNPJ</td><td style="padding:6px 0">${formData.cnpj ?? '—'}</td></tr>`
            : `<tr><td style="color:#64748b;padding:6px 0">CRM</td><td style="padding:6px 0;font-weight:600">${formData.crm ?? '—'}/${formData.crm_state ?? ''}</td></tr>
             <tr><td style="color:#64748b;padding:6px 0">Especialidade</td><td style="padding:6px 0">${formData.specialty ?? '—'}</td></tr>`

        await resend.emails.send({
          from: 'Clinipharma <noreply@clinipharma.com.br>',
          to: adminEmails,
          subject: `Nova solicitação de cadastro: ${entityLabel} — ${full_name}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
            <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
              <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
            </div>
            <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
              <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:4px;margin-bottom:20px">
                <p style="margin:0;font-size:14px;color:#1e40af;font-weight:600">Nova solicitação de cadastro — ${entityLabel}</p>
              </div>
              <table style="width:100%;font-size:14px">
                <tr><td style="color:#64748b;padding:6px 0">Solicitante</td><td style="padding:6px 0;font-weight:600">${full_name}</td></tr>
                <tr><td style="color:#64748b;padding:6px 0">Email</td><td style="padding:6px 0">${email}</td></tr>
                ${detailsHtml}
                <tr><td style="color:#64748b;padding:6px 0">Documentos</td><td style="padding:6px 0">${docTypes.join(', ') || '—'}</td></tr>
              </table>
              <div style="margin-top:24px;text-align:center">
                <a href="${APP_URL}/registrations/${requestId}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Analisar solicitação</a>
              </div>
            </div>
          </div>`,
        })
      }
    }

    // 8. Confirmation email to requester
    await resend.emails.send({
      from: 'Clinipharma <noreply@clinipharma.com.br>',
      to: email,
      subject: 'Solicitação recebida — Clinipharma',
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Olá, ${full_name}!</h2>
          <p style="color:#475569;font-size:14px;line-height:1.6">Recebemos sua solicitação de cadastro na Clinipharma. Nossa equipe irá analisá-la em até <strong>2 dias úteis</strong>.</p>
          <p style="color:#475569;font-size:14px;line-height:1.6">Você pode acessar a plataforma com o email e senha que cadastrou. Seu acesso ficará disponível após a aprovação.</p>
          <div style="margin-top:24px;text-align:center">
            <a href="${APP_URL}/login" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Acessar a plataforma</a>
          </div>
        </div>
      </div>`,
    })

    return NextResponse.json({ success: true, request_id: requestId })
  } catch (err) {
    console.error('[registration/submit]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
