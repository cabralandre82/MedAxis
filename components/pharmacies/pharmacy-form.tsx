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
import { pharmacySchema, type PharmacyFormData } from '@/lib/validators'
import { createPharmacy, updatePharmacy } from '@/services/pharmacies'
import type { EntityType, Pharmacy } from '@/types'

interface PharmacyFormProps {
  pharmacy?: Pharmacy
  /** Lock CNPJ field (pharmacy admin cannot change legal identifier) */
  disableCnpj?: boolean
  /** Where to navigate after a successful save (default: /pharmacies/:id) */
  redirectAfterSave?: string
  /** Controls entity_type on creation. Defaults to PHARMACY. */
  entityType?: EntityType
  /** Where to redirect the list page after creation */
  listPath?: string
}

export function PharmacyForm({
  pharmacy,
  disableCnpj,
  redirectAfterSave,
  entityType = 'PHARMACY',
  listPath = '/pharmacies',
}: PharmacyFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const isEditing = !!pharmacy
  const isDistributor = entityType === 'DISTRIBUTOR'

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PharmacyFormData>({
    resolver: zodResolver(pharmacySchema),
    defaultValues: pharmacy
      ? {
          corporate_name: pharmacy.corporate_name,
          trade_name: pharmacy.trade_name,
          cnpj: pharmacy.cnpj,
          email: pharmacy.email,
          phone: pharmacy.phone ?? '',
          address_line_1: pharmacy.address_line_1,
          address_line_2: pharmacy.address_line_2 ?? '',
          city: pharmacy.city,
          state: pharmacy.state,
          zip_code: pharmacy.zip_code,
          responsible_person: pharmacy.responsible_person,
          bank_name: pharmacy.bank_name ?? '',
          bank_branch: pharmacy.bank_branch ?? '',
          bank_account: pharmacy.bank_account ?? '',
          pix_key: pharmacy.pix_key ?? '',
          notes: pharmacy.notes ?? '',
        }
      : undefined,
  })

  async function onSubmit(data: PharmacyFormData) {
    setLoading(true)
    try {
      if (isEditing && pharmacy) {
        const result = await updatePharmacy(pharmacy.id, data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success(
          isDistributor
            ? 'Distribuidora atualizada com sucesso!'
            : 'Farmácia atualizada com sucesso!'
        )
        router.push(redirectAfterSave ?? `${listPath}/${pharmacy.id}`)
      } else {
        const result = await createPharmacy({ ...data, entity_type: entityType })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success(
          isDistributor
            ? 'Distribuidora cadastrada com sucesso!'
            : 'Farmácia cadastrada com sucesso!'
        )
        router.push(`${listPath}/${result.id}`)
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Dados Cadastrais
        </h3>
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
            {errors.trade_name && (
              <p className="text-sm text-red-500">{errors.trade_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cnpj">CNPJ *</Label>
            <Input
              id="cnpj"
              placeholder="00.000.000/0000-00"
              disabled={disableCnpj}
              className={disableCnpj ? 'bg-gray-50 text-gray-500' : undefined}
              {...register('cnpj')}
            />
            {disableCnpj && <p className="text-xs text-gray-400">O CNPJ não pode ser alterado.</p>}
            {errors.cnpj && <p className="text-sm text-red-500">{errors.cnpj.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="responsible_person">Responsável *</Label>
            <Input id="responsible_person" {...register('responsible_person')} />
            {errors.responsible_person && (
              <p className="text-sm text-red-500">{errors.responsible_person.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input id="phone" placeholder="(00) 00000-0000" {...register('phone')} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Endereço
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="address_line_1">Logradouro *</Label>
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
            <Label htmlFor="zip_code">CEP *</Label>
            <Input id="zip_code" placeholder="00000-000" {...register('zip_code')} />
            {errors.zip_code && <p className="text-sm text-red-500">{errors.zip_code.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Cidade *</Label>
            <Input id="city" {...register('city')} />
            {errors.city && <p className="text-sm text-red-500">{errors.city.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">UF *</Label>
            <Input id="state" maxLength={2} placeholder="SP" {...register('state')} />
            {errors.state && <p className="text-sm text-red-500">{errors.state.message}</p>}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold tracking-wider text-gray-700 uppercase">
          Dados Bancários
        </h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bank_name">Banco</Label>
            <Input id="bank_name" {...register('bank_name')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bank_branch">Agência</Label>
            <Input id="bank_branch" {...register('bank_branch')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bank_account">Conta</Label>
            <Input id="bank_account" {...register('bank_account')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix_key">Chave PIX</Label>
            <Input id="pix_key" {...register('pix_key')} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" rows={3} {...register('notes')} />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading
            ? 'Salvando...'
            : isEditing
              ? 'Salvar alterações'
              : isDistributor
                ? 'Cadastrar distribuidora'
                : 'Cadastrar farmácia'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
