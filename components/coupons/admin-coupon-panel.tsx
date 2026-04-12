'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Tag, CheckCircle2, Clock, XCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { CouponRow } from '@/services/coupons'

type AdminCoupon = CouponRow & { product_name: string; clinic_name: string }

interface Props {
  coupons: AdminCoupon[]
}

function CouponStatus({
  active,
  activated_at,
  valid_until,
}: {
  active: boolean
  activated_at: string | null
  valid_until: string | null
}) {
  if (!active)
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
        <XCircle className="h-3.5 w-3.5" /> Cancelado
      </span>
    )
  if (!activated_at)
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600">
        <Clock className="h-3.5 w-3.5" /> Aguardando ativação
      </span>
    )
  if (valid_until && new Date(valid_until) < new Date())
    return (
      <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
        <AlertCircle className="h-3.5 w-3.5" /> Expirado
      </span>
    )
  return (
    <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
    </span>
  )
}

export function AdminCouponPanel({ coupons }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    product_id: '',
    clinic_id: '',
    discount_type: 'PERCENT' as 'PERCENT' | 'FIXED',
    discount_value: '',
    max_discount_amount: '',
    valid_until: '',
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const payload = {
        product_id: form.product_id,
        clinic_id: form.clinic_id,
        discount_type: form.discount_type,
        discount_value: parseFloat(form.discount_value),
        max_discount_amount: form.max_discount_amount
          ? parseFloat(form.max_discount_amount)
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
        setForm({
          product_id: '',
          clinic_id: '',
          discount_type: 'PERCENT',
          discount_value: '',
          max_discount_amount: '',
          valid_until: '',
        })
        router.refresh()
      }
    } catch {
      setFormError('Erro de conexão')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Desativar este cupom? A clínica não receberá mais o desconto em novos pedidos.'))
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

  return (
    <div className="space-y-4">
      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Novo cupom
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Criar cupom</h2>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                ID do produto *
              </label>
              <input
                required
                value={form.product_id}
                onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}
                placeholder="UUID do produto"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                ID da clínica *
              </label>
              <input
                required
                value={form.clinic_id}
                onChange={(e) => setForm((f) => ({ ...f, clinic_id: e.target.value }))}
                placeholder="UUID da clínica"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Tipo *</label>
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, discount_type: e.target.value as 'PERCENT' | 'FIXED' }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              >
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Fixo (R$)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {form.discount_type === 'PERCENT' ? 'Percentual (ex: 10)' : 'Valor fixo (R$)'} *
              </label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                max={form.discount_type === 'PERCENT' ? '100' : undefined}
                value={form.discount_value}
                onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>
            {form.discount_type === 'PERCENT' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Teto de desconto em R$ (opcional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.max_discount_amount}
                  onChange={(e) => setForm((f) => ({ ...f, max_discount_amount: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Válido até (opcional)
              </label>
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
              />
            </div>
            {formError && <p className="col-span-2 text-xs text-red-600">{formError}</p>}
            <div className="col-span-2 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar e notificar clínica
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Coupons table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {!coupons.length ? (
          <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
            <Tag className="h-10 w-10" />
            <p className="text-sm">Nenhum cupom criado ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Código
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Produto
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Clínica
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Desconto
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Validade
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {coupons.map((c) => {
                  const discountLabel =
                    c.discount_type === 'PERCENT'
                      ? `${Number(c.discount_value).toFixed(0)}%`
                      : formatCurrency(Number(c.discount_value))
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.code}</td>
                      <td className="px-4 py-3 text-gray-900">{c.product_name}</td>
                      <td className="px-4 py-3 text-gray-700">{c.clinic_name}</td>
                      <td className="px-4 py-3 font-semibold text-indigo-600">
                        {discountLabel}
                        {c.discount_type === 'PERCENT' && c.max_discount_amount
                          ? ` (teto ${formatCurrency(Number(c.max_discount_amount))})`
                          : ''}{' '}
                        / un
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {c.valid_until ? formatDate(c.valid_until) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <CouponStatus
                          active={c.active}
                          activated_at={c.activated_at}
                          valid_until={c.valid_until}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {c.active && (
                          <button
                            onClick={() => handleDeactivate(c.id)}
                            disabled={deactivating === c.id}
                            title="Desativar cupom"
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
      </div>
    </div>
  )
}
