'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Tag,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Loader2,
  Trash2,
  ShoppingBag,
  AlertTriangle,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import type { CouponRow } from '@/services/coupons'
import { SearchableSelect, type SelectOption } from './searchable-select'

type AdminCoupon = CouponRow & { product_name: string; recipient_name: string }

type StatusFilter = 'all' | 'active' | 'pending' | 'expired' | 'inactive'
type RecipientType = 'clinic' | 'doctor'

// ADR-002 — 5 tipos. Mantemos `PERCENT` e `FIXED` como primeiros para
// preservar a UX legacy; os 3 novos seguem com nomenclatura coerente
// com o discount_type no banco (mig-079) e com o serializador da matriz
// (`coupon-matrix-filters.tsx`).
type DiscountType = 'PERCENT' | 'FIXED' | 'FIRST_UNIT_DISCOUNT' | 'TIER_UPGRADE' | 'MIN_QTY_PERCENT'

const DISCOUNT_TYPE_LABEL: Record<DiscountType, string> = {
  PERCENT: 'Percentual (%)',
  FIXED: 'Fixo (R$)',
  FIRST_UNIT_DISCOUNT: 'Fixo só na 1ª unidade (R$)',
  TIER_UPGRADE: 'Upgrade de tier',
  MIN_QTY_PERCENT: '% se atingir qty mínima',
}

const DISCOUNT_TYPE_HINT: Record<DiscountType, string> = {
  PERCENT: 'Aplica em toda unidade do pedido.',
  FIXED: 'Vale R$ fixos por unidade vendida.',
  FIRST_UNIT_DISCOUNT:
    'Aplica apenas quando o pedido tem 1 unidade. Em pedidos maiores, o cupom não casa (sem desconto).',
  TIER_UPGRADE:
    'Promove o cliente para o preço do tier N posições acima na escala. Saturação no tier mais barato disponível.',
  MIN_QTY_PERCENT:
    'Percentual aplicado por unidade, mas só vale se o pedido tiver pelo menos a quantidade mínima informada.',
}

const PAGE_SIZE = 20

interface Props {
  coupons: AdminCoupon[]
  products: SelectOption[]
  clinics: SelectOption[]
  doctors: SelectOption[]
}

function resolveCouponStatus(c: {
  active: boolean
  activated_at: string | null
  valid_until: string | null
}): StatusFilter {
  if (!c.active) return 'inactive'
  if (!c.activated_at) return 'pending'
  if (c.valid_until && new Date(c.valid_until) < new Date()) return 'expired'
  return 'active'
}

function StatusBadge({ coupon }: { coupon: AdminCoupon }) {
  const status = resolveCouponStatus(coupon)
  const expiringSoon =
    status === 'active' &&
    coupon.valid_until &&
    new Date(coupon.valid_until) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  if (status === 'inactive')
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
        <XCircle className="h-3.5 w-3.5" /> Cancelado
      </span>
    )
  if (status === 'pending')
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600">
        <Clock className="h-3.5 w-3.5" /> Aguardando ativação
      </span>
    )
  if (status === 'expired')
    return (
      <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
        <AlertCircle className="h-3.5 w-3.5" /> Expirado
      </span>
    )
  if (expiringSoon)
    return (
      <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-600">
        <AlertTriangle className="h-3.5 w-3.5" /> Expira em breve
      </span>
    )
  return (
    <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
    </span>
  )
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Todos',
  active: 'Ativos',
  pending: 'Aguardando ativação',
  expired: 'Expirados',
  inactive: 'Cancelados',
}

export function AdminCouponPanel({ coupons, products, clinics, doctors }: Props) {
  const router = useRouter()

  // ── list state ────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // ── create form state ─────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [recipientType, setRecipientType] = useState<RecipientType>('clinic')
  const [form, setForm] = useState({
    product_id: '',
    clinic_id: '',
    doctor_id: '',
    discount_type: 'PERCENT' as DiscountType,
    discount_value: '',
    max_discount_amount: '',
    /** ADR-002: gate uniforme de quantidade. Default vazio = sem gate (1). */
    min_quantity: '',
    /** ADR-002: TIER_UPGRADE — quantos tiers acima promover (1..10). */
    tier_promotion_steps: '',
    valid_until: '',
  })

  function resetForm() {
    setForm({
      product_id: '',
      clinic_id: '',
      doctor_id: '',
      discount_type: 'PERCENT',
      discount_value: '',
      max_discount_amount: '',
      min_quantity: '',
      tier_promotion_steps: '',
      valid_until: '',
    })
  }

  // ── deactivate state ──────────────────────────────────────────────────────
  const [deactivating, setDeactivating] = useState<string | null>(null)

  // ── derived list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = coupons
    if (statusFilter !== 'all') {
      list = list.filter((c) => resolveCouponStatus(c) === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.recipient_name.toLowerCase().includes(q) ||
          c.product_name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q)
      )
    }
    return list
  }, [coupons, statusFilter, search])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function resetPage() {
    setPage(1)
  }

  // ── status tab counts ──────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const map: Record<StatusFilter, number> = {
      all: coupons.length,
      active: 0,
      pending: 0,
      expired: 0,
      inactive: 0,
    }
    for (const c of coupons) map[resolveCouponStatus(c)]++
    return map
  }, [coupons])

  // ── create coupon ─────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.product_id) return setFormError('Selecione um produto')
    if (recipientType === 'clinic' && !form.clinic_id) return setFormError('Selecione uma clínica')
    if (recipientType === 'doctor' && !form.doctor_id) return setFormError('Selecione um médico')

    // ADR-002 — validações específicas por tipo (espelham as do
    // services/coupons.ts e do CHECK no banco). Falhamos cedo na UI
    // para mensagem clara.
    const dt = form.discount_type
    if (dt === 'TIER_UPGRADE') {
      const steps = parseInt(form.tier_promotion_steps, 10)
      if (!Number.isInteger(steps) || steps < 1 || steps > 10) {
        return setFormError('Upgrade de tier exige número de tiers entre 1 e 10.')
      }
    } else if (dt === 'MIN_QTY_PERCENT') {
      const minQ = parseInt(form.min_quantity, 10)
      if (!Number.isInteger(minQ) || minQ < 2) {
        return setFormError('% condicional exige quantidade mínima >= 2.')
      }
      const v = parseFloat(form.discount_value)
      if (!Number.isFinite(v) || v <= 0 || v > 100) {
        return setFormError('Percentual deve estar entre 0 e 100.')
      }
    } else if (dt === 'PERCENT') {
      const v = parseFloat(form.discount_value)
      if (!Number.isFinite(v) || v <= 0 || v > 100) {
        return setFormError('Percentual deve estar entre 0 e 100.')
      }
    } else if (dt === 'FIXED' || dt === 'FIRST_UNIT_DISCOUNT') {
      const v = parseFloat(form.discount_value)
      if (!Number.isFinite(v) || v <= 0) {
        return setFormError('Valor deve ser maior que zero.')
      }
    }

    setSubmitting(true)
    setFormError(null)

    try {
      // TIER_UPGRADE não usa discount_value — passamos 0 (Zod permite).
      const discountValue = dt === 'TIER_UPGRADE' ? 0 : parseFloat(form.discount_value || '0')

      const payload = {
        product_id: form.product_id,
        clinic_id: recipientType === 'clinic' ? form.clinic_id : null,
        doctor_id: recipientType === 'doctor' ? form.doctor_id : null,
        discount_type: form.discount_type,
        discount_value: discountValue,
        max_discount_amount:
          dt === 'PERCENT' && form.max_discount_amount
            ? parseFloat(form.max_discount_amount)
            : undefined,
        min_quantity:
          dt === 'MIN_QTY_PERCENT' && form.min_quantity
            ? parseInt(form.min_quantity, 10)
            : undefined,
        tier_promotion_steps:
          dt === 'TIER_UPGRADE' && form.tier_promotion_steps
            ? parseInt(form.tier_promotion_steps, 10)
            : undefined,
        valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
      }
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error ?? 'Erro ao criar cupom')
      } else {
        setShowForm(false)
        resetForm()
        router.refresh()
      }
    } catch {
      setFormError('Erro de conexão')
    } finally {
      setSubmitting(false)
    }
  }

  // ── deactivate ────────────────────────────────────────────────────────────
  async function handleDeactivate(id: string, code: string) {
    if (
      !confirm(`Desativar o cupom ${code}?\n\nO desconto não será mais aplicado em novos pedidos.`)
    )
      return
    setDeactivating(id)
    try {
      const res = await fetch(`/api/admin/coupons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' }),
      })
      if (res.ok) router.refresh()
    } finally {
      setDeactivating(null)
    }
  }

  // ── summary stats ─────────────────────────────────────────────────────────
  const totalUses = coupons.reduce((s, c) => s + c.used_count, 0)

  return (
    <div className="space-y-5">
      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Cupons ativos', value: counts.active, color: 'text-green-700' },
          { label: 'Aguardando ativação', value: counts.pending, color: 'text-amber-600' },
          { label: 'Total de usos', value: totalUses, color: 'text-indigo-600' },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
          >
            <p className="text-xs text-gray-500">{label}</p>
            <p className={cn('mt-1 text-2xl font-bold', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Header actions ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            resetPage()
          }}
          placeholder="Buscar por clínica, produto ou código..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none sm:max-w-xs"
        />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Novo cupom
        </button>
      </div>

      {/* ── Create form ── */}
      {showForm && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-6 shadow-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-900">Criar novo cupom</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            {/* Produto */}
            <div>
              <Label className="mb-1.5 block text-xs text-gray-700">
                Produto <span className="text-red-500">*</span>
              </Label>
              <SearchableSelect
                options={products}
                value={form.product_id}
                onChange={(id) => setForm((f) => ({ ...f, product_id: id }))}
                placeholder="Selecionar produto..."
              />
            </div>

            {/* Destinatário — Clínica ou Médico */}
            <div className="space-y-2">
              <Label className="block text-xs text-gray-700">
                Destinatário <span className="text-red-500">*</span>
              </Label>
              <div className="flex overflow-hidden rounded-lg border border-gray-300">
                {(['clinic', 'doctor'] as RecipientType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRecipientType(t)}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium transition-colors',
                      recipientType === t
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {t === 'clinic' ? 'Clínica' : 'Médico (CPF)'}
                  </button>
                ))}
              </div>
              {recipientType === 'clinic' ? (
                <SearchableSelect
                  options={clinics}
                  value={form.clinic_id}
                  onChange={(id) => setForm((f) => ({ ...f, clinic_id: id }))}
                  placeholder="Selecionar clínica..."
                />
              ) : (
                <SearchableSelect
                  options={doctors}
                  value={form.doctor_id}
                  onChange={(id) => setForm((f) => ({ ...f, doctor_id: id }))}
                  placeholder="Selecionar médico..."
                />
              )}
            </div>

            {/* Tipo de desconto — vira select para caber 5 opções */}
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-xs text-gray-700" htmlFor="coupon_discount_type">
                Tipo de desconto <span className="text-red-500">*</span>
              </Label>
              <select
                id="coupon_discount_type"
                value={form.discount_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    discount_type: e.target.value as DiscountType,
                    // Reset campos específicos ao trocar o tipo, evitando
                    // payload inconsistente.
                    discount_value: '',
                    max_discount_amount: '',
                    min_quantity: '',
                    tier_promotion_steps: '',
                  }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              >
                {(Object.keys(DISCOUNT_TYPE_LABEL) as DiscountType[]).map((t) => (
                  <option key={t} value={t}>
                    {DISCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{DISCOUNT_TYPE_HINT[form.discount_type]}</p>
            </div>

            {/* Valor do desconto — escondido para TIER_UPGRADE (que usa só steps) */}
            {form.discount_type !== 'TIER_UPGRADE' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">
                  {form.discount_type === 'PERCENT' || form.discount_type === 'MIN_QTY_PERCENT'
                    ? 'Percentual por unidade'
                    : form.discount_type === 'FIRST_UNIT_DISCOUNT'
                      ? 'Desconto na 1ª unidade (R$)'
                      : 'Valor fixo por unidade (R$)'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">
                    {form.discount_type === 'PERCENT' || form.discount_type === 'MIN_QTY_PERCENT'
                      ? '%'
                      : 'R$'}
                  </span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={
                      form.discount_type === 'PERCENT' || form.discount_type === 'MIN_QTY_PERCENT'
                        ? '100'
                        : undefined
                    }
                    value={form.discount_value}
                    onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-8 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                    placeholder={
                      form.discount_type === 'PERCENT' || form.discount_type === 'MIN_QTY_PERCENT'
                        ? '10'
                        : '50.00'
                    }
                  />
                </div>
              </div>
            )}

            {/* TIER_UPGRADE: número de tiers a promover */}
            {form.discount_type === 'TIER_UPGRADE' && (
              <div>
                <Label className="mb-1.5 block text-xs text-gray-700" htmlFor="tier_steps">
                  Tiers a promover <span className="text-red-500">*</span>
                </Label>
                <input
                  id="tier_steps"
                  required
                  type="number"
                  step="1"
                  min="1"
                  max="10"
                  value={form.tier_promotion_steps}
                  onChange={(e) => setForm((f) => ({ ...f, tier_promotion_steps: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                  placeholder="Ex: 2"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Quantidades acima do último tier saturam no preço mais barato disponível.
                </p>
              </div>
            )}

            {/* MIN_QTY_PERCENT: quantidade mínima */}
            {form.discount_type === 'MIN_QTY_PERCENT' && (
              <div>
                <Label className="mb-1.5 block text-xs text-gray-700" htmlFor="min_quantity">
                  Quantidade mínima do pedido <span className="text-red-500">*</span>
                </Label>
                <input
                  id="min_quantity"
                  required
                  type="number"
                  step="1"
                  min="2"
                  value={form.min_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, min_quantity: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                  placeholder="Ex: 3"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Pedidos abaixo dessa quantidade não recebem desconto.
                </p>
              </div>
            )}

            {/* Teto — só para PERCENT (legacy). MIN_QTY_PERCENT poderia
                ter o mesmo teto, mas mantemos comportamento conservador
                até o operador pedir. */}
            {form.discount_type === 'PERCENT' && (
              <div>
                <Label className="mb-1.5 block text-xs text-gray-700">
                  Teto máximo de desconto em R$ <span className="text-gray-400">(opcional)</span>
                </Label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.max_discount_amount}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, max_discount_amount: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-8 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                    placeholder="Ex: 200.00"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Limita o desconto em pedidos com muitas unidades
                </p>
              </div>
            )}

            {/* Validade */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                Válido até{' '}
                <span className="text-gray-400">(opcional — sem data = sem vencimento)</span>
              </label>
              <input
                type="date"
                value={form.valid_until}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>

            {formError && (
              <p className="col-span-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </p>
            )}

            <div className="col-span-2 flex justify-end gap-3 border-t border-indigo-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setFormError(null)
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar e notificar destinatário
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Status tabs ── */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s)
              resetPage()
            }}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              statusFilter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {STATUS_LABELS[s]}
            {counts[s] > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-xs',
                  statusFilter === s ? 'bg-indigo-500' : 'bg-gray-200'
                )}
              >
                {counts[s]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {!paginated.length ? (
          <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
            <Tag className="h-10 w-10" />
            <p className="text-sm">
              {search || statusFilter !== 'all'
                ? 'Nenhum cupom corresponde ao filtro.'
                : 'Nenhum cupom criado ainda.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {[
                    'Código',
                    'Produto',
                    'Destinatário',
                    'Desconto',
                    'Usos',
                    'Válido até',
                    'Status',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map((c) => {
                  // ADR-002 — rótulo cobre os 5 tipos. Mantemos curto
                  // para caber em uma célula da tabela; o detalhe completo
                  // (steps, qty mínima) sai como sublinha.
                  const v = Number(c.discount_value)
                  const discountLabel = (() => {
                    switch (c.discount_type as DiscountType) {
                      case 'PERCENT':
                        return `${v.toFixed(0)}% / un`
                      case 'FIXED':
                        return `${formatCurrency(v)} / un`
                      case 'FIRST_UNIT_DISCOUNT':
                        return `${formatCurrency(v)} na 1ª`
                      case 'TIER_UPGRADE':
                        return `+${c.tier_promotion_steps ?? 0} tier(s)`
                      case 'MIN_QTY_PERCENT':
                        return `${v.toFixed(0)}% (mín ${c.min_quantity ?? 2}u)`
                    }
                  })()
                  const capLabel =
                    c.discount_type === 'PERCENT' && c.max_discount_amount
                      ? ` (teto ${formatCurrency(Number(c.max_discount_amount))})`
                      : ''
                  const isActive =
                    resolveCouponStatus(c) === 'active' || resolveCouponStatus(c) === 'pending'

                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs tracking-wider text-gray-700">
                        {c.code}
                      </td>
                      <td className="max-w-[180px] px-4 py-3">
                        <p className="truncate font-medium text-gray-900">{c.product_name}</p>
                      </td>
                      <td className="max-w-[180px] px-4 py-3">
                        <p className="truncate text-gray-700">{c.recipient_name}</p>
                        {c.doctor_id && <p className="text-[10px] text-gray-400">Médico</p>}
                      </td>
                      <td className="px-4 py-3 font-semibold whitespace-nowrap text-indigo-600">
                        {discountLabel}
                        {capLabel}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                            c.used_count > 0
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-gray-100 text-gray-400'
                          )}
                        >
                          <ShoppingBag className="h-3 w-3" />
                          {c.used_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {c.valid_until ? formatDate(c.valid_until) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge coupon={c} />
                      </td>
                      <td className="px-4 py-3">
                        {isActive && (
                          <button
                            onClick={() => handleDeactivate(c.id, c.code)}
                            disabled={deactivating === c.id}
                            title="Cancelar cupom"
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            {deactivating === c.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">
              {filtered.length} resultado(s) · página {page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
