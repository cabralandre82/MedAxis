import Image from 'next/image'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/ui/button-link'
import { Clock, Package, Star } from 'lucide-react'

export interface ProductCard {
  id: string
  name: string
  slug: string
  concentration: string
  presentation: string
  short_description: string
  price_current: number
  estimated_deadline_days: number
  featured: boolean
  product_categories: { id: string; name: string; slug: string } | null
  pharmacies: { id: string; trade_name: string } | null
  product_images: {
    id: string
    public_url: string | null
    alt_text: string | null
    sort_order: number
  }[]
}

interface CatalogGridProps {
  products: ProductCard[]
}

export function CatalogGrid({ products }: CatalogGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Package className="mb-4 h-16 w-16 text-gray-200" />
        <h3 className="text-lg font-medium text-gray-600">Nenhum produto encontrado</h3>
        <p className="mt-1 text-sm text-gray-400">Tente ajustar os filtros ou a busca</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}

function ProductCard({ product }: { product: ProductCard }) {
  const primaryImage = product.product_images
    ?.sort((a, b) => a.sort_order - b.sort_order)
    .find((img) => img.public_url)

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:border-gray-300 hover:shadow-lg">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-50">
        {primaryImage?.public_url ? (
          <Image
            src={primaryImage.public_url}
            alt={primaryImage.alt_text ?? product.name}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-14 w-14 text-gray-300" />
          </div>
        )}
        {product.featured && (
          <div className="absolute top-2 left-2">
            <Badge className="gap-1 border-0 bg-amber-500 text-xs text-white">
              <Star className="h-3 w-3 fill-current" />
              Destaque
            </Badge>
          </div>
        )}
        {product.product_categories && (
          <div className="absolute top-2 right-2">
            <Badge variant="secondary" className="text-xs">
              {product.product_categories.name}
            </Badge>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex-1">
          <h3 className="mb-1 line-clamp-2 text-sm leading-tight font-semibold text-gray-900">
            {product.name}
          </h3>
          <div className="mt-2 mb-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              {product.concentration}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {product.presentation}
            </span>
          </div>
          <p className="mb-3 line-clamp-2 text-xs text-gray-500">{product.short_description}</p>
        </div>

        {/* Price and deadline */}
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-[hsl(213,75%,24%)]">
              {formatCurrency(product.price_current)}
            </span>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Prazo: {product.estimated_deadline_days} dias úteis</span>
          </div>

          {product.pharmacies && (
            <p className="truncate text-xs text-gray-400">por {product.pharmacies.trade_name}</p>
          )}
        </div>

        <ButtonLink href={`/catalog/${product.slug}`} className="mt-3 w-full" size="sm">
          Ver detalhes
        </ButtonLink>
      </div>
    </div>
  )
}
