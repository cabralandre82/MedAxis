'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CursorPaginationProps {
  /** ISO string cursor for the next page (created_at of last item). Null = no next page. */
  nextCursor: string | null
  /** ISO string cursor for the previous page (created_at of first item). Null = on first page. */
  prevCursor: string | null
  pageSize: number
  resultCount: number
}

const linkClass = cn(
  'inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5',
  'text-sm font-medium text-foreground transition-colors hover:bg-muted'
)

export function CursorPagination({
  nextCursor,
  prevCursor,
  pageSize: _pageSize,
  resultCount,
}: CursorPaginationProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function buildHref(cursor: string | null, direction: 'after' | 'before') {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('after')
    params.delete('before')
    if (cursor) params.set(direction, cursor)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const isFirstPage = !prevCursor
  const hasMore = !!nextCursor

  if (isFirstPage && !hasMore) return null

  return (
    <nav aria-label="Paginação" className="flex items-center justify-between py-2">
      <p className="text-sm text-gray-500" aria-live="polite">
        Exibindo {resultCount} registro{resultCount !== 1 ? 's' : ''}
      </p>
      <div className="flex gap-2">
        {!isFirstPage && (
          <Link
            href={buildHref(prevCursor, 'before')}
            className={linkClass}
            rel="prev"
            aria-label="Ir para a página anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Anterior
          </Link>
        )}
        {hasMore && (
          <Link
            href={buildHref(nextCursor, 'after')}
            className={linkClass}
            rel="next"
            aria-label="Ir para a próxima página"
          >
            Próxima
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </nav>
  )
}
