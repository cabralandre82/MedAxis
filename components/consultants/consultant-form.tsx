'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { salesConsultantSchema, type SalesConsultantFormData } from '@/lib/validators'
import { createConsultant, updateConsultant } from '@/services/consultants'
import type { SalesConsultant } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ConsultantFormProps {
  consultant?: SalesConsultant
}

export function ConsultantForm({ consultant }: ConsultantFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!consultant

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SalesConsultantFormData>({
    resolver: zodResolver(salesConsultantSchema),
    defaultValues: {
      full_name: consultant?.full_name ?? '',
      email: consultant?.email ?? '',
      cnpj: consultant?.cnpj ?? '',
      phone: consultant?.phone ?? '',
      bank_name: consultant?.bank_name ?? '',
      bank_agency: consultant?.bank_agency ?? '',
      bank_account: consultant?.bank_account ?? '',
      pix_key: consultant?.pix_key ?? '',
      notes: consultant?.notes ?? '',
    },
  })

  async function onSubmit(data: SalesConsultantFormData) {
    setError(null)
    const result = isEdit
      ? await updateConsultant(consultant!.id, data)
      : await createConsultant(data)

    if ('error' in result && result.error) {
      setError(result.error)
      return
    }

    router.push(
      isEdit ? `/consultants/${consultant!.id}` : `/consultants/${'id' in result ? result.id : ''}`
    )
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Identificação */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Identificação
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="full_name">Nome completo *</Label>
            <Input id="full_name" {...register('full_name')} />
            {errors.full_name && <p className="text-xs text-red-600">{errors.full_name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cnpj">CNPJ *</Label>
            <Input id="cnpj" placeholder="00.000.000/0000-00" {...register('cnpj')} />
            {errors.cnpj && <p className="text-xs text-red-600">{errors.cnpj.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefone</Label>
            <Input id="phone" placeholder="(11) 99999-9999" {...register('phone')} />
            {errors.phone && <p className="text-xs text-red-600">{errors.phone.message}</p>}
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            A taxa de comissão é global para todos os consultores e é configurada em{' '}
            <strong>Configurações → Taxa de comissão dos consultores</strong>.
          </div>
        </div>
      </section>

      {/* Dados bancários */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Dados bancários
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bank_name">Banco</Label>
            <Input id="bank_name" placeholder="Ex: Nubank, Itaú" {...register('bank_name')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank_agency">Agência</Label>
            <Input id="bank_agency" {...register('bank_agency')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank_account">Conta</Label>
            <Input id="bank_account" {...register('bank_account')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pix_key">Chave PIX</Label>
            <Input
              id="pix_key"
              placeholder="CPF, email, celular ou aleatória"
              {...register('pix_key')}
            />
          </div>
        </div>
      </section>

      {/* Observações */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Observações
        </h2>
        <Textarea
          id="notes"
          rows={3}
          placeholder="Informações internas sobre o consultor..."
          {...register('notes')}
        />
      </section>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Cadastrar consultor'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
