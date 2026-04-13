import { Metadata } from 'next'
import { requireRolePage } from '@/lib/rbac'
import { SettingsForm } from '@/components/shared/settings-form'
import { SlaConfig } from '@/components/settings/sla-config'
import { createAdminClient } from '@/lib/db/admin'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Configurações' }

export default async function SettingsPage() {
  const user = await requireRolePage(['SUPER_ADMIN'])
  const admin = createAdminClient()

  const { data: settings } = await admin.from('app_settings').select('*').order('key')
  const { data: pharmacies } = await admin
    .from('pharmacies')
    .select('id, trade_name')
    .eq('status', 'ACTIVE')
    .order('trade_name')

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-0.5 text-sm text-gray-500">Parâmetros globais da plataforma</p>
      </div>
      <SettingsForm settings={settings ?? []} userId={user.id} />

      {/* SLA Configuration */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">SLA de Pedidos</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Configure prazos globais e por farmácia. Pedidos que ultrapassarem os limites geram
            alertas automáticos.
          </p>
        </div>
        <SlaConfig />
        {(pharmacies ?? []).map((p) => (
          <SlaConfig key={p.id} pharmacyId={p.id} pharmacyName={p.trade_name} />
        ))}
      </div>
    </div>
  )
}
