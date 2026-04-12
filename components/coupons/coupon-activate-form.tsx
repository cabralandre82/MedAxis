'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'

export function CouponActivateForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/coupons/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao ativar cupom')
      } else {
        setSuccess(true)
        setCode('')
        router.refresh()
      }
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Ex: A3F2B9-1C4D7E"
          maxLength={13}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase placeholder:text-gray-400 placeholder:normal-case focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
          disabled={loading}
        />
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        {success && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Cupom ativado com sucesso! O desconto será aplicado automaticamente nos próximos
            pedidos.
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading || !code.trim()}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Ativar cupom
      </button>
    </form>
  )
}
