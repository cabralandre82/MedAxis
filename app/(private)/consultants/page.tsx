import Link from 'next/link'
import { createClient } from '@/lib/db/server'
import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { ButtonLink } from '@/components/ui/button-link'
import { formatCNPJ } from '@/lib/utils'
import { UserPlus } from 'lucide-react'

export const metadata = { title: 'Consultores de Vendas — Clinipharma' }

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-800',
}
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
}

export default async function ConsultantsPage() {
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const currentUser = await getCurrentUser()
  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN') ?? false

  const supabase = await createClient()
  const { data: consultants } = await supabase
    .from('sales_consultants')
    .select('id, full_name, email, cnpj, phone, status, created_at')
    .order('full_name')

  const { data: stats } = await supabase
    .from('consultant_commissions')
    .select('consultant_id, commission_amount, status')

  const commissionByConsultant: Record<
    string,
    { pending: number; total: number; clinics: number }
  > = {}
  for (const c of stats ?? []) {
    if (!commissionByConsultant[c.consultant_id]) {
      commissionByConsultant[c.consultant_id] = { pending: 0, total: 0, clinics: 0 }
    }
    commissionByConsultant[c.consultant_id].total += Number(c.commission_amount)
    if (c.status === 'PENDING') {
      commissionByConsultant[c.consultant_id].pending += Number(c.commission_amount)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Consultores de Vendas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Gerencie consultores e acompanhe comissões por clínica vinculada
          </p>
        </div>
        {isSuperAdmin && (
          <ButtonLink href="/consultants/new">
            <UserPlus className="mr-2 h-4 w-4" />
            Novo consultor
          </ButtonLink>
        )}
      </div>

      {!consultants?.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="text-slate-500">Nenhum consultor cadastrado ainda.</p>
          {isSuperAdmin && (
            <ButtonLink href="/consultants/new" variant="outline" className="mt-4">
              Cadastrar primeiro consultor
            </ButtonLink>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Consultor
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  CNPJ
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  A pagar
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Total gerado
                </th>
                <th className="px-5 py-3.5 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {consultants.map((c) => {
                const cStats = commissionByConsultant[c.id] ?? { pending: 0, total: 0 }
                return (
                  <tr key={c.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <Link
                        href={`/consultants/${c.id}`}
                        className="font-medium text-slate-900 hover:text-blue-600"
                      >
                        {c.full_name}
                      </Link>
                      <p className="text-xs text-slate-500">{c.email}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{formatCNPJ(c.cnpj)}</td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-amber-600">
                      {cStats.pending > 0
                        ? `R$ ${cStats.pending.toFixed(2).replace('.', ',')}`
                        : '—'}
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-slate-600">
                      {cStats.total > 0 ? `R$ ${cStats.total.toFixed(2).replace('.', ',')}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
