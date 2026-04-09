import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { createServerClient } from '@/lib/db/server'
import { formatDate, formatPhone } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ResetPasswordDialog } from '@/components/users/reset-password-dialog'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Detalhe do Usuário | Clinipharma' }

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin da Plataforma',
  CLINIC_ADMIN: 'Admin de Clínica',
  DOCTOR: 'Médico',
  PHARMACY_ADMIN: 'Admin de Farmácia',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-800',
  PLATFORM_ADMIN: 'bg-blue-100 text-blue-800',
  CLINIC_ADMIN: 'bg-green-100 text-green-800',
  DOCTOR: 'bg-purple-100 text-purple-800',
  PHARMACY_ADMIN: 'bg-orange-100 text-orange-800',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const currentUser = await getCurrentUser()
  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN') ?? false

  const supabase = await createServerClient()

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*, user_roles(role)')
    .eq('id', id)
    .single()

  if (!profileRaw) notFound()

  const profile = profileRaw as unknown as {
    id: string
    full_name: string
    email: string
    phone: string | null
    created_at: string
    updated_at: string
    user_roles: Array<{ role: string }>
  }

  const { data: clinicLinksRaw } = await supabase
    .from('clinic_members')
    .select('role, clinics(id, trade_name)')
    .eq('user_id', id)

  const clinicLinks = (clinicLinksRaw ?? []) as unknown as Array<{
    role: string
    clinics: { id: string; trade_name: string } | null
  }>

  const { data: recentOrdersRaw } = await supabase
    .from('orders')
    .select('id, code, order_status, created_at')
    .eq('created_by_user_id', id)
    .order('created_at', { ascending: false })
    .limit(5)

  const recentOrders = (recentOrdersRaw ?? []) as unknown as Array<{
    id: string
    code: string
    order_status: string
    created_at: string
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/users" className="hover:text-primary">
              Usuários
            </Link>
            <span>/</span>
            <span>{profile.full_name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{profile.full_name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            {profile.user_roles.map((r) => (
              <Badge key={r.role} className={ROLE_COLORS[r.role] ?? 'bg-gray-100'}>
                {ROLE_LABELS[r.role] ?? r.role}
              </Badge>
            ))}
          </div>
        </div>
        <ResetPasswordDialog userId={id} userName={profile.full_name} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Dados do Usuário</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium">{profile.email}</dd>
            </div>
            {profile.phone && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Telefone</dt>
                <dd className="text-sm font-medium">{formatPhone(profile.phone)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cadastrado em</dt>
              <dd className="text-sm font-medium">{formatDate(profile.created_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Atualizado em</dt>
              <dd className="text-sm font-medium">{formatDate(profile.updated_at)}</dd>
            </div>
          </dl>
        </div>

        {clinicLinks.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Clínicas Vinculadas</h2>
            <div className="divide-y">
              {clinicLinks.map((link, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <Link
                    href={`/clinics/${link.clinics?.id}`}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    {link.clinics?.trade_name}
                  </Link>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {link.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isSuperAdmin && (
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">Papéis & Permissões</h2>
            <div className="space-y-2">
              {profile.user_roles.length === 0 ? (
                <p className="text-sm text-gray-400">Sem papéis atribuídos</p>
              ) : (
                profile.user_roles.map((r) => (
                  <div
                    key={r.role}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <span className="text-sm font-medium">{ROLE_LABELS[r.role] ?? r.role}</span>
                    <Badge className={ROLE_COLORS[r.role] ?? 'bg-gray-100'}>{r.role}</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {recentOrders.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Pedidos Recentes</h2>
              <Link href={`/orders`} className="text-primary text-sm hover:underline">
                Ver todos
              </Link>
            </div>
            <div className="divide-y">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between py-3">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-primary font-mono text-sm font-medium hover:underline"
                  >
                    {order.code}
                  </Link>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500">{formatDate(order.created_at)}</span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {order.order_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
