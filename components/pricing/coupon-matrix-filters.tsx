'use client'

/**
 * Filtros do super-admin para a coupon impact matrix.
 *
 * Estado vive na URL — todos os parâmetros são query-string. Isto é
 * intencional:
 *   1. Bookmarkable: o operador pode salvar/compartilhar uma combo
 *      "produto X, clínica Y, cupom 30% PCT".
 *   2. Server-rendered: a matriz é calculada server-side via RPC; a
 *      página é um Server Component que lê searchParams. Mudar
 *      filtros = navegar para nova URL = re-render server-side.
 *
 * Suporta múltiplos cupons hipotéticos via parametros repetidos `hyp`.
 * Formato URL (5 tipos, ADR-002):
 *
 *   PERCENT:30                         → percentual (legacy)
 *   FIXED:200                          → R$ por unidade (legacy)
 *   FIRST_UNIT_DISCOUNT:100            → R$ off, só na 1ª unidade
 *   TIER_UPGRADE::3                    → promove 3 tiers (value vazio, steps=3)
 *   MIN_QTY_PERCENT:10:5               → 10% se qty >= 5
 *
 * Sintaxe: `TYPE:VALUE[:EXTRA]` onde EXTRA é
 *   - `tierPromotionSteps` para TIER_UPGRADE (e VALUE vazio)
 *   - `minQuantity` para MIN_QTY_PERCENT
 *
 * UI permite até 4 variantes hipotéticas para a matriz não estourar
 * 8 colunas.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface BuyerOption {
  id: string
  label: string
}

interface ExistingCouponOption {
  id: string
  code: string
  buyer_label: string
  discount_label: string
}

interface Props {
  productId: string
  clinics: BuyerOption[]
  doctors: BuyerOption[]
  existingCoupons: ExistingCouponOption[]
}

type HypType = 'PERCENT' | 'FIXED' | 'FIRST_UNIT_DISCOUNT' | 'TIER_UPGRADE' | 'MIN_QTY_PERCENT'

const HYP_TYPES: HypType[] = [
  'PERCENT',
  'FIXED',
  'FIRST_UNIT_DISCOUNT',
  'TIER_UPGRADE',
  'MIN_QTY_PERCENT',
]

const HYP_LABEL: Record<HypType, string> = {
  PERCENT: 'Percentual',
  FIXED: 'Valor fixo',
  FIRST_UNIT_DISCOUNT: '1ª unidade',
  TIER_UPGRADE: 'Upgrade de tier',
  MIN_QTY_PERCENT: '% se qty mín',
}

interface HypotheticalDraft {
  uid: string
  type: HypType
  /** Valor principal — % para PERCENT/MIN_QTY_PERCENT, R$ para FIXED/FIRST_UNIT, ignorado para TIER_UPGRADE. */
  value: string
  /** TIER_UPGRADE: quantos tiers promover (1..10). */
  tierSteps: string
  /** MIN_QTY_PERCENT: quantidade mínima para o cupom valer (>= 2). */
  minQty: string
}

let _hypUidCounter = 0
function hypUid(): string {
  _hypUidCounter += 1
  return `hyp-${_hypUidCounter}-${Date.now()}`
}

function isHypType(s: string): s is HypType {
  return (HYP_TYPES as string[]).includes(s)
}

function parseHypsFromQuery(qs: URLSearchParams): HypotheticalDraft[] {
  const hyps = qs.getAll('hyp')
  return hyps
    .map((h) => {
      const parts = h.split(':')
      const type = parts[0]
      if (!type || !isHypType(type)) return null
      // Cada tipo tem seu próprio formato; defaults preservam o slot
      // mesmo se o operador editar manualmente a URL.
      return {
        uid: hypUid(),
        type,
        value: parts[1] ?? '',
        tierSteps: type === 'TIER_UPGRADE' ? (parts[2] ?? '') : '',
        minQty: type === 'MIN_QTY_PERCENT' ? (parts[2] ?? '') : '',
      }
    })
    .filter((h): h is HypotheticalDraft => h !== null)
}

export function CouponMatrixFilters({ productId, clinics, doctors, existingCoupons }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [buyerKind, setBuyerKind] = useState<'clinic' | 'doctor' | 'none'>(
    (sp.get('buyer_kind') as 'clinic' | 'doctor') ?? 'none'
  )
  const [buyerId, setBuyerId] = useState<string>(sp.get('buyer_id') ?? '')
  const [maxQty, setMaxQty] = useState<string>(sp.get('max_qty') ?? '10')

  const initialHyps = parseHypsFromQuery(new URLSearchParams(sp.toString()))
  const [hyps, setHyps] = useState<HypotheticalDraft[]>(
    initialHyps.length > 0
      ? initialHyps
      : [{ uid: hypUid(), type: 'PERCENT', value: '30', tierSteps: '', minQty: '' }]
  )

  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>(sp.getAll('coupon_id'))

  function serializeHyp(h: HypotheticalDraft): string | null {
    const value = h.value.trim().replace(',', '.')
    switch (h.type) {
      case 'PERCENT':
      case 'FIXED':
      case 'FIRST_UNIT_DISCOUNT':
        return value ? `${h.type}:${value}` : null
      case 'TIER_UPGRADE': {
        const steps = h.tierSteps.trim()
        if (!steps) return null
        // Mantemos o `value` vazio no slot 1 para preservar a sintaxe
        // posicional `TIPO:VALOR:EXTRA` — assim o parser não muda.
        return `TIER_UPGRADE::${steps}`
      }
      case 'MIN_QTY_PERCENT': {
        const minQty = h.minQty.trim()
        if (!value || !minQty) return null
        return `MIN_QTY_PERCENT:${value}:${minQty}`
      }
      default:
        return null
    }
  }

  function applyFilters() {
    const params = new URLSearchParams()
    if (buyerKind !== 'none' && buyerId) {
      params.set('buyer_kind', buyerKind)
      params.set('buyer_id', buyerId)
    }
    params.set('max_qty', maxQty)
    for (const h of hyps) {
      const serialized = serializeHyp(h)
      if (serialized) params.append('hyp', serialized)
    }
    for (const id of selectedExistingIds) {
      params.append('coupon_id', id)
    }
    startTransition(() => {
      router.push(`/products/${productId}/pricing/coupon-matrix?${params.toString()}`)
    })
  }

  function addHyp() {
    if (hyps.length >= 4) return
    setHyps((prev) => [
      ...prev,
      { uid: hypUid(), type: 'PERCENT', value: '', tierSteps: '', minQty: '' },
    ])
  }

  function removeHyp(uid: string) {
    setHyps((prev) => prev.filter((h) => h.uid !== uid))
  }

  function patchHyp(uid: string, patch: Partial<HypotheticalDraft>) {
    setHyps((prev) => prev.map((h) => (h.uid === uid ? { ...h, ...patch } : h)))
  }

  function toggleExisting(id: string) {
    setSelectedExistingIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        applyFilters()
      }}
      className="space-y-4 rounded-lg border bg-white p-6"
    >
      <h3 className="text-sm font-semibold text-slate-800">Configurar simulação</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Buyer (cliente)</Label>
          <RadioGroup
            value={buyerKind}
            onValueChange={(v) => {
              setBuyerKind(v as 'clinic' | 'doctor' | 'none')
              setBuyerId('')
            }}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="bk_none" />
              <Label htmlFor="bk_none" className="cursor-pointer">
                Genérico (sem buyer)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="clinic" id="bk_clinic" />
              <Label htmlFor="bk_clinic" className="cursor-pointer">
                Clínica
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="doctor" id="bk_doctor" />
              <Label htmlFor="bk_doctor" className="cursor-pointer">
                Médico
              </Label>
            </div>
          </RadioGroup>
          {buyerKind !== 'none' && (
            <Select value={buyerId} onValueChange={(v) => setBuyerId(v ?? '')}>
              <SelectTrigger>
                <SelectValue
                  placeholder={`Selecione ${buyerKind === 'clinic' ? 'a clínica' : 'o médico'}`}
                />
              </SelectTrigger>
              <SelectContent>
                {(buyerKind === 'clinic' ? clinics : doctors).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-slate-500">
            Define overrides de piso e qual cupom existente é considerado &ldquo;vigente&rdquo; para
            esse buyer.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max_qty">Quantidade máxima na matriz</Label>
          <Input
            id="max_qty"
            type="number"
            min="1"
            max="20"
            step="1"
            value={maxQty}
            onChange={(e) => setMaxQty(e.target.value)}
          />
          <p className="text-xs text-slate-500">Linhas: 1 → maxQty. Valores típicos: 5–10.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Cupons hipotéticos a comparar (até 4)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addHyp}
            disabled={hyps.length >= 4}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
        {hyps.map((h) => {
          const isPercent = h.type === 'PERCENT' || h.type === 'MIN_QTY_PERCENT'
          const isFixedish = h.type === 'FIXED' || h.type === 'FIRST_UNIT_DISCOUNT'
          const isTierUpgrade = h.type === 'TIER_UPGRADE'
          return (
            <div key={h.uid} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Select
                value={h.type}
                onValueChange={(v) => {
                  const next = (isHypType(v ?? '') ? (v as HypType) : 'PERCENT') as HypType
                  // Trocar de tipo limpa os campos extras dos tipos
                  // antigos para evitar URLs inconsistentes (ex.: ficar
                  // com tierSteps preenchido ao virar PERCENT).
                  patchHyp(h.uid, {
                    type: next,
                    tierSteps: next === 'TIER_UPGRADE' ? h.tierSteps : '',
                    minQty: next === 'MIN_QTY_PERCENT' ? h.minQty : '',
                  })
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HYP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {HYP_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!isTierUpgrade && (
                <>
                  <Input
                    type="text"
                    placeholder={isPercent ? '10' : '200,00'}
                    value={h.value}
                    onChange={(e) => patchHyp(h.uid, { value: e.target.value })}
                    className="w-28"
                    aria-label={isPercent ? 'Percentual' : 'Valor fixo em reais'}
                  />
                  <span className="text-xs text-slate-500">{isPercent ? '%' : 'R$ /unid.'}</span>
                </>
              )}

              {isTierUpgrade && (
                <>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    placeholder="3"
                    value={h.tierSteps}
                    onChange={(e) => patchHyp(h.uid, { tierSteps: e.target.value })}
                    className="w-20"
                    aria-label="Tiers acima"
                  />
                  <span className="text-xs text-slate-500">tiers acima (1–10)</span>
                </>
              )}

              {h.type === 'MIN_QTY_PERCENT' && (
                <>
                  <span className="text-xs text-slate-400">se qty ≥</span>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    placeholder="3"
                    value={h.minQty}
                    onChange={(e) => patchHyp(h.uid, { minQty: e.target.value })}
                    className="w-20"
                    aria-label="Quantidade mínima"
                  />
                </>
              )}

              {isFixedish && h.type === 'FIRST_UNIT_DISCOUNT' && (
                <span className="text-xs text-slate-400">na 1ª unidade</span>
              )}

              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeHyp(h.uid)}
                aria-label="Remover"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
      </div>

      {existingCoupons.length > 0 && (
        <div className="space-y-2">
          <Label>Cupons existentes (apenas ativos para este produto)</Label>
          <div className="space-y-1 rounded-md border bg-slate-50 p-2">
            {existingCoupons.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedExistingIds.includes(c.id)}
                  onChange={() => toggleExisting(c.id)}
                />
                <span className="text-sm font-medium text-slate-700">{c.code}</span>
                <span className="text-xs text-slate-500">
                  · {c.buyer_label} · {c.discount_label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Atualizando...' : 'Atualizar matriz'}
        </Button>
      </div>
    </form>
  )
}
