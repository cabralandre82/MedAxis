'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { productSchema, type ProductFormData } from '@/lib/validators'
import { createProduct, updateProduct } from '@/services/products'
import { slugify, formatCurrency } from '@/lib/utils'
import type { ProductWithRelations, ProductCategory, Pharmacy } from '@/types'
import { AlertTriangle, TrendingUp } from 'lucide-react'

interface ProductFormProps {
  product?: ProductWithRelations
  categories: ProductCategory[]
  pharmacies: Pharmacy[]
  consultantRate: number
}

export function ProductForm({ product, categories, pharmacies, consultantRate }: ProductFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const isEditing = !!product

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          category_id: product.category_id,
          pharmacy_id: product.pharmacy_id,
          sku: product.sku,
          name: product.name,
          slug: product.slug,
          concentration: product.concentration,
          presentation: product.presentation,
          short_description: product.short_description,
          long_description: product.long_description ?? '',
          price_current: product.price_current,
          pharmacy_cost: product.pharmacy_cost,
          estimated_deadline_days: product.estimated_deadline_days,
          active: product.active,
          featured: product.featured,
        }
      : {
          active: true,
          featured: false,
          pharmacy_cost: 0,
          characteristics_json: {},
        },
  })

  const nameValue = watch('name')
  const priceValue = watch('price_current') ?? 0
  const pharmacyCostValue = watch('pharmacy_cost') ?? 0

  // Live margin calculations
  const platformMargin = Math.max(0, priceValue - pharmacyCostValue)
  const consultantCommission = Math.round(priceValue * consultantRate) / 100
  const platformNetWithConsultant = platformMargin - consultantCommission
  const platformNetNoConsultant = platformMargin
  const marginInsufficient = platformMargin < consultantCommission && priceValue > 0

  function handleNameBlur() {
    if (!isEditing && nameValue) {
      setValue('slug', slugify(nameValue))
    }
  }

  async function onSubmit(data: ProductFormData) {
    setLoading(true)
    try {
      if (isEditing && product) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { price_current: _price, ...updateData } = data
        const result = await updateProduct(product.id, updateData)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Produto atualizado!')
        router.push(`/products/${product.id}`)
      } else {
        const result = await createProduct(data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Produto criado!')
        router.push(`/products/${result.id}`)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Identificação */}
      <section>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Identificação
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="category_id">Categoria *</Label>
            <Select
              defaultValue={product?.category_id}
              onValueChange={(v) => setValue('category_id', v as string)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category_id && (
              <p className="text-sm text-red-500">{errors.category_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pharmacy_id">Farmácia *</Label>
            <Select
              defaultValue={product?.pharmacy_id}
              onValueChange={(v) => setValue('pharmacy_id', v as string)}
              disabled={isEditing}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {pharmacies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.trade_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.pharmacy_id && (
              <p className="text-sm text-red-500">{errors.pharmacy_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="sku">SKU *</Label>
            <Input id="sku" {...register('sku')} />
            {errors.sku && <p className="text-sm text-red-500">{errors.sku.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nome do Produto *</Label>
            <Input id="name" {...register('name')} onBlur={handleNameBlur} />
            {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug *</Label>
            <Input id="slug" {...register('slug')} />
            {errors.slug && <p className="text-sm text-red-500">{errors.slug.message}</p>}
          </div>
        </div>
      </section>

      {/* Preços e Comissão */}
      <section>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Preços e Comissão
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="price_current">Preço ao cliente (R$) *</Label>
              <Input
                id="price_current"
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                {...register('price_current', { valueAsNumber: true })}
              />
              {errors.price_current && (
                <p className="text-sm text-red-500">{errors.price_current.message}</p>
              )}
            </div>
          )}
          {isEditing && (
            <div className="space-y-2">
              <Label>Preço ao cliente (R$)</Label>
              <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {formatCurrency(product!.price_current)}
                <span className="ml-2 text-xs text-slate-400">
                  (use &quot;Atualizar preço&quot; para alterar)
                </span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pharmacy_cost">Repasse à farmácia por unidade (R$) *</Label>
            <Input
              id="pharmacy_cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              {...register('pharmacy_cost', { valueAsNumber: true })}
            />
            {errors.pharmacy_cost && (
              <p className="text-sm text-red-500">{errors.pharmacy_cost.message}</p>
            )}
            <p className="text-xs text-slate-500">
              Valor fixo que a plataforma deve repassar à farmácia por unidade vendida
            </p>
          </div>
        </div>

        {/* Margin preview — shown when both values are filled */}
        {priceValue > 0 && (
          <div
            className={`mt-4 rounded-xl border p-4 ${marginInsufficient ? 'border-red-200 bg-red-50' : 'border-blue-100 bg-blue-50'}`}
          >
            <div className="mb-3 flex items-center gap-2">
              {marginInsufficient ? (
                <AlertTriangle className="h-4 w-4 text-red-500" />
              ) : (
                <TrendingUp className="h-4 w-4 text-blue-600" />
              )}
              <span
                className={`text-sm font-semibold ${marginInsufficient ? 'text-red-700' : 'text-blue-700'}`}
              >
                Análise de margem
              </span>
              <span className="ml-auto text-xs text-slate-500">
                Taxa consultores: {consultantRate}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                <span className="text-slate-600">Preço ao cliente</span>
                <span className="font-medium">{formatCurrency(priceValue)}</span>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                <span className="text-slate-600">Repasse farmácia</span>
                <span className="font-medium text-slate-700">
                  − {formatCurrency(pharmacyCostValue)}
                </span>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                <span className="text-slate-600">Margem bruta plataforma</span>
                <span
                  className={`font-semibold ${platformMargin <= 0 ? 'text-red-600' : 'text-slate-900'}`}
                >
                  {formatCurrency(platformMargin)}
                </span>
              </div>
              <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                <span className="text-slate-600">Comissão do consultor ({consultantRate}%)</span>
                <span className="font-medium text-amber-700">
                  − {formatCurrency(consultantCommission)}
                </span>
              </div>
              <div className="col-span-2 mt-1 flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">
                  Lucro líquido plataforma
                </span>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-xs text-slate-400">Sem consultor</p>
                    <p
                      className={`text-base font-bold ${platformNetNoConsultant < 0 ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {formatCurrency(platformNetNoConsultant)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Com consultor</p>
                    <p
                      className={`text-base font-bold ${platformNetWithConsultant < 0 ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {formatCurrency(platformNetWithConsultant)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            {marginInsufficient && (
              <p className="mt-3 text-xs text-red-600">
                ⚠️ A margem bruta ({formatCurrency(platformMargin)}) é menor que a comissão do
                consultor ({formatCurrency(consultantCommission)}). Reduza o repasse à farmácia ou
                aumente o preço ao cliente.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Especificações */}
      <section>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Especificações
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="concentration">Concentração *</Label>
            <Input id="concentration" placeholder="Ex: 10mg/mL" {...register('concentration')} />
            {errors.concentration && (
              <p className="text-sm text-red-500">{errors.concentration.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="presentation">Apresentação *</Label>
            <Input id="presentation" placeholder="Ex: Frasco 30mL" {...register('presentation')} />
            {errors.presentation && (
              <p className="text-sm text-red-500">{errors.presentation.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimated_deadline_days">Prazo de entrega (dias) *</Label>
            <Input
              id="estimated_deadline_days"
              type="number"
              min="1"
              {...register('estimated_deadline_days', { valueAsNumber: true })}
            />
            {errors.estimated_deadline_days && (
              <p className="text-sm text-red-500">{errors.estimated_deadline_days.message}</p>
            )}
          </div>
        </div>
      </section>

      {/* Descrição */}
      <section>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Descrição
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="short_description">Descrição curta *</Label>
            <Textarea
              id="short_description"
              rows={2}
              placeholder="Resumo para listagem..."
              {...register('short_description')}
            />
            {errors.short_description && (
              <p className="text-sm text-red-500">{errors.short_description.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="long_description">Descrição completa</Label>
            <Textarea
              id="long_description"
              rows={5}
              placeholder="Informações detalhadas..."
              {...register('long_description')}
            />
          </div>
        </div>
      </section>

      {/* Visibilidade */}
      <section>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Visibilidade
        </h3>
        <div className="flex gap-8">
          <div className="flex items-center gap-3">
            <Switch
              id="active"
              defaultChecked={product?.active ?? true}
              onCheckedChange={(v) => setValue('active', v)}
            />
            <Label htmlFor="active">Produto ativo no catálogo</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="featured"
              defaultChecked={product?.featured ?? false}
              onCheckedChange={(v) => setValue('featured', v)}
            />
            <Label htmlFor="featured">Destaque</Label>
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar produto'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
