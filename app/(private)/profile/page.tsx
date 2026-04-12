import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { ProfileForm } from '@/components/profile/profile-form'
import { PendingDocsUpload } from '@/components/profile/pending-docs-upload'
import { NotificationPreferences } from '@/components/profile/notification-preferences'
import { SessionHistory } from '@/components/profile/session-history'
import {
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUS_COLORS,
} from '@/lib/registration-constants'
import { logger } from '@/lib/logger'
import type { Metadata } from 'next'
import type { RequestedDoc } from '@/types'

export const metadata: Metadata = { title: 'Meu Perfil | Clinipharma' }

export default async function ProfilePage() {
  let user
  try {
    user = await getCurrentUser()
  } catch (err) {
    // Re-throw Next.js internal errors so the framework handles them correctly
    if (
      err instanceof Error &&
      (err.message.includes('NEXT_REDIRECT') ||
        err.message.includes('Dynamic server usage') ||
        err.message.includes('NEXT_NOT_FOUND'))
    ) {
      throw err
    }
    logger.error('ProfilePage: getCurrentUser threw unexpectedly', { error: String(err) })
    redirect('/login')
  }

  if (!user) redirect('/login')

  // Fetch pending docs if applicable
  let requestedDocs: RequestedDoc[] | null = null
  const regStatus = user.registration_status ?? 'APPROVED'

  if (regStatus === 'PENDING_DOCS') {
    try {
      const admin = createAdminClient()
      const { data: request } = await admin
        .from('registration_requests')
        .select('requested_docs')
        .eq('user_id', user.id)
        .eq('status', 'PENDING_DOCS')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (request?.requested_docs) {
        requestedDocs = request.requested_docs as RequestedDoc[]
      }
    } catch (err) {
      logger.warn('ProfilePage: failed to fetch pending docs', { error: String(err) })
    }
  }

  const statusColor = REGISTRATION_STATUS_COLORS[regStatus] ?? 'bg-gray-100 text-gray-700'
  const statusLabel = REGISTRATION_STATUS_LABELS[regStatus] ?? regStatus

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="mt-1 text-sm text-gray-500">Gerencie suas informações pessoais e de acesso</p>
      </div>

      {/* Pending docs section */}
      {regStatus === 'PENDING_DOCS' && requestedDocs && requestedDocs.length > 0 && (
        <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h2 className="font-semibold text-orange-900">Documentos pendentes</h2>
              <p className="text-sm text-orange-700">
                Nossa equipe solicitou os documentos abaixo para concluir a análise do seu cadastro.
              </p>
            </div>
          </div>
          <PendingDocsUpload requestedDocs={requestedDocs} />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-6 md:col-span-2">
          <ProfileForm
            userId={user.id}
            defaultValues={{ full_name: user.full_name ?? '', phone: user.phone ?? '' }}
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Meu acesso</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs tracking-wide text-gray-500 uppercase">Email</dt>
                <dd className="mt-0.5 text-sm font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-gray-500 uppercase">Papéis</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {(user.roles ?? []).map((role) => (
                    <span
                      key={role}
                      className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium"
                    >
                      {role}
                    </span>
                  ))}
                </dd>
              </div>
              {regStatus !== 'APPROVED' && (
                <div>
                  <dt className="text-xs tracking-wide text-gray-500 uppercase">
                    Status do cadastro
                  </dt>
                  <dd className="mt-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
                    >
                      {statusLabel}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">Trocar senha</p>
            <p className="mt-1 text-xs text-amber-700">
              Para trocar sua senha, use a opção <strong>&ldquo;Esqueci a senha&rdquo;</strong> na
              tela de login. Um link de redefinição será enviado ao seu email.
            </p>
          </div>
        </div>
      </div>

      {/* Notification preferences */}
      <div className="rounded-lg border bg-white p-6">
        <div className="mb-5">
          <h2 className="font-semibold text-gray-900">Preferências de notificação</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Escolha quais notificações deseja receber. Notificações essenciais não podem ser
            desativadas.
          </p>
        </div>
        <NotificationPreferences initialPreferences={user.notification_preferences ?? {}} />
      </div>

      {/* Session history */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Segurança</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Histórico de acessos à sua conta. Alertas automáticos em novos dispositivos.
          </p>
        </div>
        <SessionHistory />
      </div>
    </div>
  )
}
