'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { ButtonLink } from '@/components/ui/button-link'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ChevronLeft, Package, Clock, MapPin, Star, ShoppingCart, CheckCircle } from 'lucide-react'

interface ProductDetailProps {
  product: {
    id: string
    name: string
    slug: string
    concentration: string
    presentation: string
    short_description: string
    long_description?: string | null
    characteristics_json: Record<string, unknown>
    price_current: number
    estimated_deadline_days: number
    featured: boolean
    product_categories: { id: string; name: string; slug: string } | null
    pharmacies: { id: string; trade_name: string; city: string; state: string } | null
    product_images: {
      id: string
      public_url: string | null
      alt_text: string | null
      sort_order: number
    }[]
  }
}

export function ProductDetail({ product }: ProductDetailProps) {
  const sortedImages = [...(product.product_images ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order
  )
  const [selectedImage, setSelectedImage] = useState(sortedImages[0] ?? null)

  const characteristics = product.characteristics_json as Record<string, string>

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/catalog" className="flex items-center gap-1 hover:text-gray-900">
          <ChevronLeft className="h-4 w-4" />
          Catálogo
        </Link>
        {product.product_categories && (
          <>
            <span>/</span>
            <Link
              href={`/catalog?category=${product.product_categories.slug}`}
              className="hover:text-gray-900"
            >
              {product.product_categories.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="truncate font-medium text-gray-900">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Image Gallery */}
        <div className="space-y-3">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
            {selectedImage?.public_url ? (
              <Image
                src={selectedImage.public_url}
                alt={selectedImage.alt_text ?? product.name}
                width={600}
                height={600}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-24 w-24 text-gray-300" />
            )}
          </div>

          {sortedImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sortedImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(img)}
                  className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                    selectedImage?.id === img.id
                      ? 'border-[hsl(196,91%,36%)]'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {img.public_url ? (
                    <Image
                      src={img.public_url}
                      alt={img.alt_text ?? ''}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gray-100">
                      <Package className="h-5 w-5 text-gray-300" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="space-y-5">
          {/* Header */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              {product.product_categories && (
                <Badge variant="secondary">{product.product_categories.name}</Badge>
              )}
              {product.featured && (
                <Badge className="gap-1 border-0 bg-amber-500 text-white">
                  <Star className="h-3 w-3 fill-current" />
                  Destaque
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              {product.short_description}
            </p>
          </div>

          {/* Concentration and Presentation */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl border border-blue-100 bg-blue-50 p-3">
              <p className="mb-0.5 text-xs font-medium tracking-wide text-blue-600 uppercase">
                Concentração
              </p>
              <p className="text-sm font-semibold text-blue-900">{product.concentration}</p>
            </div>
            <div className="flex-1 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                Apresentação
              </p>
              <p className="text-sm font-semibold text-gray-800">{product.presentation}</p>
            </div>
          </div>

          {/* Price Box */}
          <div className="rounded-2xl bg-[hsl(213,75%,24%)] p-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="mb-1 text-xs tracking-wide text-blue-200 uppercase">Preço unitário</p>
                <p className="text-3xl font-bold">{formatCurrency(product.price_current)}</p>
                <p className="mt-1 text-xs text-blue-200">Valor fixo · Plataforma MedAxis</p>
              </div>
              <div className="text-right">
                <div className="rounded-xl bg-white/15 p-2.5">
                  <Clock className="h-5 w-5 text-white" />
                </div>
              </div>
            </div>
            <Separator className="my-3 bg-white/20" />
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-200" />
              <span className="text-sm text-blue-100">
                Prazo estimado:{' '}
                <strong className="text-white">{product.estimated_deadline_days} dias úteis</strong>
              </span>
            </div>
          </div>

          {/* Pharmacy */}
          {product.pharmacies && (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-100">
                <MapPin className="h-4 w-4 text-teal-700" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Fornecido por</p>
                <p className="text-sm font-semibold text-gray-900">
                  {product.pharmacies.trade_name}
                </p>
                <p className="text-xs text-gray-400">
                  {product.pharmacies.city}, {product.pharmacies.state}
                </p>
              </div>
            </div>
          )}

          {/* CTA */}
          <ButtonLink
            href={`/orders/new?product=${product.id}`}
            size="lg"
            className="w-full text-base"
          >
            <ShoppingCart className="mr-2 h-5 w-5" />
            Solicitar pedido
          </ButtonLink>

          {/* Trust signals */}
          <div className="grid grid-cols-2 gap-2">
            {[
              'Produto manipulado certificado',
              'Preço fixo garantido',
              'Entrega rastreada para clínica',
              'Plataforma B2B fechada',
            ].map((item) => (
              <div key={item} className="flex items-center gap-1.5 text-xs text-gray-500">
                <CheckCircle className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Details section */}
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Description */}
        {product.long_description && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Descrição completa</h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-600">
              {product.long_description}
            </p>
          </div>
        )}

        {/* Characteristics */}
        {Object.keys(characteristics).length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Características</h2>
            <dl className="space-y-2">
              {Object.entries(characteristics).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs tracking-wide text-gray-500 uppercase">{key}</dt>
                  <dd className="text-sm font-medium text-gray-800">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}
