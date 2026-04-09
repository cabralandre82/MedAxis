'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Save } from 'lucide-react'
import { updateSetting } from '@/services/settings'

interface AppSetting {
  id: string
  key: string
  value_json: unknown
  description: string | null
}

interface SettingsFormProps {
  settings: AppSetting[]
  userId: string
}

const SETTING_LABELS: Record<string, { label: string; hint?: string; unit?: string }> = {
  consultant_commission_rate: {
    label: 'Taxa de comissão dos consultores de vendas (%)',
    hint: 'Percentual sobre o valor total de cada pedido. Aplica-se a todos os consultores.',
    unit: '%',
  },
  platform_name: {
    label: 'Nome da plataforma',
  },
  platform_support_email: {
    label: 'Email de suporte',
  },
}

export function SettingsForm({ settings, userId }: SettingsFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      settings.map((s) => [
        s.key,
        typeof s.value_json === 'string'
          ? s.value_json.replace(/^"|"$/g, '')
          : String(s.value_json),
      ])
    )
  )

  async function handleSave() {
    setLoading(true)
    try {
      for (const setting of settings) {
        const newValue = values[setting.key]
        if (newValue !== undefined) {
          await updateSetting(setting.key, newValue, userId)
        }
      }
      toast.success('Configurações salvas!')
      router.refresh()
    } catch {
      toast.error('Erro ao salvar configurações')
    } finally {
      setLoading(false)
    }
  }

  const financialSettings = settings.filter((s) => ['consultant_commission_rate'].includes(s.key))
  const systemSettings = settings.filter((s) =>
    ['platform_name', 'platform_support_email'].includes(s.key)
  )

  function renderField(setting: AppSetting) {
    const meta = SETTING_LABELS[setting.key]
    return (
      <div key={setting.key} className="space-y-1.5">
        <Label htmlFor={setting.key}>{meta?.label ?? setting.key}</Label>
        {(meta?.hint ?? setting.description) && (
          <p className="text-xs text-gray-500">{meta?.hint ?? setting.description}</p>
        )}
        <div className="flex items-center gap-2">
          <Input
            id={setting.key}
            value={values[setting.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [setting.key]: e.target.value }))}
            className="max-w-xs"
          />
          {meta?.unit && <span className="text-sm text-gray-500">{meta.unit}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {financialSettings.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Parâmetros financeiros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">{financialSettings.map(renderField)}</CardContent>
        </Card>
      )}

      {systemSettings.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">{systemSettings.map(renderField)}</CardContent>
        </Card>
      )}

      <Button onClick={handleSave} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando...
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Salvar configurações
          </>
        )}
      </Button>
    </div>
  )
}
