import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { Resend } from 'resend'
import { registrationLimiter } from '@/lib/rate-limit'
import { encrypt } from '@/lib/crypto'
import { logger } from '@/lib/logger'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = 'https://clinipharma.com.br'

export async function POST(req: NextRequest) {
  try {
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
    const draftId = fd.get('draft_id') as string | null

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

    // 2. Collect uploaded documents
    const docTypes: string[] = []
    const docEntries: Array<{ docType: string; label: string; file: File }> = []
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith('doc_') || key.endsWith('_label')) continue
      const docType = key.replace('doc_', '')
      const label = (fd.get(`doc_${docType}_label`) as string) ?? docType
      docEntries.push({ docType, label, file: value as File })
    }
    const hasDocs = docEntries.length > 0

    // 3. Determine registration status
    const registrationStatus = hasDocs ? 'PENDING' : 'PENDING_DOCS'

    // 4. Create profile
    const { error: profileError } = await admin.from('profiles').upsert({
      id: userId,
      full_name,
      email,
      registration_status: registrationStatus,
    })
    if (profileError) {
      logger.error('[registration/submit] failed to upsert profile', {
        userId,
        error: profileError,
      })
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Erro ao criar perfil' }, { status: 500 })
    }

    // 5. Assign role
    const role = type === 'CLINIC' ? 'CLINIC_ADMIN' : 'DOCTOR'
    const { error: roleError } = await admin.from('user_roles').insert({ user_id: userId, role })
    if (roleError) {
      logger.error('[registration/submit] failed to assign role', {
        userId,
        role,
        error: roleError,
      })
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Erro ao atribuir papel' }, { status: 500 })
    }

    // 6. Create registration request
    const { data: request, error: reqError } = await admin
      .from('registration_requests')
      .insert({
        type,
        form_data: formData,
        form_data_encrypted: encrypt(formDataRaw),
        user_id: userId,
        status: registrationStatus,
      })
      .select('id')
      .single()

    if (reqError || !request) {
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: 'Erro ao registrar solicitação' }, { status: 500 })
    }

    const requestId = request.id

    // 7. Upload documents (if any)
    for (const { docType, label, file } of docEntries) {
      const ext = file.name.split('.').pop()
      const storagePath = `${requestId}/${docType}.${ext}`

      const { error: storageError } = await admin.storage
        .from('registration-documents')
        .upload(storagePath, file, { contentType: file.type, upsert: true })

      if (!storageError) {
        const { data: urlData } = admin.storage
          .from('registration-documents')
          .getPublicUrl(storagePath)

        const { error: docInsertError } = await admin.from('registration_documents').insert({
          request_id: requestId,
          document_type: docType,
          label,
          filename: file.name,
          storage_path: storagePath,
          public_url: urlData?.publicUrl ?? null,
        })
        if (docInsertError) {
          logger.error('[registration/submit] failed to insert registration_document', {
            requestId,
            docType,
            error: docInsertError,
          })
        } else {
          docTypes.push(label)
        }
      }
    }

    // 8. Delete draft now that the registration was created
    if (draftId) {
      await admin.from('registration_drafts').delete().eq('id', draftId)
    }

    // 9. Notify SUPER_ADMINs
    const { data: admins } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'SUPER_ADMIN')

    if (admins && admins.length > 0) {
      const notificationTitle = hasDocs
        ? `Nova solicitação: ${type === 'CLINIC' ? 'Clínica' : 'Médico'}`
        : `Cadastro sem documentos: ${type === 'CLINIC' ? 'Clínica' : 'Médico'}`

      const notificationBody = hasDocs
        ? `${full_name} solicitou cadastro na plataforma`
        : `${full_name} iniciou cadastro mas não enviou documentos`

      await admin.from('notifications').insert(
        admins.map((a) => ({
          user_id: a.user_id,
          type: 'REGISTRATION_REQUEST',
          title: notificationTitle,
          body: notificationBody,
          link: `/registrations/${requestId}`,
        }))
      )

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

        const alertBanner = hasDocs
          ? `<div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:4px;margin-bottom:20px">
               <p style="margin:0;font-size:14px;color:#1e40af;font-weight:600">Nova solicitação completa — ${entityLabel}</p>
             </div>`
          : `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-bottom:20px">
               <p style="margin:0;font-size:14px;color:#92400e;font-weight:600">⚠ Cadastro sem documentos — ${entityLabel}</p>
               <p style="margin:6px 0 0;font-size:13px;color:#78350f">O solicitante não enviou documentos. Entre em contato para solicitá-los.</p>
             </div>`

        await resend.emails.send({
          from: 'Clinipharma <noreply@clinipharma.com.br>',
          to: adminEmails,
          subject: hasDocs
            ? `Nova solicitação de cadastro: ${entityLabel} — ${full_name}`
            : `⚠ Cadastro sem documentos: ${entityLabel} — ${full_name}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
            <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
              <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
            </div>
            <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
              ${alertBanner}
              <table style="width:100%;font-size:14px">
                <tr><td style="color:#64748b;padding:6px 0">Solicitante</td><td style="padding:6px 0;font-weight:600">${full_name}</td></tr>
                <tr><td style="color:#64748b;padding:6px 0">Email</td><td style="padding:6px 0">${email}</td></tr>
                ${detailsHtml}
                <tr><td style="color:#64748b;padding:6px 0">Telefone</td><td style="padding:6px 0">${formData.phone ?? '—'}</td></tr>
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

    // 10. Confirmation email to requester
    const requesterEmailBody = hasDocs
      ? `<p style="color:#475569;font-size:14px;line-height:1.6">Recebemos sua solicitação de cadastro na Clinipharma. Nossa equipe irá analisá-la em até <strong>2 dias úteis</strong>.</p>
         <p style="color:#475569;font-size:14px;line-height:1.6">Você pode acessar a plataforma com o email e senha que cadastrou. Seu acesso ficará disponível após a aprovação.</p>`
      : `<p style="color:#475569;font-size:14px;line-height:1.6">Recebemos seu cadastro na Clinipharma, mas ainda <strong>não recebemos seus documentos</strong>.</p>
         <p style="color:#475569;font-size:14px;line-height:1.6">Nossa equipe entrará em contato para orientá-lo sobre o envio. Você também pode acessar a plataforma e enviar os documentos diretamente por lá.</p>`

    await resend.emails.send({
      from: 'Clinipharma <noreply@clinipharma.com.br>',
      to: email,
      subject: hasDocs
        ? 'Solicitação recebida — Clinipharma'
        : 'Cadastro recebido — documentos pendentes | Clinipharma',
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
          <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
        </div>
        <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
          <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Olá, ${full_name}!</h2>
          ${requesterEmailBody}
          <div style="margin-top:24px;text-align:center">
            <a href="${APP_URL}/login" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Acessar a plataforma</a>
          </div>
        </div>
      </div>`,
    })

    return NextResponse.json({ success: true, request_id: requestId, status: registrationStatus })
  } catch (err) {
    logger.error('[registration/submit]', { err })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
