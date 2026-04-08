'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { clinicSchema, type ClinicFormData } from '@/lib/validators'
import { createClinic, updateClinic } from '@/services/clinics'
import type { Clinic } from '@/types'

interface ClinicFormProps {
  clinic?: Clinic
}

export function ClinicForm({ clinic }: ClinicFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const isEditing = !!clinic

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClinicFormData>({
    resolver: zodResolver(clinicSchema),
    defaultValues: clinic
      ? {
          corporate_name: clinic.corporate_name,
          trade_name: clinic.trade_name,
          cnpj: clinic.cnpj,
          state_registration: clinic.state_registration ?? '',
          email: clinic.email,
          phone: clinic.phone ?? '',
          address_line_1: clinic.address_line_1,
          address_line_2: clinic.address_line_2 ?? '',
          city: clinic.city,
          state: clinic.state,
          zip_code: clinic.zip_code,
          notes: clinic.notes ?? '',
        }
      : undefined,
  })

  async function onSubmit(data: ClinicFormData) {
    setLoading(true)
    try {
      if (isEditing && clinic) {
        const result = await updateClinic(clinic.id, data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Clínica atualizada com sucesso!')
        router.push(`/clinics/${clinic.id}`)
      } else {
        const result = await createClinic(data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Clínica criada com sucesso!')
        router.push(`/clinics/${result.id}`)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="corporate_name">Razão Social *</Label>
          <Input id="corporate_name" {...register('corporate_name')} />
          {errors.corporate_name && (
            <p className="text-sm text-red-500">{errors.corporate_name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="trade_name">Nome Fantasia *</Label>
          <Input id="trade_name" {...register('trade_name')} />
          {errors.trade_name && <p className="text-sm text-red-500">{errors.trade_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cnpj">CNPJ *</Label>
          <Input id="cnpj" placeholder="00.000.000/0000-00" {...register('cnpj')} />
          {errors.cnpj && <p className="text-sm text-red-500">{errors.cnpj.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="state_registration">Inscrição Estadual</Label>
          <Input id="state_registration" {...register('state_registration')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input id="email" type="email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input id="phone" placeholder="(00) 00000-0000" {...register('phone')} />
          {errors.phone && <p className="text-sm text-red-500">{errors.phone.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="zip_code">CEP *</Label>
          <Input id="zip_code" placeholder="00000-000" {...register('zip_code')} />
          {errors.zip_code && <p className="text-sm text-red-500">{errors.zip_code.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="state">UF *</Label>
          <Input id="state" maxLength={2} placeholder="SP" {...register('state')} />
          {errors.state && <p className="text-sm text-red-500">{errors.state.message}</p>}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address_line_1">Endereço *</Label>
          <Input id="address_line_1" {...register('address_line_1')} />
          {errors.address_line_1 && (
            <p className="text-sm text-red-500">{errors.address_line_1.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="address_line_2">Complemento</Label>
          <Input id="address_line_2" {...register('address_line_2')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">Cidade *</Label>
          <Input id="city" {...register('city')} />
          {errors.city && <p className="text-sm text-red-500">{errors.city.message}</p>}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Observações</Label>
          <Textarea id="notes" rows={3} {...register('notes')} />
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar clínica'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
