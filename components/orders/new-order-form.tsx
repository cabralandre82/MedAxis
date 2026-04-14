'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createOrder, type OrderDocument } from '@/services/orders'
import { resolveDoctorFieldState } from '@/lib/orders/doctor-field-rules'
import { REQUIRED_DOCUMENT_TYPES } from '@/components/orders/document-manager'
import { formatCurrency, cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  Package,
  Upload,
  X,
  FileText,
  Plus,
  Trash2,
  UserPlus,
  Building2,
  User,
  MapPin,
  PlusCircle,
} from 'lucide-react'
import Link from 'next/link'
import type { DoctorAddress } from '@/types'

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
  /** When the logged-in user is a DOCTOR: their own doctor record ID. */
  myDoctorId?: string
  /** Saved delivery addresses for the logged-in doctor. */
  myAddresses?: DoctorAddress[]
  /** Clinics the doctor is linked to (for clinic purchase option). */
  myDoctorClinics?: { id: string; trade_name: string }[]
}

export function NewOrderForm({
  initialProduct,
  availableProducts,
  resolvedClinic,
  adminClinics,
  doctors,
  isClinicAdmin = false,
  initialCart,
  myDoctorId,
  myAddresses = [],
  myDoctorClinics = [],
}: NewOrderFormProps) {
  const router = useRouter()
  const isDoctor = !!myDoctorId

  const [loading, setLoading] = useState(false)
  const [documents, setDocuments] = useState<OrderDocument[]>([])
  // buyer_type: doctors default to solo purchase; others always CLINIC
  const [buyerType, setBuyerType] = useState<'CLINIC' | 'DOCTOR'>(isDoctor ? 'DOCTOR' : 'CLINIC')
  const [clinicId, setClinicId] = useState(resolvedClinic?.id ?? '')
  const [doctorId, setDoctorId] = useState('')
  const [deliveryAddressId, setDeliveryAddressId] = useState(
    myAddresses.find((a) => a.is_default)?.id ?? myAddresses[0]?.id ?? ''
  )
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

  const {
    show: showDoctorField,
    required: doctorRequired,
    blocked: orderBlockedByRx,
  } = resolveDoctorFieldState(
    cart.map((c) => ({ requires_prescription: c.product.requires_prescription })),
    doctors
  )

  // Serializes the current cart into the /doctors/new URL so the cart is
  // restored when the user navigates back to /orders/new.
  function doctorNewUrl() {
    const cartParam = cart.map((c) => `${c.product.id}:${c.quantity}`).join(',')
    return cartParam ? `/doctors/new?cart=${encodeURIComponent(cartParam)}` : '/doctors/new'
  }

  // Default document type: PRESCRIPTION when cart has any prescription product, otherwise OTHER
  const hasRxProduct = cart.some((c) => c.product.requires_prescription)
  const defaultDocType = hasRxProduct ? 'PRESCRIPTION' : 'OTHER'

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setDocuments((prev) => [...prev, ...files.map((file) => ({ file, type: defaultDocType }))])
    e.target.value = ''
  }

  function updateDocType(index: number, type: string) {
    setDocuments((prev) => prev.map((d, i) => (i === index ? { ...d, type } : d)))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}

    if (buyerType === 'CLINIC') {
      if (!clinicId) newErrors.clinic_id = 'Selecione a clínica'
      if (doctorRequired && !doctorId) newErrors.doctor_id = 'Selecione o médico solicitante'
    } else {
      if (!deliveryAddressId) newErrors.delivery_address_id = 'Selecione o endereço de entrega'
    }
    if (cart.length === 0) newErrors.items = 'Adicione ao menos um produto'
    if (Object.keys(newErrors).length) {
      setErrors(newErrors)
      return
    }
    setErrors({})

    setLoading(true)
    try {
      const result = await createOrder({
        buyer_type: buyerType,
        clinic_id: buyerType === 'CLINIC' ? clinicId : null,
        doctor_id: buyerType === 'DOCTOR' ? myDoctorId : doctorId || null,
        delivery_address_id: buyerType === 'DOCTOR' ? deliveryAddressId : null,
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
          {/* Buyer type toggle — only visible for DOCTOR users */}
          {isDoctor && (
            <div className="space-y-2">
              <Label>Comprar como</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBuyerType('DOCTOR')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                    buyerType === 'DOCTOR'
                      ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 ring-1 ring-blue-500'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <User className="h-4 w-4 flex-shrink-0" />
                  <span>Pessoa Física (CPF)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBuyerType('CLINIC')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                    buyerType === 'CLINIC'
                      ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 ring-1 ring-blue-500'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <Building2 className="h-4 w-4 flex-shrink-0" />
                  <span>Clínica vinculada</span>
                </button>
              </div>
            </div>
          )}

          {/* CLINIC buyer: show clinic selector */}
          {buyerType === 'CLINIC' && (
            <>
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
                    {(isDoctor ? myDoctorClinics : (adminClinics ?? [])).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.trade_name}
                      </option>
                    ))}
                  </select>
                  {errors.clinic_id && <p className="text-xs text-red-500">{errors.clinic_id}</p>}
                </div>
              )}

              {/* Doctor field — only for non-doctor users (clinic admin / platform admin) */}
              {!isDoctor &&
                (showDoctorField ? (
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
                  isClinicAdmin &&
                  orderBlockedByRx && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm font-medium text-red-800">
                        Médico obrigatório para este pedido
                      </p>
                      <p className="mt-0.5 text-xs text-red-700">
                        Um ou mais produtos exigem receita médica. Vincule um médico à sua clínica
                        antes de continuar.
                      </p>
                      <div className="mt-2 flex gap-3">
                        <Link
                          href={doctorNewUrl()}
                          className="flex items-center gap-1 text-xs font-medium text-red-900 underline hover:no-underline"
                        >
                          <UserPlus className="h-3 w-3" />
                          Cadastrar novo médico
                        </Link>
                        <Link
                          href="/doctors"
                          className="text-xs font-medium text-red-900 underline hover:no-underline"
                        >
                          Ver médicos disponíveis
                        </Link>
                      </div>
                    </div>
                  )
                ))}
            </>
          )}

          {/* DOCTOR buyer: show delivery address picker */}
          {buyerType === 'DOCTOR' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Endereço de entrega *</Label>
                <Link
                  href="/profile/addresses"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <PlusCircle className="h-3 w-3" />
                  Gerenciar endereços
                </Link>
              </div>

              {myAddresses.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-800">Nenhum endereço cadastrado</p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    Cadastre um endereço de entrega antes de fazer uma compra pessoal.
                  </p>
                  <Link
                    href="/profile/addresses"
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-900 underline hover:no-underline"
                  >
                    <MapPin className="h-3 w-3" />
                    Adicionar endereço
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {myAddresses.map((addr) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => setDeliveryAddressId(addr.id)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                        deliveryAddressId === addr.id
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <span className="font-medium text-gray-800">{addr.label}</span>
                        {addr.is_default && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            padrão
                          </span>
                        )}
                      </div>
                      <p className="mt-1 pl-5 text-xs text-gray-500">
                        {addr.address_line_1}
                        {addr.address_line_2 ? `, ${addr.address_line_2}` : ''} — {addr.city}/
                        {addr.state}, CEP {addr.zip_code}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {errors.delivery_address_id && (
                <p className="text-xs text-red-500">{errors.delivery_address_id}</p>
              )}
            </div>
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
            {hasRxProduct
              ? 'Este pedido contém produtos com receita obrigatória. Anexe a receita médica e demais documentos necessários.'
              : 'Anexe documentos de suporte ao pedido, se necessário.'}
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
              {documents.map((doc, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {doc.file.name}
                  </span>
                  <span className="flex-shrink-0 text-xs text-gray-400">
                    {(doc.file.size / 1024).toFixed(0)} KB
                  </span>
                  <select
                    value={doc.type}
                    onChange={(e) => updateDocType(i, e.target.value)}
                    className="flex-shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none"
                  >
                    {REQUIRED_DOCUMENT_TYPES.map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDocuments((p) => p.filter((_, j) => j !== i))}
                    className="flex-shrink-0 text-gray-400 hover:text-red-500"
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

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={
          loading || cart.length === 0 || (buyerType === 'CLINIC' && !isDoctor && orderBlockedByRx)
        }
      >
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
