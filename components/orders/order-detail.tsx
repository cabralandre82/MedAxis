'use client'

import Link from 'next/link'
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ButtonLink } from '@/components/ui/button-link'
import { PharmacyOrderActions } from '@/components/orders/pharmacy-order-actions'
import { DocumentManager } from '@/components/orders/document-manager'
import { PaymentOptions } from '@/components/orders/payment-options'
import {
  ChevronLeft,
  Building2,
  UserCheck,
  Pill,
  Package,
  FileText,
  CreditCard,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import type { ProfileWithRoles, OrderStatus } from '@/types'

const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  AWAITING_DOCUMENTS: 'Aguardando Documentação',
  READY_FOR_REVIEW: 'Pronto para Revisão',
  AWAITING_PAYMENT: 'Aguardando Pagamento',
  PAYMENT_UNDER_REVIEW: 'Pagamento em Análise',
  PAYMENT_CONFIRMED: 'Pagamento Confirmado',
  COMMISSION_CALCULATED: 'Comissão Calculada',
  TRANSFER_PENDING: 'Repasse Pendente',
  TRANSFER_COMPLETED: 'Repasse Concluído',
  RELEASED_FOR_EXECUTION: 'Liberado para Execução',
  RECEIVED_BY_PHARMACY: 'Recebido pela Farmácia',
  IN_EXECUTION: 'Em Execução',
  READY: 'Pronto',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  WITH_ISSUE: 'Com Problema',
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  CONFIRMED: 'Confirmado',
  FAILED: 'Falhou',
  REFUNDED: 'Estornado',
}

interface OrderDetailProps {
  order: Record<string, unknown>
  currentUser: ProfileWithRoles
}

export function OrderDetail({ order, currentUser }: OrderDetailProps) {
  const isAdmin = currentUser.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))
  const isPharmacy = currentUser.roles.includes('PHARMACY_ADMIN')

  const statusHistory =
    (
      order.order_status_history as Array<{
        id: string
        old_status: string | null
        new_status: string
        reason: string | null
        created_at: string
        profiles: { full_name: string } | null
      }>
    )?.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) ?? []

  const documents =
    (order.order_documents as Array<{
      id: string
      document_type: string
      original_filename: string
      mime_type: string
      file_size: number
      created_at: string
    }>) ?? []

  const payment =
    (
      order.payments as Array<{
        id: string
        gross_amount: number
        status: string
        payment_method: string | null
        reference_code: string | null
        confirmed_at: string | null
        notes: string | null
        asaas_payment_id: string | null
        asaas_invoice_url: string | null
        asaas_pix_qr_code: string | null
        asaas_pix_copy_paste: string | null
        asaas_boleto_url: string | null
        payment_link: string | null
        payment_due_date: string | null
      }>
    )?.[0] ?? null

  const commission =
    (
      order.commissions as Array<{
        id: string
        commission_type: string
        commission_percentage: number | null
        commission_total_amount: number
      }>
    )?.[0] ?? null

  const transfer =
    (
      order.transfers as Array<{
        id: string
        gross_amount: number
        commission_amount: number
        net_amount: number
        status: string
        transfer_reference: string | null
        processed_at: string | null
      }>
    )?.[0] ?? null

  const operationalUpdates =
    (order.order_operational_updates as Array<{
      id: string
      status: string
      description: string
      created_at: string
    }>) ?? []

  const clinic = order.clinics as { trade_name: string; city: string; state: string } | null
  const doctor = order.doctors as {
    full_name: string
    crm: string
    crm_state: string
    specialty: string | null
  } | null
  const pharmacy = order.pharmacies as { trade_name: string; city: string; state: string } | null
  const orderItems = (order.order_items ?? []) as Array<{
    id: string
    product_id: string
    quantity: number
    unit_price: number
    total_price: number
    discount_amount?: number
    original_total_price?: number
    coupon_id?: string | null
    products: { name: string; concentration: string; presentation: string } | null
  }>

  return (
    <div className="max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/orders"
            className="mb-2 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4" />
            Pedidos
          </Link>
          <h1 className="font-mono text-2xl font-bold text-gray-900">{String(order.code)}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Criado em {formatDateTime(String(order.created_at))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-block rounded-full bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-800">
            {ORDER_STATUS_LABELS[String(order.order_status)] ?? String(order.order_status)}
          </span>
          {isPharmacy && (
            <PharmacyOrderActions
              orderId={String(order.id)}
              currentStatus={String(order.order_status) as OrderStatus}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Main content */}
        <div className="col-span-2 space-y-5">
          {/* Order summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Produtos ({orderItems.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-400">
                    <th className="pb-2 font-medium">Produto</th>
                    <th className="w-16 pb-2 text-center font-medium">Qtd</th>
                    <th className="w-28 pb-2 text-right font-medium">Unit.</th>
                    <th className="w-28 pb-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orderItems.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5">
                        <p className="font-medium text-gray-900">{item.products?.name ?? '—'}</p>
                        <p className="text-xs text-gray-400">
                          {item.products?.concentration} · {item.products?.presentation}
                        </p>
                      </td>
                      <td className="py-2.5 text-center text-gray-700">{item.quantity}</td>
                      <td className="py-2.5 text-right text-gray-700">
                        {formatCurrency(Number(item.unit_price))}
                        {item.coupon_id && Number(item.discount_amount) > 0 && (
                          <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                            -{formatCurrency(Number(item.discount_amount) / item.quantity)}/un
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-gray-900">
                        {formatCurrency(Number(item.total_price))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="pt-3 text-sm font-semibold text-gray-700">
                      Total do pedido
                    </td>
                    <td className="pt-3 text-right text-base font-bold text-[hsl(213,75%,24%)]">
                      {formatCurrency(Number(order.total_price))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Documentação ({documents.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentManager
                orderId={String(order.id)}
                documents={documents}
                canUpload={!['COMPLETED', 'CANCELED'].includes(String(order.order_status))}
              />
            </CardContent>
          </Card>

          {/* Financial (admin only) */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" />
                  Financeiro
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Payment */}
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    Pagamento
                  </p>
                  {payment ? (
                    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Valor</span>
                        <span className="font-semibold">
                          {formatCurrency(payment.gross_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Status</span>
                        <span
                          className={`font-medium ${payment.status === 'CONFIRMED' ? 'text-green-700' : 'text-amber-700'}`}
                        >
                          {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                        </span>
                      </div>
                      {payment.reference_code && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Referência</span>
                          <span className="font-mono text-xs">{payment.reference_code}</span>
                        </div>
                      )}
                      {payment.confirmed_at && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Confirmado em</span>
                          <span>{formatDate(payment.confirmed_at)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Sem dados de pagamento</p>
                  )}
                  {/* Asaas payment gateway options */}
                  {(order.order_status === 'AWAITING_PAYMENT' || payment?.asaas_payment_id) && (
                    <div className="mt-3">
                      <PaymentOptions
                        orderId={String(order.id)}
                        orderCode={String(order.code)}
                        amount={Number(order.total_amount ?? 0) * 100}
                        payment={
                          payment
                            ? {
                                asaasPaymentId: payment.asaas_payment_id,
                                asaasInvoiceUrl: payment.asaas_invoice_url,
                                asaasPixQrCode: payment.asaas_pix_qr_code,
                                asaasPixCopyPaste: payment.asaas_pix_copy_paste,
                                asaasBoletoUrl: payment.asaas_boleto_url,
                                paymentLink: payment.payment_link,
                                paymentDueDate: payment.payment_due_date,
                                status: payment.status,
                              }
                            : null
                        }
                        isAdmin={isAdmin}
                      />
                    </div>
                  )}
                  {isAdmin && payment?.status === 'PENDING' && !payment?.asaas_payment_id && (
                    <ButtonLink href={`/payments?order=${order.id}`} size="sm" className="mt-2">
                      Confirmar pagamento manualmente
                    </ButtonLink>
                  )}
                </div>

                {/* Commission — admin only (RLS also blocks non-admins, this is defense-in-depth) */}
                {isAdmin && commission && (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      Comissão
                    </p>
                    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Percentual</span>
                        <span className="font-semibold">
                          {commission.commission_percentage ?? '—'}%
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Valor</span>
                        <span className="font-semibold">
                          {formatCurrency(commission.commission_total_amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Transfer */}
                {transfer && (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      Repasse para farmácia
                    </p>
                    <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Bruto</span>
                        <span>{formatCurrency(transfer.gross_amount)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Comissão</span>
                        <span className="text-red-600">
                          - {formatCurrency(transfer.commission_amount)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-sm font-semibold">
                        <span>Líquido</span>
                        <span className="text-green-700">
                          {formatCurrency(transfer.net_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Status</span>
                        <span
                          className={`font-medium ${transfer.status === 'COMPLETED' ? 'text-green-700' : 'text-amber-700'}`}
                        >
                          {transfer.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Operational Updates */}
          {operationalUpdates.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" />
                  Updates operacionais ({operationalUpdates.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {operationalUpdates.map((update) => (
                    <div
                      key={update.id}
                      className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {update.status}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          {formatDate(update.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{update.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Entities */}
          <Card>
            <CardContent className="space-y-4 p-4">
              {clinic && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
                    <Building2 className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs tracking-wide text-gray-400 uppercase">Clínica</p>
                    <p className="text-sm font-medium text-gray-900">{clinic.trade_name}</p>
                    <p className="text-xs text-gray-400">
                      {clinic.city}, {clinic.state}
                    </p>
                  </div>
                </div>
              )}
              {doctor && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-teal-100">
                    <UserCheck className="h-4 w-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-xs tracking-wide text-gray-400 uppercase">Médico</p>
                    <p className="text-sm font-medium text-gray-900">{doctor.full_name}</p>
                    <p className="text-xs text-gray-400">
                      CRM {doctor.crm}/{doctor.crm_state}
                    </p>
                  </div>
                </div>
              )}
              {pharmacy && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-100">
                    <Pill className="h-4 w-4 text-cyan-600" />
                  </div>
                  <div>
                    <p className="text-xs tracking-wide text-gray-400 uppercase">Farmácia</p>
                    <p className="text-sm font-medium text-gray-900">{pharmacy.trade_name}</p>
                    <p className="text-xs text-gray-400">
                      {pharmacy.city}, {pharmacy.state}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {statusHistory.map((entry, idx) => (
                  <div key={entry.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                          idx === statusHistory.length - 1
                            ? 'bg-[hsl(213,75%,24%)] text-white'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {entry.new_status === 'CANCELED' ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : entry.new_status === 'COMPLETED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Activity className="h-3.5 w-3.5" />
                        )}
                      </div>
                      {idx < statusHistory.length - 1 && (
                        <div className="my-1 w-px flex-1 bg-gray-200" />
                      )}
                    </div>
                    <div className="pb-3">
                      <p className="text-xs font-semibold text-gray-800">
                        {ORDER_STATUS_LABELS[entry.new_status] ?? entry.new_status}
                      </p>
                      {entry.reason && (
                        <p className="mt-0.5 text-xs text-gray-500">{entry.reason}</p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-400">
                        {formatDateTime(entry.created_at)}
                        {entry.profiles?.full_name && ` · ${entry.profiles.full_name}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
