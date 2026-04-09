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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import Link from 'next/link'
import { createUser } from '@/services/users'
import type { Clinic, Pharmacy, SalesConsultant } from '@/types'

const schema = z.object({
  full_name: z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  role: z.enum([
    'SUPER_ADMIN',
    'PLATFORM_ADMIN',
    'CLINIC_ADMIN',
    'DOCTOR',
    'PHARMACY_ADMIN',
    'SALES_CONSULTANT',
  ]),
  clinic_id: z.string().optional(),
  pharmacy_id: z.string().optional(),
  consultant_id: z.string().optional(),
  membership_role: z.enum(['ADMIN', 'STAFF']).optional(),
})

type FormData = z.infer<typeof schema>

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin da Plataforma',
  CLINIC_ADMIN: 'Admin de Clínica',
  DOCTOR: 'Médico',
  PHARMACY_ADMIN: 'Admin de Farmácia',
  SALES_CONSULTANT: 'Consultor de Vendas',
}

interface UserFormProps {
  clinics: Clinic[]
  pharmacies: Pharmacy[]
  consultants: SalesConsultant[]
  isSuperAdmin: boolean
}

export function UserForm({ clinics, pharmacies, consultants, isSuperAdmin }: UserFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'CLINIC_ADMIN' },
  })

  const selectedRole = watch('role')
  const needsClinic = selectedRole === 'CLINIC_ADMIN' || selectedRole === 'DOCTOR'
  const needsPharmacy = selectedRole === 'PHARMACY_ADMIN'
  const needsConsultant = selectedRole === 'SALES_CONSULTANT'

  async function onSubmit(data: FormData) {
    setLoading(true)
    const result = await createUser({
      ...data,
      clinic_id: data.clinic_id || undefined,
      pharmacy_id: data.pharmacy_id || undefined,
      consultant_id: data.consultant_id || undefined,
    })
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Usuário criado com sucesso!')
      router.push(`/users/${result.id}`)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="full_name">Nome Completo *</Label>
          <Input id="full_name" {...register('full_name')} />
          {errors.full_name && <p className="text-sm text-red-500">{errors.full_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input id="email" type="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha inicial *</Label>
          <Input id="password" type="password" {...register('password')} />
          {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
          <p className="text-xs text-gray-400">O usuário deve trocar no primeiro acesso</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="role">Papel *</Label>
          <Select
            defaultValue="CLINIC_ADMIN"
            onValueChange={(v) => setValue('role', v as FormData['role'], { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isSuperAdmin && (
                <>
                  <SelectItem value="SUPER_ADMIN">{ROLE_LABELS.SUPER_ADMIN}</SelectItem>
                  <SelectItem value="PLATFORM_ADMIN">{ROLE_LABELS.PLATFORM_ADMIN}</SelectItem>
                </>
              )}
              <SelectItem value="CLINIC_ADMIN">{ROLE_LABELS.CLINIC_ADMIN}</SelectItem>
              <SelectItem value="DOCTOR">{ROLE_LABELS.DOCTOR}</SelectItem>
              <SelectItem value="PHARMACY_ADMIN">{ROLE_LABELS.PHARMACY_ADMIN}</SelectItem>
              <SelectItem value="SALES_CONSULTANT">{ROLE_LABELS.SALES_CONSULTANT}</SelectItem>
            </SelectContent>
          </Select>
          {errors.role && <p className="text-sm text-red-500">{errors.role.message}</p>}
        </div>

        {needsClinic && (
          <div className="space-y-2">
            <Label htmlFor="clinic_id">Clínica vinculada</Label>
            <Select onValueChange={(v) => setValue('clinic_id', v as string)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma clínica..." />
              </SelectTrigger>
              <SelectContent>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.trade_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {needsPharmacy && (
          <div className="space-y-2">
            <Label htmlFor="pharmacy_id">Farmácia vinculada</Label>
            <Select onValueChange={(v) => setValue('pharmacy_id', v as string)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma farmácia..." />
              </SelectTrigger>
              <SelectContent>
                {pharmacies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.trade_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {needsConsultant && (
          <div className="space-y-2 md:col-span-2">
            <Label>Consultor cadastrado para vincular *</Label>
            <Select onValueChange={(v) => setValue('consultant_id', v as string)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o registro de consultor..." />
              </SelectTrigger>
              <SelectContent>
                {consultants.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              O consultor deve estar cadastrado em{' '}
              <Link href="/consultants/new" className="underline">
                Consultores
              </Link>{' '}
              antes de criar o usuário.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">Importante</p>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-700">
          <li>O usuário receberá acesso imediato com as credenciais fornecidas</li>
          <li>Recomende que o usuário troque a senha no primeiro acesso</li>
          <li>A senha não pode ser recuperada após a criação</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Criando usuário...' : 'Criar usuário'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
