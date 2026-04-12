import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { ProfileForm } from '@/components/profile/profile-form'
import { Badge } from '@/components/ui/badge'
import { Shield, Calendar, CheckCircle, XCircle } from 'lucide-react'

export const metadata = { title: 'Meu Perfil | Clinipharma' }

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin da Plataforma',
  CLINIC_ADMIN: 'Admin de Clínica',
  DOCTOR: 'Médico',
  PHARMACY_ADMIN: 'Admin de Farmácia',
  SALES_CONSULTANT: 'Consultor de Vendas',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-800',
  PLATFORM_ADMIN: 'bg-blue-100 text-blue-800',
  CLINIC_ADMIN: 'bg-green-100 text-green-800',
  DOCTOR: 'bg-teal-100 text-teal-800',
  PHARMACY_ADMIN: 'bg-orange-100 text-orange-800',
  SALES_CONSULTANT: 'bg-yellow-100 text-yellow-800',
}

export default async function ProfilePage() {
  await requireRolePage([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
    'SALES_CONSULTANT',
  ])

  const user = await getCurrentUser()
  if (!user) return null

  const formattedDate = new Date(user.created_at).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gerencie suas informações pessoais e preferências de conta.
        </p>
      </div>

      {/* Account summary card */}
      <div className="rounded-xl border bg-white p-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[hsl(213,75%,24%)] text-lg font-bold text-white">
            {user.full_name
              ?.split(' ')
              .slice(0, 2)
              .map((n) => n[0])
              .join('')
              .toUpperCase() ?? '?'}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-gray-900">{user.full_name}</p>
            <p className="truncate text-sm text-gray-500">{user.email}</p>

            {/* Roles */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {user.roles.map((role) => (
                <Badge
                  key={role}
                  className={`text-xs ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-800'}`}
                >
                  <Shield className="mr-1 h-3 w-3" />
                  {ROLE_LABELS[role] ?? role}
                </Badge>
              ))}
            </div>
          </div>

          {/* Status + date */}
          <div className="shrink-0 text-right text-xs text-gray-400">
            <div className="flex items-center justify-end gap-1">
              {user.is_active ? (
                <>
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  <span className="font-medium text-green-600">Ativo</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                  <span className="font-medium text-red-500">Inativo</span>
                </>
              )}
            </div>
            <div className="mt-1 flex items-center justify-end gap-1 text-gray-400">
              <Calendar className="h-3 w-3" />
              <span>Desde {formattedDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Editable form */}
      <div className="rounded-xl border bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Informações pessoais</h2>
        <ProfileForm
          userId={user.id}
          defaultValues={{ full_name: user.full_name, phone: user.phone ?? '' }}
        />
      </div>

      {/* Privacy links */}
      <div className="rounded-xl border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Privacidade e dados</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <p>
            Seus dados são tratados conforme nossa{' '}
            <a
              href="/privacy"
              target="_blank"
              className="text-primary underline-offset-2 hover:underline"
            >
              Política de Privacidade
            </a>
            . Você pode exercer seus direitos (acesso, correção, portabilidade, exclusão) a qualquer
            momento pelo portal LGPD disponível na plataforma ou pelo e-mail{' '}
            <a
              href="mailto:privacidade@clinipharma.com.br"
              className="text-primary hover:underline"
            >
              privacidade@clinipharma.com.br
            </a>
            .
          </p>
          <p className="text-xs text-gray-400">
            Para alterar seu e-mail ou solicitar exclusão de conta, entre em contato com o suporte.
          </p>
        </div>
      </div>
    </div>
  )
}
