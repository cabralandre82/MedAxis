'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateOwnProfile } from '@/services/users'

interface ProfileFormProps {
  userId: string
  defaultValues: {
    full_name: string
    phone: string
  }
}

export function ProfileForm({ userId, defaultValues }: ProfileFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [fullName, setFullName] = useState(defaultValues.full_name)
  const [phone, setPhone] = useState(defaultValues.phone)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!fullName.trim()) {
      toast.error('O nome não pode ficar em branco')
      return
    }

    startTransition(async () => {
      const result = await updateOwnProfile(userId, {
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
      })

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Perfil atualizado com sucesso!')
      router.refresh()
    })
  }

  const hasChanges =
    fullName.trim() !== defaultValues.full_name || phone.trim() !== (defaultValues.phone ?? '')

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Nome completo</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Seu nome completo"
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Telefone</Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(11) 99999-9999"
          type="tel"
          disabled={isPending}
        />
        <p className="text-xs text-gray-400">Armazenado de forma criptografada.</p>
      </div>

      <div className="pt-1">
        <Button type="submit" disabled={isPending || !hasChanges} className="gap-2">
          <Save className="h-4 w-4" />
          {isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  )
}
