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
import { slugify } from '@/lib/utils'
import type { ProductWithRelations, ProductCategory, Pharmacy } from '@/types'

interface ProductFormProps {
  product?: ProductWithRelations
  categories: ProductCategory[]
  pharmacies: Pharmacy[]
}

export function ProductForm({ product, categories, pharmacies }: ProductFormProps) {
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
          estimated_deadline_days: product.estimated_deadline_days,
          active: product.active,
          featured: product.featured,
        }
      : {
          active: true,
          featured: false,
          characteristics_json: {},
        },
  })

  const nameValue = watch('name')

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
      <div>
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

          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="price_current">Preço (R$) *</Label>
              <Input
                id="price_current"
                type="number"
                step="0.01"
                min="0"
                {...register('price_current', { valueAsNumber: true })}
              />
              {errors.price_current && (
                <p className="text-sm text-red-500">{errors.price_current.message}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
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
            <Label htmlFor="estimated_deadline_days">Prazo de Entrega (dias) *</Label>
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
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Descrição
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="short_description">Descrição Curta *</Label>
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
            <Label htmlFor="long_description">Descrição Completa</Label>
            <Textarea
              id="long_description"
              rows={5}
              placeholder="Informações detalhadas..."
              {...register('long_description')}
            />
          </div>
        </div>
      </div>

      <div>
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
      </div>

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
