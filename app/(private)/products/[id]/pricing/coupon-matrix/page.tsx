/**
 * /products/[id]/pricing/coupon-matrix — coupon impact matrix
 * (PR-C3 do ADR-001).
 *
 * Pergunta que esta página responde
 * ---------------------------------
 *   "Antes de eu (super-admin) atribuir um cupom de 30% para a clínica
 *    X em Tirzepatida 60mg, mostre exatamente quanto eu vou ganhar/
 *    perder em cada faixa de quantidade."
 *
 * Como funciona
 * -------------
 * Tudo na URL. Server Component que lê searchParams:
 *   buyer_kind=clinic|doctor   buyer_id=<uuid>
 *   max_qty=10
 *   hyp=PERCENT:30  hyp=FIXED:200   (até 4)
 *   coupon_id=<uuid>  coupon_id=<uuid>   (cupons existentes)
 *
 * Calcula via buildCouponImpactMatrix:
 *   • baseline (sem cupom)
 *   • cada cupom hipotético
 *   • cada cupom existente selecionado
 * Renderiza heatmap server-side. Filtros são client (vivem no querystring).
 *
 * Acesso: SUPER_ADMIN + PLATFORM_ADMIN.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRolePage } from '@/lib/rbac'
import { createAdminClient } from '@/lib/db/admin'
import { buildCouponImpactMatrix, type CouponVariant } from '@/lib/services/pricing-engine.server'
import { CouponImpactMatrix } from '@/components/pricing/coupon-impact-matrix'
import { CouponMatrixFilters } from '@/components/pricing/coupon-matrix-filters'
import type { PricingMode, Product } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Matriz de impacto de cupons | Clinipharma' }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readArray(v: string | string[] | undefined): string[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

type HypType = 'PERCENT' | 'FIXED' | 'FIRST_UNIT_DISCOUNT' | 'TIER_UPGRADE' | 'MIN_QTY_PERCENT'

const HYP_TYPES: HypType[] = [
  'PERCENT',
  'FIXED',
  'FIRST_UNIT_DISCOUNT',
  'TIER_UPGRADE',
  'MIN_QTY_PERCENT',
]

interface ParsedHyp {
  type: HypType
  value: number
  /** TIER_UPGRADE: tiers acima (1..10). */
  tierSteps?: number
  /** MIN_QTY_PERCENT: quantidade mínima (>= 2). */
  minQty?: number
}

function parseHyp(s: string): ParsedHyp | null {
  const parts = s.split(':')
  const type = parts[0]
  if (!type || !(HYP_TYPES as string[]).includes(type)) return null
  const t = type as HypType

  // Sintaxe URL: TIPO:VALOR[:EXTRA]. Parser idêntico ao do filtro UI
  // (lib/components/pricing/coupon-matrix-filters.tsx).
  const valueRaw = (parts[1] ?? '').replace(',', '.')
  const valueNum = Number(valueRaw)

  if (t === 'TIER_UPGRADE') {
    const steps = Number(parts[2] ?? '')
    if (!Number.isInteger(steps) || steps < 1 || steps > 10) return null
    // discountValue não é usado pela RPC em TIER_UPGRADE; passamos 0
    // por convenção (compute_unit_price ignora).
    return { type: t, value: 0, tierSteps: steps }
  }

  if (!Number.isFinite(valueNum) || valueNum <= 0) return null

  if (t === 'PERCENT' || t === 'MIN_QTY_PERCENT') {
    if (valueNum > 100) return null
  }

  if (t === 'MIN_QTY_PERCENT') {
    const minQty = Number(parts[2] ?? '')
    if (!Number.isInteger(minQty) || minQty < 2) return null
    return { type: t, value: valueNum, minQty }
  }

  return { type: t, value: valueNum }
}

function discountLabel(h: ParsedHyp): string {
  switch (h.type) {
    case 'PERCENT':
      return `${h.value}%`
    case 'FIXED':
      return `R$ ${h.value.toFixed(2).replace('.', ',')}/u`
    case 'FIRST_UNIT_DISCOUNT':
      return `R$ ${h.value.toFixed(2).replace('.', ',')} na 1ª`
    case 'TIER_UPGRADE':
      return `+${h.tierSteps ?? '?'} tier${(h.tierSteps ?? 0) > 1 ? 's' : ''}`
    case 'MIN_QTY_PERCENT':
      return `${h.value}% (qty≥${h.minQty ?? '?'})`
  }
}

/** Versão "leve" para cupons existentes que ainda não carregam os campos
 *  novos (PERCENT / FIXED legacy). */
function existingDiscountLabel(type: string, value: number): string {
  if (type === 'PERCENT') return `${value}%`
  if (type === 'FIRST_UNIT_DISCOUNT') return `R$ ${value.toFixed(2).replace('.', ',')} na 1ª`
  if (type === 'MIN_QTY_PERCENT') return `${value}%`
  if (type === 'TIER_UPGRADE') return `upgrade tier`
  return `R$ ${value.toFixed(2).replace('.', ',')}/u`
}

export default async function CouponMatrixPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const sp = await searchParams
  await requireRolePage(['SUPER_ADMIN', 'PLATFORM_ADMIN'])

  const admin = createAdminClient()
  const { data: productRaw } = await admin
    .from('products')
    .select('id, name, sku, pricing_mode')
    .eq('id', id)
    .single()
  if (!productRaw) notFound()
  const product = productRaw as unknown as Pick<Product, 'id' | 'name' | 'sku'> & {
    pricing_mode: PricingMode
  }

  // ── Resolve filtros vindos da URL ─────────────────────────────────
  const buyerKind = (Array.isArray(sp.buyer_kind) ? sp.buyer_kind[0] : sp.buyer_kind) as
    | 'clinic'
    | 'doctor'
    | undefined
  const buyerIdRaw = Array.isArray(sp.buyer_id) ? sp.buyer_id[0] : sp.buyer_id
  const buyerId = buyerIdRaw && buyerIdRaw.length > 0 ? buyerIdRaw : null

  const maxQtyRaw = Array.isArray(sp.max_qty) ? sp.max_qty[0] : sp.max_qty
  const maxQty = (() => {
    const n = Number(maxQtyRaw)
    if (!Number.isFinite(n) || n <= 0) return 10
    return Math.min(20, Math.max(1, Math.floor(n)))
  })()
  const quantities = Array.from({ length: maxQty }, (_, i) => i + 1)

  const hypsRaw = readArray(sp.hyp)
  const hyps = hypsRaw.map(parseHyp).filter((h): h is NonNullable<typeof h> => h !== null)

  const existingCouponIds = readArray(sp.coupon_id)

  // ── Listas para os filtros ────────────────────────────────────────
  const [clinicsRes, doctorsRes, allCouponsRes] = await Promise.all([
    admin.from('clinics').select('id, trade_name').order('trade_name'),
    admin.from('doctors').select('id, full_name').order('full_name'),
    admin
      .from('coupons')
      .select('id, code, clinic_id, doctor_id, discount_type, discount_value, active')
      .eq('product_id', id)
      .eq('active', true),
  ])

  const clinics = ((clinicsRes.data as Array<{ id: string; trade_name: string }>) ?? []).map(
    (c) => ({ id: c.id, label: c.trade_name })
  )
  const doctors = ((doctorsRes.data as Array<{ id: string; full_name: string }>) ?? []).map(
    (d) => ({ id: d.id, label: d.full_name })
  )

  const clinicMap = new Map(clinics.map((c) => [c.id, c.label]))
  const doctorMap = new Map(doctors.map((d) => [d.id, d.label]))

  const existingCoupons = (
    (allCouponsRes.data as Array<{
      id: string
      code: string
      clinic_id: string | null
      doctor_id: string | null
      discount_type: string
      discount_value: number
    }>) ?? []
  ).map((c) => ({
    id: c.id,
    code: c.code,
    buyer_label: c.clinic_id
      ? (clinicMap.get(c.clinic_id) ?? '(clínica)')
      : (doctorMap.get(c.doctor_id ?? '') ?? '(médico)'),
    discount_label: existingDiscountLabel(c.discount_type, c.discount_value),
    discount_type: c.discount_type,
    discount_value: c.discount_value,
  }))

  // ── Monta variantes para a matriz ────────────────────────────────
  const variants: CouponVariant[] = [{ kind: 'no_coupon', label: 'Sem cupom (baseline)' }]
  for (const h of hyps) {
    variants.push({
      kind: 'hypothetical',
      label: `Hipotético ${discountLabel(h)}`,
      discountType: h.type,
      discountValue: h.value,
      tierPromotionSteps: h.tierSteps,
      minQuantity: h.minQty,
    })
  }
  for (const cid of existingCouponIds) {
    const c = existingCoupons.find((x) => x.id === cid)
    if (!c) continue
    variants.push({
      kind: 'existing',
      label: `${c.code} (${c.discount_label}) · ${c.buyer_label}`,
      couponId: c.id,
    })
  }

  const variantHeader = variants.map((v, idx) => ({ idx, label: v.label }))

  // ── Calcula a matriz se for TIERED_PROFILE ───────────────────────
  const isTiered = product.pricing_mode === 'TIERED_PROFILE'
  const cells = isTiered
    ? await buildCouponImpactMatrix({
        productId: id,
        quantities,
        variants,
        clinicId: buyerKind === 'clinic' ? buyerId : null,
        doctorId: buyerKind === 'doctor' ? buyerId : null,
      })
    : []

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/products" className="hover:text-primary">
            Produtos
          </Link>
          <span>/</span>
          <Link href={`/products/${id}`} className="hover:text-primary">
            {product.name}
          </Link>
          <span>/</span>
          <Link href={`/products/${id}/pricing`} className="hover:text-primary">
            Pricing
          </Link>
          <span>/</span>
          <span>Matriz de impacto</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Matriz de impacto de cupons</h1>
        <p className="text-sm text-gray-500">
          Visualize a projeção financeira para cada combinação de quantidade × cupom antes de
          atribuir.
        </p>
      </div>

      {!isTiered && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Este produto está em modo <strong>preço fixo</strong>. A matriz de impacto só faz sentido
          para produtos com tiers cadastrados. Cadastre um pricing profile e mude o modo em{' '}
          <Link href={`/products/${id}/pricing`} className="underline">
            Pricing avançado
          </Link>{' '}
          para usar esta visualização.
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-medium text-slate-700">Tipos de cupom suportados</p>
        <p className="mt-1">
          A matriz simula os <strong>5 tipos</strong> que a plataforma cria em{' '}
          <Link href="/coupons" className="underline">
            /coupons
          </Link>
          : <strong>percentual</strong>, <strong>fixo por unidade</strong>,{' '}
          <strong>desconto só na 1ª unidade</strong>, <strong>upgrade de tier</strong> (paga preço
          do tier N posições acima) e <strong>% condicionado a quantidade mínima</strong>. Os caps
          INV-2 (cupom não pode levar abaixo do piso) e INV-4 (consultor ≤ comissão da plataforma)
          são aplicados em todos eles, então o que você vê aqui é o que será cobrado/repassado.
        </p>
      </div>

      <CouponMatrixFilters
        productId={id}
        clinics={clinics}
        doctors={doctors}
        existingCoupons={existingCoupons}
      />

      {isTiered && variants.length === 1 && (
        <div className="rounded-md border bg-slate-50 p-4 text-sm text-slate-600">
          Adicione pelo menos um cupom hipotético OU selecione um cupom existente acima para começar
          a comparação.
        </div>
      )}

      {isTiered && variants.length > 1 && (
        <CouponImpactMatrix cells={cells} variants={variantHeader} quantities={quantities} />
      )}
    </div>
  )
}
