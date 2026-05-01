'use client'

/**
 * Form interativo de criar/atualizar um pricing profile + tiers.
 *
 * Modelo SCD-2 — toda "edição" é na verdade uma nova versão. O
 * server action `savePricingProfile` encerra a versão vigente e cria
 * uma nova (ver mig-076). Por isso este form sempre começa do estado
 * vigente como template, mas a operação é "publicar v2".
 *
 * UX
 * --
 * - Inputs em REAIS, não em centavos. Conversão para cents acontece
 *   no submit (mantém input familiar para o operador).
 * - Tiers em uma tabela mutável (add/remove rows + auto-validação
 *   de overlap antes do submit, mesmo refine que o backend faz).
 * - Botão "Salvar nova versão" expõe explicitamente que é versão
 *   nova; "Cancelar" volta sem mudar nada.
 * - Falhas do servidor (ex.: invalid_tier vindo de outro thread que
 *   inseriu um overlap concorrentemente) são exibidas como toast de
 *   erro e o form fica vivo para correção.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2, Plus, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { savePricingProfile } from '@/services/pricing'
import type { ConsultantCommissionBasis, PricingProfile, PricingProfileTier } from '@/types'

interface Props {
  productId: string
  currentProfile: PricingProfile | null
  currentTiers: PricingProfileTier[]
  cancelHref: string
}

interface TierRow {
  /** stable client-side id for keyed React rendering. */
  uid: string
  min_quantity: string
  max_quantity: string
  unit_price_brl: string
}

let _uidCounter = 0
function uid(): string {
  _uidCounter += 1
  return `tier-${_uidCounter}-${Date.now()}`
}

function centsToBrl(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2).replace('.', ',')
}

function brlToCents(brl: string): number | null {
  const trimmed = brl.trim().replace(/\./g, '').replace(',', '.')
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function PricingProfileForm({ productId, currentProfile, currentTiers, cancelHref }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // In-form feedback message — survives even if the Sonner toast layer
  // is blocked (ad-blocker, CSP report-only quirk, hydration-deferred
  // portal). aria-live polite so screen-readers announce it on change.
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(
    null
  )
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)

  const [pharmacyCostBrl, setPharmacyCostBrl] = useState(
    centsToBrl(currentProfile?.pharmacy_cost_unit_cents ?? null)
  )
  const [floorAbsBrl, setFloorAbsBrl] = useState(
    centsToBrl(currentProfile?.platform_min_unit_cents ?? null)
  )
  const [floorPctStr, setFloorPctStr] = useState(
    currentProfile?.platform_min_unit_pct != null
      ? String(currentProfile.platform_min_unit_pct).replace('.', ',')
      : ''
  )
  const [basis, setBasis] = useState<ConsultantCommissionBasis>(
    currentProfile?.consultant_commission_basis ?? 'TOTAL_PRICE'
  )
  const [fixedPerUnitBrl, setFixedPerUnitBrl] = useState(
    centsToBrl(currentProfile?.consultant_commission_fixed_per_unit_cents ?? null)
  )
  const [reason, setReason] = useState('')

  const initialTiers: TierRow[] =
    currentTiers.length > 0
      ? currentTiers.map((t) => ({
          uid: uid(),
          min_quantity: String(t.min_quantity),
          max_quantity: String(t.max_quantity),
          unit_price_brl: centsToBrl(t.unit_price_cents),
        }))
      : [{ uid: uid(), min_quantity: '1', max_quantity: '1', unit_price_brl: '' }]

  const [tiers, setTiers] = useState<TierRow[]>(initialTiers)

  function addTier() {
    const lastMax = tiers.length > 0 ? Number(tiers[tiers.length - 1]?.max_quantity ?? 0) : 0
    const nextMin = lastMax > 0 ? lastMax + 1 : 1
    setTiers((prev) => [
      ...prev,
      {
        uid: uid(),
        min_quantity: String(nextMin),
        max_quantity: String(nextMin),
        unit_price_brl: '',
      },
    ])
  }

  function removeTier(rowUid: string) {
    if (tiers.length <= 1) {
      toast.error('Pelo menos 1 tier é obrigatório')
      return
    }
    setTiers((prev) => prev.filter((t) => t.uid !== rowUid))
  }

  function patchTier(rowUid: string, patch: Partial<TierRow>) {
    setTiers((prev) => prev.map((t) => (t.uid === rowUid ? { ...t, ...patch } : t)))
  }

  function validate():
    | { ok: true; data: Parameters<typeof savePricingProfile>[1] }
    | { ok: false; message: string } {
    const pharmacyCost = brlToCents(pharmacyCostBrl)
    if (pharmacyCost === null || pharmacyCost <= 0) {
      return { ok: false, message: 'Custo da farmácia obrigatório (em R$)' }
    }

    const floorAbsCents = floorAbsBrl.trim() ? brlToCents(floorAbsBrl) : null
    if (floorAbsBrl.trim() && (floorAbsCents === null || floorAbsCents <= 0)) {
      return { ok: false, message: 'Piso absoluto inválido' }
    }

    const floorPct = floorPctStr.trim() ? Number(floorPctStr.replace(',', '.')) : null
    if (
      floorPctStr.trim() &&
      (floorPct === null || !Number.isFinite(floorPct) || floorPct <= 0 || floorPct > 100)
    ) {
      return { ok: false, message: 'Piso percentual inválido (0–100)' }
    }

    if (floorAbsCents == null && floorPct == null) {
      return { ok: false, message: 'Defina pelo menos um piso (absoluto ou percentual)' }
    }

    let fixedPerUnit: number | null = null
    if (basis === 'FIXED_PER_UNIT') {
      fixedPerUnit = brlToCents(fixedPerUnitBrl)
      if (fixedPerUnit === null || fixedPerUnit < 0) {
        return { ok: false, message: 'Comissão fixa por unidade obrigatória' }
      }
      // INV-4 ex-ante (espelha refine do Zod).
      if (floorAbsCents != null && fixedPerUnit > floorAbsCents) {
        return {
          ok: false,
          message: 'Comissão fixa por unidade não pode exceder o piso absoluto da plataforma',
        }
      }
    }

    if (!reason.trim()) {
      return { ok: false, message: 'Motivo é obrigatório' }
    }

    // Tiers
    const parsedTiers = tiers.map((row, idx) => {
      const minQ = Number(row.min_quantity)
      const maxQ = Number(row.max_quantity)
      const priceCents = brlToCents(row.unit_price_brl)
      return { idx, minQ, maxQ, priceCents }
    })

    for (const t of parsedTiers) {
      if (!Number.isInteger(t.minQ) || t.minQ <= 0) {
        return { ok: false, message: `Tier #${t.idx + 1}: quantidade mínima inválida` }
      }
      if (!Number.isInteger(t.maxQ) || t.maxQ < t.minQ) {
        return { ok: false, message: `Tier #${t.idx + 1}: quantidade máxima inválida` }
      }
      if (t.priceCents == null || t.priceCents <= 0) {
        return { ok: false, message: `Tier #${t.idx + 1}: preço unitário inválido` }
      }
    }

    // Overlap detection (mirror server-side)
    const sorted = [...parsedTiers].sort((a, b) => a.minQ - b.minQ)
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (a && b && a.maxQ >= b.minQ) {
        return { ok: false, message: 'Os tiers não podem ter faixas de quantidade sobrepostas' }
      }
    }

    return {
      ok: true,
      data: {
        pharmacy_cost_unit_cents: pharmacyCost,
        platform_min_unit_cents: floorAbsCents,
        platform_min_unit_pct: floorPct,
        consultant_commission_basis: basis,
        consultant_commission_fixed_per_unit_cents: fixedPerUnit,
        change_reason: reason.trim(),
        tiers: parsedTiers.map((t) => ({
          min_quantity: t.minQ,
          max_quantity: t.maxQ,
          unit_price_cents: t.priceCents as number,
        })),
      },
    }
  }

  function showError(message: string) {
    setFeedback({ kind: 'error', message })
    // Best-effort toast — never the sole feedback channel.
    try {
      toast.error(message)
    } catch {
      // Sonner unavailable → in-form banner already covers it.
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFeedback(null)
    // Diagnostic breadcrumb — leaves a trail in the browser console
    // when an operator reports "I clicked and nothing happened". Keeps
    // a stable prefix so it's grep-able in support sessions.
    if (typeof window !== 'undefined') {
      console.info('[pricing-form] submit clicked', {
        productId,
        hasReason: reason.trim().length > 0,
        tierCount: tiers.length,
      })
    }
    const v = validate()
    if (!v.ok) {
      showError(v.message)
      // Most common silent-fail path: empty/invalid `reason`. Bring it
      // into view + focus so the operator immediately sees what's
      // missing instead of "nothing happened".
      if (/motivo/i.test(v.message) && reasonRef.current) {
        reasonRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        reasonRef.current.focus()
      }
      return
    }

    startTransition(async () => {
      try {
        const res = await savePricingProfile(productId, v.data)
        if (res.error) {
          showError(res.error)
          return
        }
        setFeedback({ kind: 'success', message: 'Pricing profile salvo (nova versão publicada)' })
        try {
          toast.success('Pricing profile salvo (nova versão publicada)')
        } catch {
          /* ignore — banner is already shown */
        }
        router.push(`/products/${productId}/pricing`)
        router.refresh()
      } catch (err) {
        // Network failure / Server Action transport error / runtime
        // exception — without this catch the useTransition swallowed
        // the error silently and the operator saw no feedback.
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[pricing-form] savePricingProfile threw', { err: msg })
        showError(`Falha ao salvar: ${msg}. Tente novamente em instantes.`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pharmacy_cost">Custo por unidade pago à farmácia (R$) *</Label>
          <Input
            id="pharmacy_cost"
            type="text"
            placeholder="1000,00"
            value={pharmacyCostBrl}
            onChange={(e) => setPharmacyCostBrl(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Imutável dentro de uma versão. Sempre repassado integralmente.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="floor_abs">Piso da plataforma — absoluto (R$)</Label>
          <Input
            id="floor_abs"
            type="text"
            placeholder="120,00"
            value={floorAbsBrl}
            onChange={(e) => setFloorAbsBrl(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Mínimo que a plataforma recebe por unidade após cupom.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="floor_pct">Piso da plataforma — percentual do tier (%)</Label>
          <Input
            id="floor_pct"
            type="text"
            placeholder="8"
            value={floorPctStr}
            onChange={(e) => setFloorPctStr(e.target.value)}
          />
          <FloorPctHelp
            floorAbsBrl={floorAbsBrl}
            floorPctStr={floorPctStr}
            tiers={tiers}
            brlToCents={brlToCents}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="basis">Critério de comissão do consultor *</Label>
          <Select value={basis} onValueChange={(v) => setBasis(v as ConsultantCommissionBasis)}>
            <SelectTrigger id="basis" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TOTAL_PRICE">% sobre o preço total ao cliente</SelectItem>
              <SelectItem value="PHARMACY_TRANSFER">% sobre o repasse à farmácia</SelectItem>
              <SelectItem value="FIXED_PER_UNIT">Valor fixo por unidade</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500">
            % sobre o preço total ao cliente é o critério mais comum (consultor ganha sobre a
            receita gerada). Repasse à farmácia desconecta do desconto. Fixo por unidade independe
            de tier ou cupom.
          </p>
        </div>

        {basis === 'FIXED_PER_UNIT' && (
          <div className="space-y-2">
            <Label htmlFor="fixed_per_unit">Comissão fixa por unidade (R$) *</Label>
            <Input
              id="fixed_per_unit"
              type="text"
              placeholder="20,00"
              value={fixedPerUnitBrl}
              onChange={(e) => setFixedPerUnitBrl(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              INV-4: nunca poderá exceder a receita bruta da plataforma na unidade (cap aplicado
              pelo SQL).
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base">Tiers de preço ao cliente</Label>
          <Button type="button" variant="outline" size="sm" onClick={addTier}>
            <Plus className="mr-1 h-4 w-4" />
            Adicionar tier
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Qtd. mínima</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">Qtd. máxima</th>
                <th className="px-3 py-2 text-left font-medium text-slate-600">
                  Preço unitário (R$)
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((row) => (
                <tr key={row.uid} className="border-t">
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={row.min_quantity}
                      onChange={(e) => patchTier(row.uid, { min_quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={row.max_quantity}
                      onChange={(e) => patchTier(row.uid, { max_quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="text"
                      placeholder="1500,00"
                      value={row.unit_price_brl}
                      onChange={(e) => patchTier(row.uid, { unit_price_brl: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTier(row.uid)}
                      aria-label="Remover tier"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Faixas não podem se sobrepor. Ex.: 1–1, 2–3, 4–10. Quantidades fora de qualquer faixa
          cadastrada bloqueiam o pedido (o operador é avisado no simulador).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reason">Motivo desta versão *</Label>
        <Textarea
          ref={reasonRef}
          id="reason"
          rows={3}
          placeholder="Ex.: aumento do custo da farmácia em 20%, repassado para os tiers."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {/* In-form feedback banner — primary feedback channel.
          aria-live=polite so screen readers announce, role=status so
          assistive tech treats as advisory. Survives Sonner being
          blocked by an extension or CSP regression. */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={
            feedback.kind === 'error'
              ? 'flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800'
              : 'flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800'
          }
          data-testid="pricing-form-feedback"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Sticky action bar — sempre visível no fim do viewport para que
          o operador nunca precise rolar até o fim do form pra encontrar
          o botão de salvar. z-10 garante que fica acima de qualquer
          conteúdo que rendere abaixo (sticky em flow normal não cria
          stacking context por si só). */}
      <div className="sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t bg-white/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <p className="hidden text-xs text-slate-500 sm:block">
          Salvar publica uma <strong>nova versão</strong> deste profile. A versão atual fica
          preservada como histórico (SCD-2).
        </p>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(cancelHref)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} data-testid="pricing-form-submit">
            {pending ? 'Salvando...' : 'Salvar e publicar nova versão'}
          </Button>
        </div>
      </div>
    </form>
  )
}

/**
 * Helper inline didático para o piso percentual.
 * Mostra o cálculo `pct × tier` para até 3 tiers e o piso efetivo
 * `GREATEST(abs, pct)` em cada um — replicando o comportamento real do
 * SQL `resolve_effective_floor` (mig-071/075). Some quando os campos
 * estão vazios pra não poluir.
 */
function FloorPctHelp({
  floorAbsBrl,
  floorPctStr,
  tiers,
  brlToCents,
}: {
  floorAbsBrl: string
  floorPctStr: string
  tiers: TierRow[]
  brlToCents: (brl: string) => number | null
}) {
  const pct = floorPctStr.trim() ? Number(floorPctStr.replace(',', '.')) : null
  const absCents = floorAbsBrl.trim() ? brlToCents(floorAbsBrl) : null

  if (!floorPctStr.trim() || pct === null || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return (
      <p className="text-xs text-slate-500">
        Aplicado por tier. O piso efetivo é o <strong>maior</strong> entre absoluto e percentual.
      </p>
    )
  }

  const sample = tiers
    .map((row) => ({ minQ: Number(row.min_quantity), priceCents: brlToCents(row.unit_price_brl) }))
    .filter(
      (r) => Number.isInteger(r.minQ) && r.minQ > 0 && r.priceCents != null && r.priceCents > 0
    )
    .slice(0, 3)

  if (sample.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Aplicado por tier. O piso efetivo é o <strong>maior</strong> entre absoluto e percentual.
      </p>
    )
  }

  return (
    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
      <p>
        Em cada tier, piso = <code className="rounded bg-white px-1">MAIOR(abs, pct × preço)</code>:
      </p>
      <ul className="space-y-0.5 font-mono text-[11px]">
        {sample.map((s) => {
          const pctCents = Math.round(((s.priceCents ?? 0) * pct) / 100)
          const effective = Math.max(absCents ?? 0, pctCents)
          const winner = (absCents ?? 0) >= pctCents ? 'abs' : 'pct'
          return (
            <li key={s.minQ}>
              {s.minQ}u (R$ {((s.priceCents ?? 0) / 100).toFixed(2).replace('.', ',')}) →{' pct '}
              {(pctCents / 100).toFixed(2).replace('.', ',')} ·{' '}
              {absCents != null ? `abs ${(absCents / 100).toFixed(2).replace('.', ',')} · ` : ''}
              <strong>piso {(effective / 100).toFixed(2).replace('.', ',')}</strong>{' '}
              <span className="text-slate-400">({winner} venceu)</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
