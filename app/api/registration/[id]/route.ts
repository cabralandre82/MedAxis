import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/db/server'
import { createAdminClient } from '@/lib/db/admin'
import { Resend } from 'resend'
import { logger } from '@/lib/logger'
import { inngest } from '@/lib/inngest'
import { sendSms, SMS, sendWhatsApp, WA } from '@/lib/zenvia'

const resend = new Resend(process.env.RESEND_API_KEY)
const APP_URL = 'https://clinipharma.com.br'

// ── Helper: send welcome email with password set link ──────────────────────
async function sendWelcomeEmail(email: string, fullName: string, origin: string) {
  const admin = createAdminClient()
  const { data } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/auth/callback?type=recovery` },
  })

  const link = data?.properties?.hashed_token
    ? `${origin}/auth/callback?token_hash=${data.properties.hashed_token}&type=recovery`
    : `${APP_URL}/login`

  await resend.emails.send({
    from: 'Clinipharma <noreply@clinipharma.com.br>',
    to: email,
    subject: 'Cadastro aprovado — Bem-vindo à Clinipharma!',
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
      <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
        <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
      </div>
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
        <div style="background:#dcfce7;border-left:4px solid #22c55e;padding:12px 16px;border-radius:4px;margin-bottom:20px">
          <p style="margin:0;font-size:14px;color:#166534;font-weight:600">✅ Cadastro aprovado!</p>
        </div>
        <h2 style="color:#1e293b;font-size:18px;margin:0 0 12px">Olá, ${fullName}!</h2>
        <p style="color:#475569;font-size:14px;line-height:1.6">Seu cadastro na Clinipharma foi <strong>aprovado</strong>. Clique no botão abaixo para definir sua senha e acessar a plataforma.</p>
        <div style="margin-top:24px;text-align:center">
          <a href="${link}" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Definir minha senha</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center">Este link expira em 1 hora.</p>
      </div>
    </div>`,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Only SUPER_ADMIN
    const { data: roleData } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()
    if (roleData?.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const { action, admin_notes, requested_docs } = body
    const origin = req.headers.get('origin') ?? APP_URL

    // Fetch request
    const { data: request } = await admin
      .from('registration_requests')
      .select('*, profiles:user_id(email, full_name)')
      .eq('id', id)
      .single()

    if (!request) return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })

    const profile = request.profiles as { email: string; full_name: string } | null
    const email = profile?.email ?? (request.form_data as Record<string, string>).email
    const fullName = profile?.full_name ?? (request.form_data as Record<string, string>).full_name

    if (action === 'approve') {
      const formData = request.form_data as Record<string, string>
      let entityId: string | null = null

      // Create clinic or doctor entity
      if (request.type === 'CLINIC') {
        const { data: clinic, error: clinicErr } = await admin
          .from('clinics')
          .insert({
            trade_name: formData.trade_name,
            cnpj: formData.cnpj,
            email: formData.email,
            phone: formData.phone ?? null,
            address_line_1: formData.address_line_1 ?? '',
            address_line_2: formData.address_line_2 ?? null,
            city: formData.city ?? '',
            state: formData.state ?? '',
            status: 'ACTIVE',
          })
          .select('id')
          .single()
        if (clinicErr) return NextResponse.json({ error: 'Erro ao criar clínica' }, { status: 500 })

        if (clinic && request.user_id) {
          entityId = clinic.id
          const { error: memberErr } = await admin.from('clinic_members').insert({
            user_id: request.user_id,
            clinic_id: clinic.id,
            membership_role: 'ADMIN',
          })
          if (memberErr)
            logger.error('[registration/approve] clinic_members.insert failed', {
              error: memberErr,
            })
        }
      } else {
        // ── CFM auto-validation ──────────────────────────────────────────────
        // Try to validate the CRM against the CFM public API.
        // Auto-approve only when CFM confirms the doctor exists; otherwise
        // the admin still approves manually (current flow).
        let crmValidatedAt: string | null = null
        try {
          const cfmRes = await fetch(
            `https://ws.cfm.org.br/v1/medico/crm/${formData.crm}/uf/${formData.crm_state}`,
            { signal: AbortSignal.timeout(6_000) }
          )
          if (cfmRes.ok) {
            const cfmData = await cfmRes.json()
            // CFM returns situacao field: 'A' = ativo
            if (cfmData?.situacao === 'A') {
              crmValidatedAt = new Date().toISOString()
            }
          }
        } catch {
          // CFM API unavailable — proceed without validation
        }

        const { data: doctor, error: doctorErr } = await admin
          .from('doctors')
          .insert({
            full_name: fullName,
            crm: formData.crm,
            crm_state: formData.crm_state,
            specialty: formData.specialty ?? null,
            email: formData.email,
            phone: formData.phone ?? null,
            cpf: formData.cpf ?? null,
            user_id: request.user_id ?? null,
            crm_validated_at: crmValidatedAt,
          })
          .select('id')
          .single()
        if (doctorErr) return NextResponse.json({ error: 'Erro ao criar médico' }, { status: 500 })

        if (doctor) {
          entityId = doctor.id
          if (formData.clinic_cnpj) {
            const { data: clinic } = await admin
              .from('clinics')
              .select('id')
              .eq('cnpj', formData.clinic_cnpj)
              .maybeSingle()
            if (clinic && request.user_id) {
              const { error: linkErr } = await admin.from('doctor_clinic_links').upsert({
                doctor_id: doctor.id,
                clinic_id: clinic.id,
                is_primary: true,
              })
              if (linkErr)
                logger.error('[registration/approve] doctor_clinic_links.upsert failed', {
                  error: linkErr,
                })
            }
          }
        }
      }

      // Update request + profile
      const { error: approveErr } = await admin
        .from('registration_requests')
        .update({
          status: 'APPROVED',
          entity_id: entityId,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (approveErr)
        logger.error('[registration/approve] registration_requests.update failed', {
          error: approveErr,
        })

      if (request.user_id) {
        const { error: profileErr } = await admin
          .from('profiles')
          .update({ registration_status: 'APPROVED' })
          .eq('id', request.user_id)
        if (profileErr)
          logger.error('[registration/approve] profiles.update failed', { error: profileErr })
      }

      // Send welcome email with password link
      await sendWelcomeEmail(email, fullName, origin)

      // SMS + WhatsApp notification (non-blocking)
      const formPhone = (request.form_data as Record<string, string>).phone
      if (formPhone) {
        sendSms(formPhone, SMS.registrationApproved(fullName)).catch(() => null)
        sendWhatsApp(formPhone, WA.registrationApproved(fullName)).catch(() => null)
      }

      // Auto-send contract via Inngest (async — does not block the response)
      if (entityId && (request.type === 'CLINIC' || request.type === 'DOCTOR')) {
        inngest
          .send({
            name: 'registration/contract.auto-send',
            data: {
              entityType: request.type as 'CLINIC' | 'DOCTOR',
              entityId,
              registrationId: id,
            },
          })
          .catch((err) =>
            logger.error('[registration/approve] contract auto-send trigger failed', { err })
          )
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'reject') {
      const { error: rejectErr } = await admin
        .from('registration_requests')
        .update({
          status: 'REJECTED',
          admin_notes,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (rejectErr)
        logger.error('[registration/reject] registration_requests.update failed', {
          error: rejectErr,
        })

      if (request.user_id) {
        const { error: profileRejectErr } = await admin
          .from('profiles')
          .update({ registration_status: 'REJECTED' })
          .eq('id', request.user_id)
        if (profileRejectErr)
          logger.error('[registration/reject] profiles.update failed', { error: profileRejectErr })
      }

      await resend.emails.send({
        from: 'Clinipharma <noreply@clinipharma.com.br>',
        to: email,
        subject: 'Atualização do seu cadastro — Clinipharma',
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
          <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
            <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
          </div>
          <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
            <h2 style="color:#1e293b;margin:0 0 12px">Olá, ${fullName}</h2>
            <p style="color:#475569;font-size:14px;line-height:1.6">Após análise, não foi possível aprovar sua solicitação de cadastro neste momento.</p>
            ${
              admin_notes
                ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:16px 0">
              <p style="margin:0;font-size:13px;color:#991b1b"><strong>Motivo:</strong> ${admin_notes}</p>
            </div>`
                : ''
            }
            <p style="color:#475569;font-size:14px">Em caso de dúvidas, entre em contato com nossa equipe.</p>
          </div>
        </div>`,
      })

      // SMS + WhatsApp notification (non-blocking)
      const rejectPhone = (request.form_data as Record<string, string>).phone
      if (rejectPhone) {
        sendSms(rejectPhone, SMS.registrationRejected(fullName)).catch(() => null)
        sendWhatsApp(
          rejectPhone,
          WA.registrationRejected(fullName, admin_notes ?? 'Sem motivo informado')
        ).catch(() => null)
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'request_docs') {
      const { error: pendingDocsErr } = await admin
        .from('registration_requests')
        .update({
          status: 'PENDING_DOCS',
          requested_docs,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (pendingDocsErr)
        logger.error('[registration/request_docs] registration_requests.update failed', {
          error: pendingDocsErr,
        })

      if (request.user_id) {
        const { error: profilePendingErr } = await admin
          .from('profiles')
          .update({ registration_status: 'PENDING_DOCS' })
          .eq('id', request.user_id)
        if (profilePendingErr)
          logger.error('[registration/request_docs] profiles.update failed', {
            error: profilePendingErr,
          })
      }

      const docList = (requested_docs as Array<{ label: string; custom_text?: string }>)
        .map(
          (d) =>
            `<li style="margin:4px 0;color:#475569;font-size:14px">${d.label}${d.custom_text ? ` — ${d.custom_text}` : ''}</li>`
        )
        .join('')

      await resend.emails.send({
        from: 'Clinipharma <noreply@clinipharma.com.br>',
        to: email,
        subject: 'Documentos pendentes — Clinipharma',
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#f8fafc">
          <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center">
            <h1 style="color:#fff;font-size:22px;margin:0">Clinipharma</h1>
          </div>
          <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
            <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-bottom:20px">
              <p style="margin:0;font-size:14px;color:#92400e;font-weight:600">⚠️ Documentos adicionais necessários</p>
            </div>
            <h2 style="color:#1e293b;margin:0 0 12px">Olá, ${fullName}</h2>
            <p style="color:#475569;font-size:14px;line-height:1.6">Para concluir a análise do seu cadastro, precisamos dos seguintes documentos:</p>
            <ul style="margin:16px 0;padding-left:20px">${docList}</ul>
            <p style="color:#475569;font-size:14px">Acesse a plataforma para fazer o upload:</p>
            <div style="margin-top:24px;text-align:center">
              <a href="${APP_URL}/dashboard" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Enviar documentos</a>
            </div>
          </div>
        </div>`,
      })

      // In-app notification
      if (request.user_id) {
        await admin.from('notifications').insert({
          user_id: request.user_id,
          type: 'REGISTRATION_REQUEST',
          title: 'Documentos pendentes',
          body: 'A plataforma solicitou documentos adicionais para seu cadastro',
          link: '/dashboard',
        })
      }

      // SMS notification (non-blocking)
      const pendingPhone = (request.form_data as Record<string, string>).phone
      if (pendingPhone) {
        sendSms(pendingPhone, SMS.pendingDocs(fullName)).catch(() => null)
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (err) {
    logger.error('[registration/action] unexpected error', { error: err })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
