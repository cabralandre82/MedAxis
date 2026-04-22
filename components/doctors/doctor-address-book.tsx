'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MapPin, Plus, Pencil, Trash2, Star, Loader2, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  upsertDoctorAddress,
  deleteDoctorAddress,
  setDefaultDoctorAddress,
} from '@/services/doctor-addresses'
import type { DoctorAddress } from '@/types'

interface Props {
  addresses: DoctorAddress[]
  doctorId: string
}

const EMPTY_FORM = {
  label: '',
  address_line_1: '',
  address_line_2: '',
  city: '',
  state: '',
  zip_code: '',
  is_default: false,
}

type FormData = typeof EMPTY_FORM

export function DoctorAddressBook({ addresses }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

  function openNew() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(addr: DoctorAddress) {
    setEditingId(addr.id)
    setForm({
      label: addr.label,
      address_line_1: addr.address_line_1,
      address_line_2: addr.address_line_2 ?? '',
      city: addr.city,
      state: addr.state,
      zip_code: addr.zip_code,
      is_default: addr.is_default,
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await upsertDoctorAddress(form, editingId ?? undefined)
    setSaving(false)
    if (error) {
      toast.error(error)
      return
    }
    toast.success(editingId ? 'Endereço atualizado' : 'Endereço salvo')
    closeForm()
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este endereço?')) return
    setDeletingId(id)
    const { error } = await deleteDoctorAddress(id)
    setDeletingId(null)
    if (error) toast.error(error)
    else {
      toast.success('Endereço excluído')
      router.refresh()
    }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id)
    const { error } = await setDefaultDoctorAddress(id)
    setSettingDefaultId(null)
    if (error) toast.error(error)
    else {
      toast.success('Endereço padrão atualizado')
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* List */}
      {addresses.length === 0 && !showForm && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-200 py-12 text-gray-400">
          <MapPin className="h-10 w-10" />
          <p className="text-sm">Nenhum endereço cadastrado ainda.</p>
        </div>
      )}

      {addresses.map((addr) => (
        <div
          key={addr.id}
          className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{addr.label}</p>
                {addr.is_default && (
                  <span className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    <Star className="h-2.5 w-2.5" />
                    padrão
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-600">
                {addr.address_line_1}
                {addr.address_line_2 ? `, ${addr.address_line_2}` : ''}
              </p>
              <p className="text-sm text-gray-500">
                {addr.city}/{addr.state} — CEP {addr.zip_code}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {!addr.is_default && (
              <button
                type="button"
                onClick={() => handleSetDefault(addr.id)}
                disabled={settingDefaultId === addr.id}
                aria-label="Definir este endereço como padrão"
                title="Definir como padrão"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-blue-600 disabled:opacity-40"
              >
                {settingDefaultId === addr.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Star className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => openEdit(addr)}
              aria-label="Editar endereço"
              title="Editar"
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleDelete(addr.id)}
              disabled={deletingId === addr.id}
              aria-label="Excluir endereço"
              title="Excluir"
              className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              {deletingId === addr.id ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      ))}

      {/* Add button */}
      {!showForm && (
        <Button variant="outline" onClick={openNew} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Adicionar endereço
        </Button>
      )}

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              {editingId ? 'Editar endereço' : 'Novo endereço'}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Fechar formulário"
              title="Fechar"
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <form onSubmit={handleSave} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="addr-label">Rótulo</Label>
              <Input
                id="addr-label"
                placeholder='Ex: "Consultório", "Residência"'
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="addr-line1">Endereço *</Label>
              <Input
                id="addr-line1"
                placeholder="Rua, número"
                value={form.address_line_1}
                onChange={(e) => setForm((f) => ({ ...f, address_line_1: e.target.value }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="addr-line2">Complemento</Label>
              <Input
                id="addr-line2"
                placeholder="Sala, andar (opcional)"
                value={form.address_line_2}
                onChange={(e) => setForm((f) => ({ ...f, address_line_2: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="addr-city">Cidade *</Label>
              <Input
                id="addr-city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="addr-state">UF *</Label>
                <Input
                  id="addr-state"
                  maxLength={2}
                  placeholder="SP"
                  className="uppercase"
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="addr-zip">CEP *</Label>
                <Input
                  id="addr-zip"
                  placeholder="00000-000"
                  value={form.zip_code}
                  onChange={(e) => setForm((f) => ({ ...f, zip_code: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                id="addr-default"
                checked={form.is_default}
                onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <Label htmlFor="addr-default" className="cursor-pointer font-normal">
                Definir como endereço padrão
              </Label>
            </div>

            <div className="flex justify-end gap-2 border-t border-blue-100 pt-3 sm:col-span-2">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                {editingId ? 'Salvar alterações' : 'Salvar endereço'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
