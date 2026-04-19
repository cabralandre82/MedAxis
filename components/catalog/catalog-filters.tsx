'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'

interface CatalogFiltersProps {
  categories: { id: string; name: string; slug: string }[]
  pharmacies: { id: string; trade_name: string }[]
  currentCategory?: string
  currentPharmacy?: string
  currentSearch?: string
  currentSort?: string
}

const SORT_OPTIONS = [
  { value: 'featured', label: 'Destaques primeiro' },
  { value: 'name_asc', label: 'Nome A–Z' },
  { value: 'price_asc', label: 'Menor preço' },
  { value: 'price_desc', label: 'Maior preço' },
  { value: 'newest', label: 'Mais recentes' },
]

export function CatalogFilters({
  categories,
  pharmacies,
  currentCategory,
  currentPharmacy,
  currentSearch,
  currentSort = 'featured',
}: CatalogFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(currentSearch ?? '')

  const updateFilter = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('page') // reset to page 1 when filtering
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilter({ search: search || undefined })
  }

  const clearAll = () => {
    setSearch('')
    router.push(pathname)
  }

  const hasFilters = currentCategory || currentPharmacy || currentSearch

  return (
    <div className="space-y-3">
      {/* Search + Sort row */}
      <div className="flex gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por nome, concentração..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={clearAll}
              title="Limpar filtros"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </form>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <select
            value={currentSort}
            onChange={(e) => updateFilter({ sort: e.target.value })}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <span className="mr-1 self-center text-xs text-gray-500">Categoria:</span>
        <button
          onClick={() => updateFilter({ category: undefined })}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            !currentCategory
              ? 'border-[hsl(213,75%,24%)] bg-[hsl(213,75%,24%)] text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
          }`}
        >
          Todos
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() =>
              updateFilter({ category: cat.slug === currentCategory ? undefined : cat.slug })
            }
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              currentCategory === cat.slug
                ? 'border-[hsl(213,75%,24%)] bg-[hsl(213,75%,24%)] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Pharmacy filters */}
      {pharmacies.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <span className="mr-1 self-center text-xs text-gray-500">Farmácia:</span>
          <button
            onClick={() => updateFilter({ pharmacy: undefined })}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              !currentPharmacy
                ? 'border-[hsl(196,91%,33%)] bg-[hsl(196,91%,33%)] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            Todas
          </button>
          {pharmacies.map((ph) => (
            <button
              key={ph.id}
              onClick={() =>
                updateFilter({ pharmacy: ph.id === currentPharmacy ? undefined : ph.id })
              }
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                currentPharmacy === ph.id
                  ? 'border-[hsl(196,91%,33%)] bg-[hsl(196,91%,33%)] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {ph.trade_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
