'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateOwnProfile } from '@/services/users'
import type { ProfileWithRoles } from '@/types'

const schema = z.object({
  full_name: z.string().min(2, 'Nome é obrigatório'),
  phone: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface ProfileFormProps {
  user: ProfileWithRoles
}

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: user.full_name,
      phone: user.phone ?? '',
    },
  })

  async function onSubmit(data: FormData) {
    setLoading(true)
    const result = await updateOwnProfile(user.id, {
      full_name: data.full_name,
      phone: data.phone || undefined,
    })
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Perfil atualizado com sucesso!')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <h2 className="font-semibold text-gray-900">Informações Pessoais</h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="full_name">Nome completo *</Label>
          <Input id="full_name" {...register('full_name')} />
          {errors.full_name && <p className="text-sm text-red-500">{errors.full_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={user.email} disabled className="bg-gray-50 text-gray-500" />
          <p className="text-xs text-gray-400">O email não pode ser alterado</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" placeholder="(00) 00000-0000" {...register('phone')} />
        </div>
      </div>

      <Button type="submit" disabled={loading || !isDirty}>
        {loading ? 'Salvando...' : 'Salvar alterações'}
      </Button>
    </form>
  )
}
