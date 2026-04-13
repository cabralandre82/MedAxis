'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createOrder } from '@/services/orders'
import { resolveDoctorFieldState } from '@/lib/orders/doctor-field-rules'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Loader2, Package, Upload, X, FileText, Plus, Trash2, UserPlus } from 'lucide-react'
import Link from 'next/link'

export interface NewOrderFormProduct {
  id: string
  name: string
  concentration: string
  presentation: string
  price_current: number
  estimated_deadline_days: number
  requires_prescription: boolean
  pharmacy_id: string
  pharmacies: { id: string; trade_name: string } | null
  product_images: { id: string; public_url: string | null; sort_order: number }[]
}

interface CartItem {
  product: NewOrderFormProduct
  quantity: number
}

interface NewOrderFormProps {
  initialProduct?: NewOrderFormProduct
  availableProducts: NewOrderFormProduct[]
  /** Clinic already resolved from the logged-in user's membership — no dropdown shown. */
  resolvedClinic: { id: string; trade_name: string } | null
  /** When the user is admin or a doctor linked to multiple clinics, show a selector. */
  adminClinics: { id: string; trade_name: string }[] | null
  doctors: { id: string; full_name: string; crm: string; crm_state: string }[]
  /** Whether the current user is a CLINIC_ADMIN (shows doctor shortcut links). */
  isClinicAdmin?: boolean
  /** Pre-populated cart items restored from URL (e.g. after navigating to /doctors/new). */
  initialCart?: { productId: string; quantity: number }[]
}

export function NewOrderForm({
  initialProduct,
  availableProducts,
  resolvedClinic,
  adminClinics,
  doctors,
  isClinicAdmin = false,
  initialCart,
}: NewOrderFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [documents, setDocuments] = useState<File[]>([])
  const [clinicId, setClinicId] = useState(resolvedClinic?.id ?? '')
  const [doctorId, setDoctorId] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Cart — restored from initialCart (URL param) or seeded with initialProduct
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (initialCart && initialCart.length > 0) {
      return initialCart.flatMap(({ productId, quantity }) => {
        const product = availableProducts.find((p) => p.id === productId)
        return product ? [{ product, quantity }] : []
      })
    }
    return initialProduct ? [{ product: initialProduct, quantity: 1 }] : []
  })
  const [selectedProductId, setSelectedProductId] = useState('')
  const [addQty, setAddQty] = useState(1)

  // Products not yet in cart (same pharmacy if cart not empty)
  const cartPharmacyId = cart[0]?.product.pharmacy_id
  const eligibleProducts = availableProducts.filter(
    (p) =>
      !cart.some((c) => c.product.id === p.id) &&
      (!cartPharmacyId || p.pharmacy_id === cartPharmacyId)
  )

  function addToCart() {
    const product = availableProducts.find((p) => p.id === selectedProductId)
    if (!product) return
    if (addQty < 1) return
    setCart((prev) => [...prev, { product, quantity: addQty }])
    setSelectedProductId('')
    setAddQty(1)
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((c) => c.product.id !== productId))
  }

  function updateQty(productId: string, qty: number) {
    if (qty < 1) return
    setCart((prev) => prev.map((c) => (c.product.id === productId ? { ...c, quantity: qty } : c)))
  }

  const total = cart.reduce((sum, c) => sum + c.product.price_current * c.quantity, 0)
  const maxDeadline = Math.max(0, ...cart.map((c) => c.product.estimated_deadline_days))
  const pharmacyName = cart[0]?.product.pharmacies?.trade_name ?? '—'

  const { show: showDoctorField, required: doctorRequired } = resolveDoctorFieldState(
    cart.map((c) => ({ requires_prescription: c.product.requires_prescription })),
    doctors
  )

  // Serializes the current cart into the /doctors/new URL so the cart is
  // restored when the user navigates back to /orders/new.
  function doctorNewUrl() {
    const cartParam = cart.map((c) => `${c.product.id}:${c.quantity}`).join(',')
    return cartParam ? `/doctors/new?cart=${encodeURIComponent(cartParam)}` : '/doctors/new'
  }

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setDocuments((prev) => [...prev, ...files])
    e.target.value = ''
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!clinicId) newErrors.clinic_id = 'Selecione a clínica'
    if (doctorRequired && !doctorId) newErrors.doctor_id = 'Selecione o médico solicitante'
    if (cart.length === 0) newErrors.items = 'Adicione ao menos um produto'
    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }
    setErrors({})

    setLoading(true)
    try {
      const result = await createOrder({
        clinic_id: clinicId,
        doctor_id: doctorId,
        notes: notes || undefined,
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
        documents,
      })

      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Pedido criado com sucesso!')
      router.push(`/orders/${result.orderId}`)
    } catch {
      toast.error('Erro ao criar pedido. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Cart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Produtos do pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cart.length === 0 && (
            <p className="text-sm text-gray-400">Nenhum produto adicionado ainda.</p>
          )}

          {cart.map((item) => (
            <div
              key={item.product.id}
              className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border bg-white">
                <Package className="h-5 w-5 text-blue-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{item.product.name}</p>
                <p className="text-xs text-gray-500">
                  {item.product.concentration} · {formatCurrency(item.product.price_current)}/un
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateQty(item.product.id, parseInt(e.target.value))}
                  className="w-20 text-center"
                />
                <span className="w-24 text-right text-sm font-semibold text-slate-700">
                  {formatCurrency(item.product.price_current * item.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.product.id)}
                  className="text-gray-300 transition-colors hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {errors.items && <p className="text-xs text-red-500">{errors.items}</p>}

          {/* Add product row */}
          {eligibleProducts.length > 0 && (
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-gray-500">Adicionar produto</Label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                >
                  <option value="">Selecione...</option>
                  {eligibleProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.price_current)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Qtd</Label>
                <Input
                  type="number"
                  min={1}
                  value={addQty}
                  onChange={(e) => setAddQty(parseInt(e.target.value))}
                  className="w-20 text-center"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addToCart}
                disabled={!selectedProductId}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          {cartPharmacyId && (
            <p className="text-xs text-slate-400">
              Farmácia: <span className="font-medium text-slate-600">{pharmacyName}</span>
              {' · '}Todos os produtos devem ser da mesma farmácia
            </p>
          )}
        </CardContent>
      </Card>

      {/* Order data */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Dados do pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Clinic — shown as read-only badge when resolved, or as selector for admins */}
          {resolvedClinic ? (
            <div className="space-y-1.5">
              <Label>Clínica</Label>
              <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {resolvedClinic.trade_name}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="clinic_id">Clínica *</Label>
              <select
                id="clinic_id"
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                <option value="">Selecione a clínica...</option>
                {(adminClinics ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.trade_name}
                  </option>
                ))}
              </select>
              {errors.clinic_id && <p className="text-xs text-red-500">{errors.clinic_id}</p>}
            </div>
          )}

          {/* Doctor field or shortcut when clinic has no linked doctors */}
          {showDoctorField ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="doctor_id">
                  Médico solicitante{' '}
                  {doctorRequired ? (
                    '*'
                  ) : (
                    <span className="font-normal text-gray-400">(opcional)</span>
                  )}
                </Label>
                {isClinicAdmin && (
                  <Link
                    href={doctorNewUrl()}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <UserPlus className="h-3 w-3" />
                    Cadastrar novo médico
                  </Link>
                )}
              </div>
              <select
                id="doctor_id"
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                <option value="">Selecione o médico...</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name} — CRM {d.crm}/{d.crm_state}
                  </option>
                ))}
              </select>
              {errors.doctor_id && <p className="text-xs text-red-500">{errors.doctor_id}</p>}
            </div>
          ) : (
            isClinicAdmin && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">Nenhum médico vinculado</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  Para pedir produtos com receita, vincule um médico à sua clínica.
                </p>
                <div className="mt-2 flex gap-3">
                  <Link
                    href={doctorNewUrl()}
                    className="flex items-center gap-1 text-xs font-medium text-amber-900 underline hover:no-underline"
                  >
                    <UserPlus className="h-3 w-3" />
                    Cadastrar novo médico
                  </Link>
                  <Link
                    href="/doctors"
                    className="text-xs font-medium text-amber-900 underline hover:no-underline"
                  >
                    Ver médicos disponíveis
                  </Link>
                </div>
              </div>
            )
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              placeholder="Informações adicionais para o pedido (opcional)"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Documentação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-500">
            Anexe a prescrição médica e demais documentos obrigatórios.
          </p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 p-5 transition-colors hover:border-blue-400 hover:bg-blue-50/50">
            <Upload className="h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-500">Clique para anexar (PDF, JPG, PNG)</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleFileAdd}
            />
          </label>
          {documents.length > 0 && (
            <ul className="space-y-2">
              {documents.map((file, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="flex-1 truncate text-sm text-gray-700">{file.name}</span>
                  <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => setDocuments((p) => p.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {cart.length > 0 && (
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="p-5">
            <h3 className="mb-3 font-semibold text-gray-900">Resumo do pedido</h3>
            <div className="space-y-2 text-sm">
              {cart.map((item) => (
                <div key={item.product.id} className="flex justify-between">
                  <span className="max-w-[200px] truncate text-gray-500">
                    {item.product.name} ×{item.quantity}
                  </span>
                  <span className="ml-4 text-gray-900">
                    {formatCurrency(item.product.price_current * item.quantity)}
                  </span>
                </div>
              ))}
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span className="text-[hsl(213,75%,24%)]">{formatCurrency(total)}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Prazo estimado: {maxDeadline} dias úteis após liberação
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={loading || cart.length === 0}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Criando pedido...
          </>
        ) : (
          `Confirmar pedido${cart.length > 1 ? ` (${cart.length} produtos)` : ''}`
        )}
      </Button>
    </form>
  )
}
