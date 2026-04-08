'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { doctorSchema, type DoctorFormData } from '@/lib/validators'
import { createDoctor, updateDoctor } from '@/services/doctors'
import type { Doctor } from '@/types'

interface DoctorFormProps {
  doctor?: Doctor
}

export function DoctorForm({ doctor }: DoctorFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const isEditing = !!doctor

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DoctorFormData>({
    resolver: zodResolver(doctorSchema),
    defaultValues: doctor
      ? {
          full_name: doctor.full_name,
          crm: doctor.crm,
          crm_state: doctor.crm_state,
          specialty: doctor.specialty ?? '',
          email: doctor.email,
          phone: doctor.phone ?? '',
        }
      : undefined,
  })

  async function onSubmit(data: DoctorFormData) {
    setLoading(true)
    try {
      if (isEditing && doctor) {
        const result = await updateDoctor(doctor.id, data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Médico atualizado com sucesso!')
        router.push(`/doctors/${doctor.id}`)
      } else {
        const result = await createDoctor(data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Médico cadastrado com sucesso!')
        router.push(`/doctors/${result.id}`)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
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
          <Label htmlFor="crm">CRM *</Label>
          <Input id="crm" placeholder="123456" {...register('crm')} />
          {errors.crm && <p className="text-sm text-red-500">{errors.crm.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="crm_state">UF do CRM *</Label>
          <Input id="crm_state" maxLength={2} placeholder="SP" {...register('crm_state')} />
          {errors.crm_state && <p className="text-sm text-red-500">{errors.crm_state.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="specialty">Especialidade</Label>
          <Input id="specialty" placeholder="Ex: Dermatologia" {...register('specialty')} />
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
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Cadastrar médico'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
