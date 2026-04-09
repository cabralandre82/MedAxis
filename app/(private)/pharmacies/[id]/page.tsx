import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createServerClient } from '@/lib/db/server'
import { formatCNPJ, formatPhone, formatDate, formatCurrency } from '@/lib/utils'
import { EntityStatusBadge } from '@/components/shared/status-badge'
import { ButtonLink } from '@/components/ui/button-link'
import type { Pharmacy, EntityStatus } from '@/types'

export const metadata = { title: 'Detalhe da Farmácia | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PharmacyDetailPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const supabase = await createServerClient()
  const { data: pharmacy } = await supabase.from('pharmacies').select('*').eq('id', id).single()

  if (!pharmacy) notFound()

  const typedPharmacy = pharmacy as unknown as Pharmacy

  const { data: productsRaw } = await supabase
    .from('products')
    .select('id, name, sku, price_current, active')
    .eq('pharmacy_id', id)
    .order('name')

  const products = productsRaw as unknown as Array<{
    id: string
    name: string
    sku: string
    price_current: number
    active: boolean
  }>

  const { data: transfersRaw } = await supabase
    .from('transfers')
    .select('id, net_amount, status, created_at')
    .eq('pharmacy_id', id)
    .order('created_at', { ascending: false })
    .limit(5)

  const transfers = transfersRaw as unknown as Array<{
    id: string
    net_amount: number
    status: string
    created_at: string
  }>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/pharmacies" className="hover:text-primary">
              Farmácias
            </Link>
            <span>/</span>
            <span>{typedPharmacy.trade_name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{typedPharmacy.trade_name}</h1>
          <p className="text-sm text-gray-500">{typedPharmacy.corporate_name}</p>
        </div>
        <ButtonLink href={`/pharmacies/${id}/edit`} variant="outline">
          Editar
        </ButtonLink>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <EntityStatusBadge status={typedPharmacy.status as EntityStatus} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">CNPJ</dt>
              <dd className="text-sm font-medium">{formatCNPJ(typedPharmacy.cnpj)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Responsável</dt>
              <dd className="text-sm font-medium">{typedPharmacy.responsible_person}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium">{typedPharmacy.email}</dd>
            </div>
            {typedPharmacy.phone && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Telefone</dt>
                <dd className="text-sm font-medium">{formatPhone(typedPharmacy.phone)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Cadastrada em</dt>
              <dd className="text-sm font-medium">{formatDate(typedPharmacy.created_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Dados Bancários</h2>
          <dl className="space-y-3">
            {typedPharmacy.bank_name && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Banco</dt>
                <dd className="text-sm font-medium">{typedPharmacy.bank_name}</dd>
              </div>
            )}
            {typedPharmacy.bank_branch && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Agência</dt>
                <dd className="text-sm font-medium">{typedPharmacy.bank_branch}</dd>
              </div>
            )}
            {typedPharmacy.bank_account && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Conta</dt>
                <dd className="text-sm font-medium">{typedPharmacy.bank_account}</dd>
              </div>
            )}
            {typedPharmacy.pix_key && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Chave PIX</dt>
                <dd className="max-w-[200px] truncate text-sm font-medium">
                  {typedPharmacy.pix_key}
                </dd>
              </div>
            )}
            {!typedPharmacy.bank_name && !typedPharmacy.pix_key && (
              <p className="text-sm text-gray-400">Nenhum dado bancário cadastrado</p>
            )}
          </dl>
        </div>

        {products && products.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Produtos ({products.length})</h2>
              <ButtonLink href={`/products?pharmacy=${id}`} variant="outline" size="sm">
                Ver todos
              </ButtonLink>
            </div>
            <div className="divide-y">
              {products.slice(0, 5).map((product) => (
                <div key={product.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      href={`/catalog/${product.id}`}
                      className="hover:text-primary text-sm font-medium"
                    >
                      {product.name}
                    </Link>
                    <p className="text-xs text-gray-500">SKU: {product.sku}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-primary text-sm font-semibold">
                      {formatCurrency(product.price_current)}
                    </span>
                    <span
                      className={`text-xs ${product.active ? 'text-green-600' : 'text-gray-400'}`}
                    >
                      {product.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {transfers && transfers.length > 0 && (
          <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Últimos Repasses</h2>
              <ButtonLink href="/transfers" variant="outline" size="sm">
                Ver todos
              </ButtonLink>
            </div>
            <div className="divide-y">
              {transfers.map((transfer) => (
                <div key={transfer.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{formatCurrency(transfer.net_amount)}</p>
                    <p className="text-xs text-gray-500">{formatDate(transfer.created_at)}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      transfer.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {transfer.status === 'COMPLETED' ? 'Pago' : 'Pendente'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
