'use client'

import { useState, useTransition } from 'react'
import { Bell, Lock } from 'lucide-react'
import { SILENCEABLE_TYPES, CRITICAL_TYPES } from '@/lib/notification-types'
import { fetchWithCsrf } from '@/lib/security/client-csrf'

const TYPE_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Novo pedido criado',
  ORDER_STATUS: 'Atualização de status do pedido',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  DOCUMENT_UPLOADED: 'Documento enviado',
  TRANSFER_REGISTERED: 'Repasse à farmácia registrado',
  CONSULTANT_TRANSFER: 'Repasse a consultor',
  PRODUCT_INTEREST: 'Interesse em produto indisponível',
  REGISTRATION_REQUEST: 'Solicitação de cadastro',
  STALE_ORDER: 'Alerta de pedido parado',
}

const TYPE_DESC: Record<string, string> = {
  TRANSFER_REGISTERED: 'Quando um repasse é processado para uma farmácia',
  CONSULTANT_TRANSFER: 'Quando uma comissão de consultor é registrada',
  PRODUCT_INTEREST: 'Quando alguém demonstra interesse em produto indisponível',
  REGISTRATION_REQUEST: 'Quando uma clínica ou médico solicita cadastro',
  STALE_ORDER: 'Quando um pedido fica parado sem movimentação',
}

interface NotificationPreferencesProps {
  initialPreferences: Record<string, boolean>
}

export function NotificationPreferences({ initialPreferences }: NotificationPreferencesProps) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(initialPreferences)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function toggle(type: string) {
    setPrefs((prev) => ({ ...prev, [type]: prev[type] !== false ? false : true }))
    setSaved(false)
    setError('')
  }

  function isEnabled(type: string) {
    return prefs[type] !== false
  }

  async function save() {
    startTransition(async () => {
      try {
        const res = await fetchWithCsrf('/api/profile/notification-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: prefs }),
        })
        if (!res.ok) throw new Error()
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } catch {
        setError('Erro ao salvar preferências. Tente novamente.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Critical (read-only) */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          <Lock className="h-3 w-3" />
          Notificações essenciais (sempre ativas)
        </p>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-gray-50">
          {CRITICAL_TYPES.map((type) => (
            <div key={type} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">{TYPE_LABELS[type] ?? type}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Lock className="h-3 w-3" />
                <span>Obrigatório</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Silenceable */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          <Bell className="h-3 w-3" />
          Notificações configuráveis
        </p>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {SILENCEABLE_TYPES.map((type) => {
            const enabled = isEnabled(type)
            return (
              <div key={type} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1 pr-4">
                  <p
                    className={`text-sm font-medium ${enabled ? 'text-gray-900' : 'text-gray-400'}`}
                  >
                    {TYPE_LABELS[type] ?? type}
                  </p>
                  {TYPE_DESC[type] && (
                    <p className="mt-0.5 text-xs text-gray-400">{TYPE_DESC[type]}</p>
                  )}
                </div>
                <button
                  onClick={() => toggle(type)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none ${
                    enabled ? 'bg-[hsl(213,75%,24%)]' : 'bg-gray-200'
                  }`}
                  role="switch"
                  aria-checked={enabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                      enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-lg bg-[hsl(213,75%,24%)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[hsl(213,75%,20%)] disabled:opacity-50"
        >
          {isPending ? 'Salvando…' : 'Salvar preferências'}
        </button>
        {saved && <p className="text-sm font-medium text-green-600">Salvo com sucesso!</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}
