'use client'

/**
 * Global error boundary — catches errors in the root layout.
 * This replaces the browser's default blank screen with a recovery UI.
 * Must be 'use client' and include its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-4 text-5xl">⚠️</div>
            <h1 className="mb-2 text-xl font-bold text-gray-900">Erro inesperado</h1>
            <p className="mb-6 text-sm text-gray-500">
              Ocorreu um problema crítico. Nossa equipe foi notificada automaticamente.
            </p>
            {error.digest && (
              <p className="mb-6 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-400">
                ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              className="w-full rounded-lg bg-[hsl(196,91%,33%)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
