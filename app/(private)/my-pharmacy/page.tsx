import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { formatCNPJ, formatPhone, formatDate, formatCurrency } from '@/lib/utils'
import { EntityStatusBadge } from '@/components/shared/status-badge'
import { ButtonLink } from '@/components/ui/button-link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Building2,
  Pencil,
  Package,
  ArrowLeftRight,
  MapPin,
  Phone,
  Mail,
  User,
  CreditCard,
  Hash,
} from 'lucide-react'
import type { Pharmacy, EntityStatus } from '@/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Minha Farmácia | Clinipharma' }

export default async function MyPharmacyPage() {
  await requireRolePage(['PHARMACY_ADMIN'])

  const user = await getCurrentUser()
  const supabase = createAdminClient()

  const { data: memberRow } = await supabase
    .from('pharmacy_members')
    .select('pharmacy_id')
    .eq('user_id', user!.id)
    .single()

  if (!memberRow?.pharmacy_id) notFound()

  const pharmacyId = memberRow.pharmacy_id

  const [
    { data: pharmacyRaw },
    { data: productsRaw },
    { data: transfersRaw },
    { data: ordersRaw },
  ] = await Promise.all([
    supabase.from('pharmacies').select('*').eq('id', pharmacyId).single(),
    // Pharmacy-facing surface — render `pharmacy_cost` (repasse) only.
    // `price_current` (sales price) is intentionally NOT selected so it
    // can never accidentally bleed into this view via a future change.
    // See lib/orders/view-mode.ts for the canonical rule.
    supabase
      .from('products')
      .select('id, name, sku, pharmacy_cost, status')
      .eq('pharmacy_id', pharmacyId)
      .order('name'),
    supabase
      .from('transfers')
      .select('id, net_amount, status, created_at')
      .eq('pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('orders')
      .select('id, order_status')
      .eq('pharmacy_id', pharmacyId)
      .not('order_status', 'in', '("COMPLETED","DELIVERED","CANCELED","DRAFT")'),
  ])

  if (!pharmacyRaw) notFound()

  const pharmacy = pharmacyRaw as unknown as Pharmacy
  const products = (productsRaw ?? []) as unknown as Array<{
    id: string
    name: string
    sku: string
    pharmacy_cost: number
    status: string
  }>
  const transfers = (transfersRaw ?? []) as unknown as Array<{
    id: string
    net_amount: number
    status: string
    created_at: string
  }>
  const activeOrders = (ordersRaw ?? []).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-[hsl(213,75%,24%)]" />
            <h1 className="text-2xl font-bold text-gray-900">{pharmacy.trade_name}</h1>
            <EntityStatusBadge status={pharmacy.status as EntityStatus} />
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{pharmacy.corporate_name}</p>
        </div>
        <ButtonLink href="/my-pharmacy/edit" variant="outline" className="gap-2">
          <Pencil className="h-4 w-4" />
          Editar dados
        </ButtonLink>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Produtos</p>
              <p className="text-2xl font-bold text-gray-900">{products.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="rounded-lg bg-amber-50 p-2.5">
              <Package className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Pedidos ativos</p>
              <p className="text-2xl font-bold text-gray-900">{activeOrders}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="rounded-lg bg-green-50 p-2.5">
              <ArrowLeftRight className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs tracking-wide text-gray-500 uppercase">Repasses</p>
              <p className="text-2xl font-bold text-gray-900">{transfers.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Informações cadastrais */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Informações Cadastrais
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-gray-500">
                  <Hash className="h-3.5 w-3.5" />
                  CNPJ
                </dt>
                <dd className="font-mono text-sm font-medium">{formatCNPJ(pharmacy.cnpj)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-gray-500">
                  <User className="h-3.5 w-3.5" />
                  Responsável
                </dt>
                <dd className="text-sm font-medium">{pharmacy.responsible_person}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-gray-500">
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </dt>
                <dd className="text-sm font-medium">{pharmacy.email}</dd>
              </div>
              {pharmacy.phone && (
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-sm text-gray-500">
                    <Phone className="h-3.5 w-3.5" />
                    Telefone
                  </dt>
                  <dd className="text-sm font-medium">{formatPhone(pharmacy.phone)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-gray-500">
                  <MapPin className="h-3.5 w-3.5" />
                  Endereço
                </dt>
                <dd className="max-w-[240px] text-right text-sm font-medium">
                  {pharmacy.address_line_1}
                  {pharmacy.address_line_2 ? `, ${pharmacy.address_line_2}` : ''} — {pharmacy.city}/
                  {pharmacy.state}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <dt className="text-xs text-gray-400">Cadastrada em</dt>
                <dd className="text-xs text-gray-400">{formatDate(pharmacy.created_at)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Dados bancários */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              Dados Bancários
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!pharmacy.bank_name && !pharmacy.pix_key ? (
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
                <p className="font-medium">Dados bancários não cadastrados</p>
                <p className="mt-1 text-xs">
                  Clique em &ldquo;Editar dados&rdquo; para adicionar seu banco ou chave PIX e
                  receber repasses.
                </p>
              </div>
            ) : (
              <dl className="space-y-3">
                {pharmacy.bank_name && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Banco</dt>
                    <dd className="text-sm font-medium">{pharmacy.bank_name}</dd>
                  </div>
                )}
                {pharmacy.bank_branch && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Agência</dt>
                    <dd className="font-mono text-sm font-medium">{pharmacy.bank_branch}</dd>
                  </div>
                )}
                {pharmacy.bank_account && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Conta</dt>
                    <dd className="font-mono text-sm font-medium">{pharmacy.bank_account}</dd>
                  </div>
                )}
                {pharmacy.pix_key && (
                  <div className="flex justify-between">
                    <dt className="text-sm text-gray-500">Chave PIX</dt>
                    <dd className="max-w-[200px] truncate font-mono text-sm font-medium">
                      {pharmacy.pix_key}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Produtos */}
        {products.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Produtos ({products.length})
              </CardTitle>
              <ButtonLink href="/products" variant="outline" size="sm">
                Gerenciar todos
              </ButtonLink>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {products.slice(0, 8).map((product) => (
                  <div key={product.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link
                        href={`/products/${product.id}/edit`}
                        className="text-sm font-medium text-gray-900 hover:text-[hsl(196,91%,33%)]"
                      >
                        {product.name}
                      </Link>
                      <p className="text-xs text-gray-400">SKU: {product.sku}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-sm font-semibold text-[hsl(213,75%,24%)]"
                        title="Valor de repasse — receita líquida ao executar este produto"
                      >
                        {formatCurrency(product.pharmacy_cost)}
                      </span>
                      <Badge
                        variant={product.status === 'active' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {product.status === 'active'
                          ? 'Ativo'
                          : product.status === 'unavailable'
                            ? 'Indisponível'
                            : 'Inativo'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Repasses recentes */}
        {transfers.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowLeftRight className="h-4 w-4" />
                Últimos Repasses
              </CardTitle>
              <ButtonLink href="/transfers" variant="outline" size="sm">
                Ver todos
              </ButtonLink>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {transfers.map((transfer) => (
                  <div key={transfer.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatCurrency(transfer.net_amount)}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(transfer.created_at)}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        transfer.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {transfer.status === 'COMPLETED' ? 'Pago' : 'Pendente'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
