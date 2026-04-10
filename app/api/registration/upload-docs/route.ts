import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = 'https://clinipharma.com.br'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Must be PENDING_DOCS
    const { data: profile } = await admin
      .from('profiles')
      .select('registration_status, full_name, email')
      .eq('id', user.id)
      .single()

    if (!profile || profile.registration_status !== 'PENDING_DOCS') {
      return NextResponse.json(
        { error: 'Nenhum documento pendente para este usuário' },
        { status: 400 }
      )
    }

    // Fetch the registration request
    const { data: request } = await admin
      .from('registration_requests')
      .select('id, requested_docs')
      .eq('user_id', user.id)
      .eq('status', 'PENDING_DOCS')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!request) {
      return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })
    }

    const fd = await req.formData()
    const uploadedLabels: string[] = []

    // Process uploaded files
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith('doc_') || key.endsWith('_label')) continue
      const docType = key.replace('doc_', '')
      const label = (fd.get(`doc_${docType}_label`) as string) ?? docType
      const file = value as File

      const ext = file.name.split('.').pop()
      const storagePath = `${request.id}/${docType}_extra_${Date.now()}.${ext}`

      const { error: storageError } = await admin.storage
        .from('registration-documents')
        .upload(storagePath, file, { contentType: file.type, upsert: true })

      if (!storageError) {
        const { data: urlData } = admin.storage
          .from('registration-documents')
          .getPublicUrl(storagePath)

        await admin.from('registration_documents').insert({
          request_id: request.id,
          document_type: docType,
          label,
          filename: file.name,
          storage_path: storagePath,
          public_url: urlData?.publicUrl ?? null,
        })

        uploadedLabels.push(label)
      }
    }

    if (uploadedLabels.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo processado' }, { status: 400 })
    }

    // Update statuses back to PENDING
    await admin
      .from('registration_requests')
      .update({ status: 'PENDING', updated_at: new Date().toISOString() })
      .eq('id', request.id)

    await admin.from('profiles').update({ registration_status: 'PENDING' }).eq('id', user.id)

    // Notify SUPER_ADMINs in-app
    const { data: admins } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'SUPER_ADMIN')

    const fullName = profile.full_name
    const email = profile.email

    if (admins && admins.length > 0) {
      await admin.from('notifications').insert(
        admins.map((a) => ({
          user_id: a.user_id,
          type: 'REGISTRATION_REQUEST',
          title: `Documentos reenviados: ${fullName}`,
          body: `${fullName} enviou os documentos solicitados e está aguardando análise novamente`,
          link: `/registrations/${request.id}`,
        }))
      )

      // Email to SUPER_ADMINs
      const { data: adminProfiles } = await admin
        .from('profiles')
        .select('email')
        .in(
          'id',
          admins.map((a) => a.user_id)
        )

      const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean) as string[]

      if (adminEmails.length > 0) {
        await resend.emails.send({
          from: 'Clinipharma <noreply@clinipharma.com.br>',
          to: adminEmails,
          subject: `Documentos reenviados — ${fullName} | Clinipharma`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
            <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
              <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
            </div>
            <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
              <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:12px 16px;border-radius:4px;margin-bottom:20px">
                <p style="margin:0;font-size:14px;color:#1e40af;font-weight:600">📎 Documentos reenviados — aguardando análise</p>
              </div>
              <p style="color:#475569;font-size:14px;line-height:1.6">
                <strong>${fullName}</strong> (${email}) enviou os documentos solicitados e a solicitação voltou para análise.
              </p>
              <p style="color:#475569;font-size:13px;">Documentos enviados: <strong>${uploadedLabels.join(', ')}</strong></p>
              <div style="margin-top:24px;text-align:center">
                <a href="${APP_URL}/registrations/${request.id}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">
                  Analisar solicitação
                </a>
              </div>
            </div>
          </div>`,
        })
      }
    }

    return NextResponse.json({ success: true, uploaded: uploadedLabels.length })
  } catch (err) {
    console.error('[upload-docs]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
