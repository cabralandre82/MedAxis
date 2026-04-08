import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { ProfileForm } from '@/components/profile/profile-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Meu Perfil | MedAxis' }

export default async function ProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="mt-1 text-sm text-gray-500">Gerencie suas informações pessoais e de acesso</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-6 md:col-span-2">
          <ProfileForm user={user} />
        </div>

        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Meu acesso</h2>
            <dl className="space-y-2">
              <div>
                <dt className="text-xs tracking-wide text-gray-500 uppercase">Email</dt>
                <dd className="mt-0.5 text-sm font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-gray-500 uppercase">Papéis</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <span
                      key={role}
                      className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium"
                    >
                      {role}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">Trocar senha</p>
            <p className="mt-1 text-xs text-amber-700">
              Para trocar sua senha, use a opção <strong>&quot;Esqueci a senha&quot;</strong> na
              tela de login. Um link de redefinição será enviado ao seu email.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
