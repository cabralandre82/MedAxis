'use client'

import { useState, useTransition, useEffect } from 'react'
import { Plus, Trash2, Star, Loader2, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

interface Variant {
  id: string
  name: string
  attributes: Record<string, string>
  price_current: number
  pharmacy_cost: number
  platform_commission_type: 'PERCENTAGE' | 'FIXED'
  platform_commission_value: number
  is_default: boolean
  is_active: boolean
}

interface ProductVariantsManagerProps {
  productId: string
  basePrice: number
  basePharmacyCost: number
  /**
   * When true, the component hides every reference to `price_current`
   * (the sales price the buyer pays) — pharmacies must only see and
   * edit `pharmacy_cost`. The new-variant form defaults the sales
   * price to the parent product's `basePrice`. Mirrors the contract
   * enforced by `lib/orders/view-mode.ts` and exercised by
   * `scripts/claims/check-rbac-view-leak.sh`.
   */
  isPharmacyAdmin?: boolean
}

const COMMON_ATTRS = ['Concentração', 'Apresentação', 'Quantidade']

export function ProductVariantsManager({
  productId,
  basePrice,
  basePharmacyCost,
  isPharmacyAdmin = false,
}: ProductVariantsManagerProps) {
  const [variants, setVariants] = useState<Variant[]>([])
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [newVariant, setNewVariant] = useState({
    name: '',
    attributes: {} as Record<string, string>,
    price_current: basePrice,
    pharmacy_cost: basePharmacyCost,
    platform_commission_type: 'FIXED' as const,
    platform_commission_value: Math.max(basePrice - basePharmacyCost, 0),
    is_default: false,
  })

  useEffect(() => {
    fetch(`/api/products/variants?productId=${productId}`)
      .then((r) => r.json())
      .then(setVariants)
      .catch(() => {})
  }, [productId])

  function updateAttr(key: string, value: string) {
    setNewVariant((v) => ({ ...v, attributes: { ...v.attributes, [key]: value } }))
  }

  function saveVariant() {
    if (!newVariant.name.trim()) {
      toast.error('Informe o nome da variante')
      return
    }
    startTransition(async () => {
      const res = await fetch('/api/products/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newVariant, product_id: productId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error?.fieldErrors ? 'Dados inválidos' : json.error)
        return
      }
      setVariants((v) => [...v, json])
      setAdding(false)
      setNewVariant({
        name: '',
        attributes: {},
        price_current: basePrice,
        pharmacy_cost: basePharmacyCost,
        platform_commission_type: 'FIXED',
        platform_commission_value: Math.max(basePrice - basePharmacyCost, 0),
        is_default: false,
      })
      toast.success('Variante adicionada!')
    })
  }

  function setDefault(id: string) {
    startTransition(async () => {
      await fetch('/api/products/variants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_default: true }),
      })
      setVariants((v) => v.map((x) => ({ ...x, is_default: x.id === id })))
    })
  }

  function deleteVariant(id: string) {
    startTransition(async () => {
      await fetch(`/api/products/variants?id=${id}`, { method: 'DELETE' })
      setVariants((v) => v.filter((x) => x.id !== id))
      toast.success('Variante removida')
    })
  }

  const margin = (v: Variant) =>
    v.price_current -
    v.pharmacy_cost -
    (v.platform_commission_type === 'PERCENTAGE'
      ? (v.price_current * v.platform_commission_value) / 100
      : v.platform_commission_value)

  return (
    <div className="space-y-3">
      {/* Contextual help for variants */}
      <details className="group rounded-lg border border-amber-100 bg-amber-50">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-amber-800 select-none hover:bg-amber-100/60">
          <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />
          Quando usar variantes?
          <ChevronDown className="ml-auto h-4 w-4 text-amber-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-amber-100 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <p className="mb-2">
            Use variantes quando o <strong>mesmo produto</strong> existe em versões com
            concentração, quantidade ou apresentação diferentes — e cada versão tem um preço
            diferente.
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div className="rounded border border-amber-200 bg-white/70 p-2">
              <p className="mb-1 font-semibold text-amber-800">✅ Use variantes quando:</p>
              <ul className="space-y-0.5 text-amber-700">
                <li>• Ozempic 0,5mg / 1mg / 2mg</li>
                <li>• Frasco 10mL / 20mL / 30mL</li>
                <li>• 30 comprimidos / 60 comprimidos</li>
              </ul>
            </div>
            <div className="rounded border border-amber-200 bg-white/70 p-2">
              <p className="mb-1 font-semibold text-amber-800">
                ❌ Crie produtos separados quando:
              </p>
              <ul className="space-y-0.5 text-amber-700">
                <li>• São medicamentos diferentes</li>
                <li>• Fabricantes distintos</li>
                <li>• Categorias diferentes</li>
              </ul>
            </div>
          </div>
          <p className="text-amber-700">
            Se o produto tiver variantes, a variante marcada como <strong>Padrão</strong> é
            selecionada automaticamente no pedido.
          </p>
        </div>
      </details>

      <div className="rounded-lg border border-gray-200">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="flex items-center gap-2">
            Variantes do produto
            <Badge className="bg-blue-100 text-xs text-blue-700">
              {variants.filter((v) => v.is_active).length}
            </Badge>
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {expanded && (
          <div className="space-y-3 border-t px-4 pt-3 pb-4">
            {variants
              .filter((v) => v.is_active)
              .map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{v.name}</span>
                      {v.is_default && (
                        <Badge className="bg-green-100 text-xs text-green-700">Padrão</Badge>
                      )}
                    </div>
                    {Object.keys(v.attributes).length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {Object.entries(v.attributes)
                          .map(([k, val]) => `${k}: ${val}`)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500">
                      {isPharmacyAdmin
                        ? `repasse ${formatCurrency(v.pharmacy_cost)}`
                        : `${formatCurrency(v.price_current)} · custo ${formatCurrency(v.pharmacy_cost)} · margem plataforma ${formatCurrency(margin(v))}`}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    {!v.is_default && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        disabled={isPending}
                        onClick={() => setDefault(v.id)}
                        title="Definir como padrão"
                      >
                        <Star className="h-3.5 w-3.5 text-gray-400" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                      disabled={isPending}
                      onClick={() => deleteVariant(v.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}

            {adding ? (
              <div className="space-y-3 rounded-lg border bg-blue-50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Nome da variante *</Label>
                    <Input
                      placeholder="Ex: 500mg / Comprimido / 30un"
                      value={newVariant.name}
                      onChange={(e) => setNewVariant((v) => ({ ...v, name: e.target.value }))}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  {COMMON_ATTRS.map((attr) => (
                    <div key={attr}>
                      <Label className="text-xs">{attr}</Label>
                      <Input
                        placeholder={`Ex: ${attr === 'Concentração' ? '500mg' : attr === 'Apresentação' ? 'Comprimido' : '30 unidades'}`}
                        value={newVariant.attributes[attr] ?? ''}
                        onChange={(e) => updateAttr(attr, e.target.value)}
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                  ))}
                  {!isPharmacyAdmin && (
                    <div>
                      <Label className="text-xs">Preço ao cliente (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={newVariant.price_current}
                        onChange={(e) =>
                          setNewVariant((v) => ({
                            ...v,
                            price_current: Number(e.target.value),
                            platform_commission_value: Math.max(
                              Number(e.target.value) - v.pharmacy_cost,
                              0
                            ),
                          }))
                        }
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">
                      {isPharmacyAdmin ? 'Repasse (R$)' : 'Custo farmácia (R$)'}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newVariant.pharmacy_cost}
                      onChange={(e) =>
                        setNewVariant((v) => ({
                          ...v,
                          pharmacy_cost: Number(e.target.value),
                          platform_commission_value: Math.max(
                            v.price_current - Number(e.target.value),
                            0
                          ),
                        }))
                      }
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  {!isPharmacyAdmin && (
                    <div className="col-span-2 rounded border bg-white px-3 py-2 text-xs text-gray-500">
                      Margem plataforma:{' '}
                      <strong className="text-gray-800">
                        {formatCurrency(
                          Math.max(newVariant.price_current - newVariant.pharmacy_cost, 0)
                        )}
                      </strong>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAdding(false)}
                    className="flex-1"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveVariant}
                    disabled={isPending}
                    className="flex-1 gap-1"
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Salvar variante
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2 border-dashed"
                onClick={() => setAdding(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar variante
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
