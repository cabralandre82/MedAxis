'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/client'
import { Search, Package, Building2, UserCheck, ClipboardList, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface SearchResult {
  id: string
  type: 'order' | 'clinic' | 'doctor' | 'product'
  title: string
  subtitle?: string
  href: string
}

const TYPE_CONFIG = {
  order: { icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Pedido' },
  clinic: { icon: Building2, color: 'text-green-600', bg: 'bg-green-50', label: 'Clínica' },
  doctor: { icon: UserCheck, color: 'text-teal-600', bg: 'bg-teal-50', label: 'Médico' },
  product: { icon: Package, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Produto' },
}

export function GlobalSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    const supabase = createClient()
    const term = `%${q}%`

    const [ordersRes, clinicsRes, doctorsRes, productsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, code, total_price, clinics(trade_name)')
        .ilike('code', term)
        .limit(4),
      supabase
        .from('clinics')
        .select('id, trade_name, cnpj, city, state')
        .or(`trade_name.ilike.${term},cnpj.ilike.${term}`)
        .limit(4),
      supabase
        .from('doctors')
        .select('id, full_name, crm, specialty')
        .or(`full_name.ilike.${term},crm.ilike.${term}`)
        .limit(4),
      supabase
        .from('products')
        .select('id, name, concentration, price_current')
        .or(`name.ilike.${term},sku.ilike.${term}`)
        .eq('active', true)
        .limit(4),
    ])

    const items: SearchResult[] = [
      ...(ordersRes.data ?? []).map((o) => ({
        id: o.id,
        type: 'order' as const,
        title: o.code,
        subtitle: `${(o.clinics as { trade_name?: string } | null)?.trade_name ?? '—'} · ${formatCurrency(Number(o.total_price))}`,
        href: `/orders/${o.id}`,
      })),
      ...(clinicsRes.data ?? []).map((c) => ({
        id: c.id,
        type: 'clinic' as const,
        title: c.trade_name,
        subtitle: `${c.cnpj ?? ''} · ${c.city ?? ''}, ${c.state ?? ''}`.replace(
          /^[· ,]+|[· ,]+$/g,
          ''
        ),
        href: `/clinics/${c.id}`,
      })),
      ...(doctorsRes.data ?? []).map((d) => ({
        id: d.id,
        type: 'doctor' as const,
        title: d.full_name,
        subtitle: `CRM ${d.crm ?? '—'} · ${d.specialty ?? '—'}`,
        href: `/doctors/${d.id}`,
      })),
      ...(productsRes.data ?? []).map((p) => ({
        id: p.id,
        type: 'product' as const,
        title: p.name,
        subtitle: `${p.concentration ?? ''} · ${formatCurrency(Number(p.price_current))}`.replace(
          /^[· ]+/,
          ''
        ),
        href: `/products/${p.id}`,
      })),
    ]

    setResults(items)
    setOpen(items.length > 0)
    setSelectedIdx(-1)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, search])

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard ⌘K to open
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(results.length > 0)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [results.length])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, -1))
      return
    }
    if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) {
      e.preventDefault()
      navigate(results[selectedIdx])
    }
  }

  function navigate(result: SearchResult) {
    setOpen(false)
    setQuery('')
    router.push(result.href)
  }

  function clear() {
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className="relative w-64" role="search">
      <div className="relative">
        <Search
          className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <label htmlFor="global-search-input" className="sr-only">
          Busca global da plataforma
        </label>
        <input
          ref={inputRef}
          id="global-search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar… ⌘K"
          aria-label="Busca global"
          className="h-9 w-full rounded-lg border border-gray-200 bg-white pr-8 pl-8 text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-[hsl(196,91%,33%)] focus:outline-none"
        />
        {(query || loading) && (
          <button
            type="button"
            onClick={clear}
            aria-label={loading ? 'Carregando resultados' : 'Limpar busca'}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          >
            {loading ? (
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600"
                aria-hidden="true"
              />
            ) : (
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          id="global-search-results"
          className="absolute top-11 left-0 z-50 w-96 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          <div className="divide-y divide-gray-50">
            {results.map((result, idx) => {
              const cfg = TYPE_CONFIG[result.type]
              const Icon = cfg.icon
              return (
                <button
                  type="button"
                  key={result.id}
                  onClick={() => navigate(result)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    idx === selectedIdx ? 'bg-gray-50' : ''
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${cfg.bg}`}
                    aria-hidden="true"
                  >
                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{result.title}</p>
                    {result.subtitle && (
                      <p className="truncate text-xs text-gray-500">{result.subtitle}</p>
                    )}
                  </div>
                  <span
                    className={`flex-shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}
                  >
                    {cfg.label}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-gray-100 px-4 py-2">
            <p className="text-[10px] text-gray-400">↑↓ navegar · Enter selecionar · Esc fechar</p>
          </div>
        </div>
      )}
    </div>
  )
}
