import { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { hasAnyRole, hasRole } from '@/lib/rbac'
import { getClinicCoupons, getAdminCoupons } from '@/services/coupons'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Tag, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react'
import { CouponActivateForm } from '@/components/coupons/coupon-activate-form'
import { AdminCouponPanel } from '@/components/coupons/admin-coupon-panel'

export const metadata: Metadata = { title: 'Cupons de desconto | Clinipharma' }

function couponStatus(c: {
  active: boolean
  activated_at: string | null
  valid_until: string | null
}) {
  if (!c.active) return { label: 'Cancelado', color: 'text-red-600 bg-red-50', Icon: XCircle }
  if (!c.activated_at)
    return { label: 'Aguardando ativação', color: 'text-amber-600 bg-amber-50', Icon: Clock }
  if (c.valid_until && new Date(c.valid_until) < new Date())
    return { label: 'Expirado', color: 'text-gray-500 bg-gray-100', Icon: AlertCircle }
  return { label: 'Ativo', color: 'text-green-700 bg-green-50', Icon: CheckCircle2 }
}

export default async function CouponsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const isAdminUser = hasAnyRole(user, ['SUPER_ADMIN', 'PLATFORM_ADMIN'])
  const isClinicUser = hasRole(user, 'CLINIC_ADMIN')

  if (!isAdminUser && !isClinicUser) redirect('/unauthorized')

  if (isAdminUser) {
    const { coupons = [], error } = await getAdminCoupons()

    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cupons de desconto</h1>
            <p className="mt-0.5 text-sm text-gray-500">Gerencie cupons por produto e clínica</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <AdminCouponPanel coupons={coupons} />
      </div>
    )
  }

  // CLINIC_ADMIN view
  const { coupons = [], error } = await getClinicCoupons()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meus cupons de desconto</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Cupons atribuídos à sua clínica. Após ativação, o desconto é aplicado automaticamente nos
          pedidos.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Activation form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-gray-900">Ativar cupom</h2>
        <p className="mb-4 text-sm text-gray-500">
          Digite o código enviado pelo administrador da plataforma.
        </p>
        <CouponActivateForm />
      </div>

      {/* Coupon list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Seus cupons ({coupons.length})</h2>
        </div>

        {!coupons.length ? (
          <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
            <Tag className="h-10 w-10" />
            <p className="text-sm">Nenhum cupom disponível para sua clínica ainda.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {coupons.map((c) => {
              const { label, color, Icon } = couponStatus(c)
              const discountLabel =
                c.discount_type === 'PERCENT'
                  ? `${Number(c.discount_value).toFixed(0)}% por unidade`
                  : `${formatCurrency(Number(c.discount_value))} por unidade`

              return (
                <li key={c.id} className="flex items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{c.product_name}</p>
                    <p className="mt-0.5 text-sm text-gray-500">
                      Desconto:{' '}
                      <span className="font-semibold text-indigo-600">{discountLabel}</span>
                      {c.max_discount_amount
                        ? ` (teto ${formatCurrency(Number(c.max_discount_amount))})`
                        : ''}
                    </p>
                    {c.valid_until && (
                      <p className="text-xs text-gray-400">
                        Válido até {formatDate(c.valid_until)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                    {!c.activated_at && c.active && (
                      <p className="font-mono text-xs text-gray-400">{c.code}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
