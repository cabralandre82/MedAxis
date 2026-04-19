'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationProps {
  total: number
  pageSize: number
  currentPage: number
}

export function Pagination({ total, pageSize, currentPage }: PaginationProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(total / pageSize)

  if (totalPages <= 1) return null

  function buildHref(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    return `${pathname}?${params.toString()}`
  }

  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (currentPage > 3) pages.push('...')
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      pages.push(i)
    }
    if (currentPage < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  const btnBase = 'flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors'
  const btnActive = 'bg-[hsl(196,91%,33%)] text-white font-semibold'
  const btnInactive = 'border border-gray-200 text-gray-600 hover:bg-gray-50'
  const btnDisabled = 'text-gray-300 cursor-not-allowed border border-gray-100'

  return (
    <div className="flex items-center justify-between px-1 py-3">
      <p className="text-xs text-gray-500">
        {Math.min((currentPage - 1) * pageSize + 1, total)}–
        {Math.min(currentPage * pageSize, total)} de {total}
      </p>

      <nav className="flex items-center gap-1" aria-label="Paginação">
        {currentPage > 1 ? (
          <>
            <Link href={buildHref(1)} className={`${btnBase} ${btnInactive}`} title="Primeira">
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={buildHref(currentPage - 1)}
              className={`${btnBase} ${btnInactive}`}
              title="Anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
          </>
        ) : (
          <>
            <span className={`${btnBase} ${btnDisabled}`}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </span>
            <span className={`${btnBase} ${btnDisabled}`}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </span>
          </>
        )}

        {pages.map((p, i) =>
          p === '...' ? (
            <span
              key={`ellipsis-${i}`}
              className="flex h-8 w-6 items-center justify-center text-xs text-gray-400"
            >
              …
            </span>
          ) : (
            <Link
              key={p}
              href={buildHref(p)}
              className={`${btnBase} ${p === currentPage ? btnActive : btnInactive}`}
            >
              {p}
            </Link>
          )
        )}

        {currentPage < totalPages ? (
          <>
            <Link
              href={buildHref(currentPage + 1)}
              className={`${btnBase} ${btnInactive}`}
              title="Próxima"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={buildHref(totalPages)}
              className={`${btnBase} ${btnInactive}`}
              title="Última"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Link>
          </>
        ) : (
          <>
            <span className={`${btnBase} ${btnDisabled}`}>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <span className={`${btnBase} ${btnDisabled}`}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </span>
          </>
        )}
      </nav>
    </div>
  )
}
