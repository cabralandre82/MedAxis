'use client'

import { useState, useTransition } from 'react'
import {
  CreditCard,
  QrCode,
  FileText,
  ExternalLink,
  Copy,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

interface PaymentOptionsProps {
  orderId: string
  orderCode?: string
  amount: number
  /** Pre-loaded payment data (if payment already created) */
  payment?: {
    asaasPaymentId?: string | null
    asaasInvoiceUrl?: string | null
    asaasPixQrCode?: string | null
    asaasPixCopyPaste?: string | null
    asaasBoletoUrl?: string | null
    paymentLink?: string | null
    paymentDueDate?: string | null
    status?: string
  } | null
  /** Whether the current user is an admin (can generate payment) */
  isAdmin?: boolean
}

export function PaymentOptions({
  orderId,
  orderCode: _orderCode,
  amount,
  payment,
  isAdmin,
}: PaymentOptionsProps) {
  const [isPending, startTransition] = useTransition()
  const [data, setData] = useState(payment)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'pix' | 'boleto' | 'card'>('pix')

  const hasPayment = !!data?.asaasPaymentId
  const isPaid = data?.status === 'CONFIRMED'

  function generatePayment() {
    startTransition(async () => {
      const res = await fetch('/api/payments/asaas/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error('Erro ao gerar cobrança: ' + (json.error ?? 'Tente novamente'))
        return
      }
      // Mirror EVERY field the API returns. Forgetting `asaasBoletoUrl`
      // (the original bug) left the Boleto tab stuck on "disponível
      // em instantes" even though the row was complete in the DB.
      // Keep this list aligned with the JSON shape of
      // POST /api/payments/asaas/create — if the API adds a field,
      // add it here too.
      setData({
        asaasPaymentId: json.asaasPaymentId,
        asaasInvoiceUrl: json.invoiceUrl,
        asaasPixQrCode: json.pixQrCode,
        asaasPixCopyPaste: json.pixCopyPaste,
        asaasBoletoUrl: json.boletoUrl,
        paymentLink: json.invoiceUrl,
        paymentDueDate: json.dueDate,
        status: 'PENDING',
      })
      toast.success('Opções de pagamento prontas. Use a aba do método desejado.')
    })
  }

  /**
   * Re-hits the same idempotent /create endpoint to refresh a stale
   * field (typically `asaasBoletoUrl` on a payment that was created
   * before the boleto PDF was ready, or any field that came back
   * NULL because Asaas was slow). Idempotency guarantees this never
   * creates a second charge.
   */
  function refreshPayment() {
    startTransition(async () => {
      const res = await fetch('/api/payments/asaas/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error('Erro ao atualizar: ' + (json.error ?? 'Tente novamente'))
        return
      }
      setData({
        asaasPaymentId: json.asaasPaymentId,
        asaasInvoiceUrl: json.invoiceUrl,
        asaasPixQrCode: json.pixQrCode,
        asaasPixCopyPaste: json.pixCopyPaste,
        asaasBoletoUrl: json.boletoUrl,
        paymentLink: json.invoiceUrl,
        paymentDueDate: json.dueDate,
        status: data?.status ?? 'PENDING',
      })
    })
  }

  function copyPix() {
    if (!data?.asaasPixCopyPaste) return
    navigator.clipboard.writeText(data.asaasPixCopyPaste)
    setCopied(true)
    toast.success('Código PIX copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  if (isPaid) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <div>
          <p className="font-medium text-green-800">Pagamento confirmado</p>
          <p className="text-sm text-green-600">
            O pagamento foi recebido e confirmado automaticamente pelo sistema.
          </p>
        </div>
      </div>
    )
  }

  if (!hasPayment) {
    // Anyone authenticated who has access to the order detail page may
    // trigger charge generation: the API at /api/payments/asaas/create
    // gates this on (a) platform admin OR (b) clinic admin of the
    // order's clinic, AND `generateAsaasChargeForOrder` is idempotent,
    // so worst case the clinic clicks twice and gets the same Asaas
    // charge back. Replaces the pre-2026-04-29 dead-end branch where
    // a clinic with status=AWAITING_PAYMENT had no UI to pay because
    // only super_admins could press this button.
    return (
      <div className="space-y-2">
        <Button onClick={generatePayment} disabled={isPending} className="gap-2">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          {isAdmin ? 'Gerar cobrança (PIX + Boleto + Cartão)' : 'Gerar opções de pagamento'}
        </Button>
        {!isAdmin && (
          <p className="text-xs text-gray-500">
            Clique para gerar PIX, boleto e link de cartão para este pedido.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {data?.paymentDueDate && (
        <p className="text-sm text-gray-500">
          Vencimento:{' '}
          <strong>{new Date(data.paymentDueDate + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
          {' · '}
          Valor:{' '}
          <strong>R$ {(amount / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
        </p>
      )}

      {/* Tab selector */}
      <div className="flex gap-2 rounded-lg border bg-gray-50 p-1">
        {(
          [
            { key: 'pix', icon: QrCode, label: 'PIX' },
            { key: 'boleto', icon: FileText, label: 'Boleto' },
            { key: 'card', icon: CreditCard, label: 'Cartão' },
          ] as const
        ).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* PIX */}
      {activeTab === 'pix' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via PIX</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.asaasPixQrCode ? (
              <>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${data.asaasPixQrCode}`}
                    alt="QR Code PIX"
                    className="h-48 w-48 rounded-md border"
                  />
                </div>
                {data.asaasPixCopyPaste && (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-hidden rounded bg-gray-100 px-3 py-2 text-xs">
                      {data.asaasPixCopyPaste.slice(0, 50)}…
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={copyPix}
                    >
                      {copied ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copiar
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  QR Code PIX ainda não disponível. O banco emissor pode levar alguns segundos para
                  gerar.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshPayment}
                  disabled={isPending}
                  className="gap-1.5"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <QrCode className="h-3.5 w-3.5" />
                  )}
                  Tentar novamente
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Boleto */}
      {activeTab === 'boleto' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via Boleto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.asaasBoletoUrl ? (
              <>
                <a href={data.asaasBoletoUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="w-full gap-2">
                    <FileText className="h-4 w-4" />
                    Abrir boleto bancário (PDF)
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
                <p className="text-xs text-gray-500">
                  Compensação em até 2 dias úteis. Pagamentos confirmados aparecem automaticamente
                  neste pedido.
                </p>
              </>
            ) : (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">
                  O boleto está sendo gerado pelo banco emissor. Isso costuma levar alguns segundos.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshPayment}
                    disabled={isPending}
                    className="gap-1.5"
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    Tentar novamente
                  </Button>
                  {data?.asaasInvoiceUrl && (
                    <a href={data.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="ghost" className="gap-1.5">
                        Abrir pelo link de pagamento
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cartão */}
      {activeTab === 'card' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pagar via Cartão de Crédito</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.asaasInvoiceUrl ? (
              <>
                <a href={data.asaasInvoiceUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="w-full gap-2">
                    <CreditCard className="h-4 w-4" />
                    Pagar com cartão na página segura
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
                <p className="text-xs text-gray-500">
                  A página de cartão abre em nova aba (Asaas — gateway PCI-DSS Nível 1). Aprovação
                  imediata. Confirmação volta automaticamente para este pedido.
                </p>
              </>
            ) : (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-900">Link de pagamento ainda não disponível.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshPayment}
                  disabled={isPending}
                  className="gap-1.5"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                  Tentar novamente
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Universal link */}
      {data?.paymentLink && (
        <div className="text-center">
          <a
            href={data.paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            Abrir página de pagamento completa →
          </a>
        </div>
      )}
    </div>
  )
}
