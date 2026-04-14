import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { formatCurrency, formatDate } from '@/lib/utils'

import { ButtonLink } from '@/components/ui/button-link'
import { PriceUpdateForm } from '@/components/products/price-update-form'
import { PharmacyCostUpdateForm } from '@/components/products/pharmacy-cost-update-form'
import { ToggleProductActive } from '@/components/products/toggle-product-active'
import { DismissPriceReviewButton } from '@/components/products/dismiss-price-review-button'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  AlertTriangle,
  RefreshCw,
  FlaskConical,
  FileText,
  CheckCircle2,
} from 'lucide-react'
import type { ProductWithRelations, ProductCategory, Pharmacy, ProductPriceHistory } from '@/types'
import { getCurrentUser } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

function MarginBreakdown({
  price,
  cost,
  consultantRate,
}: {
  price: number
  cost: number
  consultantRate: number
}) {
  const margin = price - cost
  const consultantComm = Math.round(price * consultantRate) / 100
  const netWithConsultant = margin - consultantComm
  const marginPct = price > 0 ? Math.round((margin / price) * 100) : 0

  return (
    <div className="space-y-3 rounded-lg border bg-white p-6">
      <h2 className="font-semibold text-gray-900">Análise de margem</h2>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between border-b border-dashed border-slate-100 pb-2">
          <dt className="text-slate-500">Preço ao cliente</dt>
          <dd className="font-medium">{formatCurrency(price)}</dd>
        </div>
        <div className="flex justify-between border-b border-dashed border-slate-100 pb-2">
          <dt className="text-slate-500">Repasse à farmácia</dt>
          <dd className="font-medium text-slate-700">− {formatCurrency(cost)}</dd>
        </div>
        <div className="flex justify-between border-b border-dashed border-slate-100 pb-2">
          <dt className="text-slate-500">Margem bruta ({marginPct}%)</dt>
          <dd className="font-semibold">{formatCurrency(margin)}</dd>
        </div>
        <div className="flex justify-between border-b border-dashed border-slate-100 pb-2">
          <dt className="text-slate-500">Comissão consultor ({consultantRate}%)</dt>
          <dd className="font-medium text-amber-700">− {formatCurrency(consultantComm)}</dd>
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex justify-between">
            <dt className="font-medium text-slate-700">Lucro s/ consultor</dt>
            <dd className={`font-bold ${margin < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(margin)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-medium text-slate-700">Lucro c/ consultor</dt>
            <dd
              className={`font-bold ${netWithConsultant < 0 ? 'text-red-600' : 'text-green-600'}`}
            >
              {formatCurrency(netWithConsultant)}
            </dd>
          </div>
        </div>
      </dl>
    </div>
  )
}

export const metadata = { title: 'Detalhe do Produto | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProductDetailAdminPage({ params }: PageProps) {
  const { id } = await params
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PHARMACY_ADMIN'])

  const supabase = createAdminClient()
  const currentUser = await getCurrentUser()
  const isSuperAdmin = currentUser?.roles.includes('SUPER_ADMIN') ?? false
  const isPharmacy = currentUser?.roles.includes('PHARMACY_ADMIN') ?? false

  // Resolve pharmacy membership for ownership check
  let myPharmacyId: string | undefined
  if (isPharmacy && currentUser) {
    const { data: membership } = await supabase
      .from('pharmacy_members')
      .select('pharmacy_id')
      .eq('user_id', currentUser.id)
      .single()
    myPharmacyId = membership?.pharmacy_id ?? undefined
  }

  const { data: productRaw } = await supabase
    .from('products')
    .select('*, product_categories(*), pharmacies(*)')
    .eq('id', id)
    .single()

  // PHARMACY_ADMIN can only view products belonging to their own pharmacy
  if (isPharmacy && productRaw && myPharmacyId && productRaw.pharmacy_id !== myPharmacyId) {
    notFound()
  }

  const consultantRate = isPharmacy
    ? 0
    : Number(
        (
          await supabase
            .from('app_settings')
            .select('value_json')
            .eq('key', 'consultant_commission_rate')
            .single()
        ).data?.value_json ?? 5
      )

  if (!productRaw) notFound()

  const product = productRaw as unknown as ProductWithRelations & {
    product_categories: ProductCategory | null
    pharmacies: Pharmacy | null
  }

  const isDistributor = product.pharmacies?.entity_type === 'DISTRIBUTOR'

  const PRESCRIPTION_TYPE_LABELS: Record<string, { label: string; detail: string }> = {
    SIMPLE: { label: 'Receita Simples', detail: 'Receita médica comum (branca ou azul)' },
    SPECIAL_CONTROL: {
      label: 'Controle Especial',
      detail: 'Portaria 344/98 — Lista B1, B2, C1, C2, C3',
    },
    ANTIMICROBIAL: { label: 'Antimicrobiano', detail: 'Receita de retenção em 2 vias' },
  }

  const priceHistory = isPharmacy
    ? []
    : (((
        await supabase
          .from('product_price_history')
          .select('*, profiles(full_name)')
          .eq('product_id', id)
          .order('created_at', { ascending: false })
          .limit(10)
      ).data ?? []) as unknown as Array<
        ProductPriceHistory & { profiles: { full_name: string } | null }
      >)

  const { data: costHistoryRaw } = await supabase
    .from('product_pharmacy_cost_history')
    .select('*, profiles(full_name)')
    .eq('product_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  const costHistory = (costHistoryRaw ?? []) as unknown as Array<{
    id: string
    old_cost: number
    new_cost: number
    reason: string
    created_at: string
    profiles: { full_name: string } | null
  }>

  const awaitingPrice = !isPharmacy && product.price_current === 0
  const needsReview =
    !isPharmacy &&
    !awaitingPrice &&
    !!(product as { needs_price_review?: boolean }).needs_price_review

  return (
    <div className="space-y-6">
      {/* Banner: repasse updated by pharmacy — admin should review price */}
      {needsReview && (
        <div className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <RefreshCw className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-orange-800">
              Repasse atualizado pela farmácia
            </p>
            <p className="mt-0.5 text-sm text-orange-700">
              O repasse deste produto foi alterado. Verifique se o preço ao cliente precisa ser
              ajustado para manter a margem saudável.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row">
            {isSuperAdmin && (
              <PriceUpdateForm
                productId={id}
                currentPrice={product.price_current}
                label="Alterar preço"
                highlight
              />
            )}
            <DismissPriceReviewButton productId={id} />
          </div>
        </div>
      )}

      {/* Banner: platform admin sees this when product needs pricing */}
      {awaitingPrice && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Produto aguardando precificação</p>
            <p className="mt-0.5 text-sm text-amber-700">
              Este produto foi cadastrado pela farmácia mas ainda não tem preço ao cliente. Ele está
              inativo e não aparece no catálogo até você definir o preço.
            </p>
          </div>
          {isSuperAdmin && (
            <PriceUpdateForm productId={id} currentPrice={0} label="Definir preço" highlight />
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/products" className="hover:text-primary">
              Produtos
            </Link>
            <span>/</span>
            <span>{product.name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-500">SKU: {product.sku}</p>
        </div>
        <div className="flex gap-3">
          <ButtonLink href={`/products/${id}/edit`} variant="outline">
            Editar
          </ButtonLink>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 rounded-lg border bg-white p-6 md:col-span-2">
          <h2 className="font-semibold text-gray-900">Informações do Produto</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Categoria</dt>
              <dd className="mt-1 text-sm font-medium">
                {product.product_categories?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Farmácia</dt>
              <dd className="mt-1 text-sm font-medium">
                <Link
                  href={`/pharmacies/${product.pharmacy_id}`}
                  className="text-primary hover:underline"
                >
                  {product.pharmacies?.trade_name ?? '—'}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Concentração</dt>
              <dd className="mt-1 text-sm font-medium">{product.concentration}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Apresentação</dt>
              <dd className="mt-1 text-sm font-medium">{product.presentation}</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Prazo de Entrega</dt>
              <dd className="mt-1 text-sm font-medium">{product.estimated_deadline_days} dias</dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Cadastrado em</dt>
              <dd className="mt-1 text-sm font-medium">{formatDate(product.created_at)}</dd>
            </div>
          </dl>
          {product.short_description && (
            <div>
              <dt className="text-xs tracking-wide text-gray-500 uppercase">Descrição Curta</dt>
              <dd className="mt-1 text-sm text-gray-700">{product.short_description}</dd>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <p className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
              Classificação
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Tipo de produto — só para farmácias, não distribuidoras */}
              {!isDistributor && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    product.is_manipulated
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  {product.is_manipulated ? 'Produto manipulado' : 'Produto industrializado'}
                </span>
              )}

              {/* Receita médica */}
              {product.requires_prescription ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                  <FileText className="h-3.5 w-3.5" />
                  Exige receita
                  {product.prescription_type &&
                    PRESCRIPTION_TYPE_LABELS[product.prescription_type] &&
                    ` — ${PRESCRIPTION_TYPE_LABELS[product.prescription_type].label}`}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Sem receita obrigatória
                </span>
              )}

              {/* Detalhe do tipo de receita */}
              {product.requires_prescription &&
                product.prescription_type &&
                PRESCRIPTION_TYPE_LABELS[product.prescription_type] && (
                  <p className="w-full text-xs text-gray-400">
                    {PRESCRIPTION_TYPE_LABELS[product.prescription_type].detail}
                    {product.max_units_per_prescription != null &&
                      ` · ${product.max_units_per_prescription} unidade(s) por receita`}
                  </p>
                )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <h2 className="font-semibold text-gray-900">
              {isPharmacy ? 'Repasse & Status' : 'Preço & Status'}
            </h2>
            {/* Platform sees selling price; pharmacy sees only their repasse */}
            {!isPharmacy && (
              <div className="text-primary text-3xl font-bold">
                {formatCurrency(product.price_current)}
              </div>
            )}
            {isPharmacy && (
              <div>
                <p className="mb-1 text-xs tracking-wide text-gray-400 uppercase">Seu repasse</p>
                <div className="text-3xl font-bold text-gray-900">
                  {formatCurrency(product.pharmacy_cost ?? 0)}
                </div>
                <p className="mt-1 text-xs text-gray-400">por unidade vendida</p>
              </div>
            )}
            <div className="flex gap-2">
              <Badge
                className={
                  product.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }
              >
                {product.active ? 'Ativo' : 'Inativo'}
              </Badge>
              {product.featured && <Badge className="bg-amber-100 text-amber-800">Destaque</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <ToggleProductActive productId={id} active={product.active} />
              {isSuperAdmin && (
                <PriceUpdateForm productId={id} currentPrice={product.price_current} />
              )}
              {(isSuperAdmin || isPharmacy) && (
                <PharmacyCostUpdateForm productId={id} currentCost={product.pharmacy_cost ?? 0} />
              )}
            </div>
          </div>

          {!isPharmacy && (
            <MarginBreakdown
              price={product.price_current}
              cost={product.pharmacy_cost ?? 0}
              consultantRate={consultantRate}
            />
          )}

          <div className="flex min-h-[100px] flex-col items-center justify-center rounded-lg border bg-white p-6 text-gray-400">
            <Package className="mb-2 h-8 w-8" />
            <p className="text-sm">Sem imagens</p>
          </div>
        </div>
      </div>

      {!isPharmacy && priceHistory.length > 0 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Histórico de Preço</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">Data</th>
                  <th className="pb-3 font-medium">De</th>
                  <th className="pb-3 font-medium">Para</th>
                  <th className="pb-3 font-medium">Alterado por</th>
                  <th className="pb-3 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {priceHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-3 text-gray-500">{formatDate(entry.created_at)}</td>
                    <td className="py-3 text-gray-400 line-through">
                      {formatCurrency(entry.old_price)}
                    </td>
                    <td className="py-3 font-medium text-gray-900">
                      {formatCurrency(entry.new_price)}
                    </td>
                    <td className="py-3">{entry.profiles?.full_name ?? '—'}</td>
                    <td className="py-3 text-gray-600">{entry.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {costHistory.length > 0 && (
        <div className="space-y-4 rounded-lg border bg-white p-6">
          <h2 className="font-semibold text-gray-900">Histórico de Repasse à Farmácia</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">Data</th>
                  <th className="pb-3 font-medium">Valor anterior</th>
                  <th className="pb-3 font-medium">Novo valor</th>
                  <th className="pb-3 font-medium">Alterado por</th>
                  <th className="pb-3 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {costHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-3 text-gray-500">{formatDate(entry.created_at)}</td>
                    <td className="py-3 text-slate-500">{formatCurrency(entry.old_cost)}</td>
                    <td className="py-3 font-medium">{formatCurrency(entry.new_cost)}</td>
                    <td className="py-3">{entry.profiles?.full_name ?? '—'}</td>
                    <td className="py-3 text-gray-600">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
