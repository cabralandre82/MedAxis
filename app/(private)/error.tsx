'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import Link from 'next/link'
import { captureError } from '@/lib/monitoring'

/**
 * Error boundary for the private (authenticated) area.
 * Catches rendering errors in any page inside (private)/ without
 * taking down the entire app or showing a blank screen.
 */
export default function PrivateError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureError(error, { action: 'page_render' })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>

        <h1 className="mb-2 text-xl font-bold text-gray-900">Algo deu errado</h1>
        <p className="mb-6 text-sm text-gray-500">
          Ocorreu um erro ao carregar esta página. Se o problema persistir, entre em contato com o
          suporte.
        </p>

        {error.digest && (
          <p className="mb-6 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-400">
            Código de erro: {error.digest}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={reset}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>
          <Link
            href="/dashboard"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[hsl(196,91%,36%)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            <Home className="h-4 w-4" />
            Ir ao dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
