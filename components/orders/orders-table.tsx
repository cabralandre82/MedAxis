'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, ExternalLink } from 'lucide-react'
import { type FinancialViewMode, visibleOrderTotal, priceColumnLabel } from '@/lib/orders/view-mode'

export interface OrderRow {
  id: string
  code: string
  order_status: string
  payment_status: string
  transfer_status: string
  total_price: number
  created_at: string
  clinics: { trade_name: string } | null
  doctors: { full_name: string } | null
  pharmacies: { trade_name: string } | null
  order_items: Array<{
    product_id: string
    quantity: number
    pharmacy_cost_per_unit?: number | null
    products: { name: string } | null
  }> | null
}

const ORDER_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Rascunho', className: 'bg-gray-100 text-gray-700' },
  AWAITING_DOCUMENTS: { label: 'Aguard. Docs', className: 'bg-yellow-100 text-yellow-800' },
  READY_FOR_REVIEW: { label: 'Em revisão', className: 'bg-blue-100 text-blue-800' },
  AWAITING_PAYMENT: { label: 'Aguard. Pgto', className: 'bg-orange-100 text-orange-800' },
  PAYMENT_UNDER_REVIEW: { label: 'Pgto em análise', className: 'bg-orange-100 text-orange-800' },
  PAYMENT_CONFIRMED: { label: 'Pgto confirmado', className: 'bg-teal-100 text-teal-800' },
  COMMISSION_CALCULATED: { label: 'Comissão calc.', className: 'bg-teal-100 text-teal-800' },
  TRANSFER_PENDING: { label: 'Repasse pend.', className: 'bg-blue-100 text-blue-800' },
  TRANSFER_COMPLETED: { label: 'Repasse conc.', className: 'bg-blue-100 text-blue-800' },
  RELEASED_FOR_EXECUTION: { label: 'Liberado', className: 'bg-indigo-100 text-indigo-800' },
  RECEIVED_BY_PHARMACY: { label: 'Recebido Farm.', className: 'bg-purple-100 text-purple-800' },
  IN_EXECUTION: { label: 'Em execução', className: 'bg-purple-100 text-purple-800' },
  READY: { label: 'Pronto', className: 'bg-green-100 text-green-800' },
  SHIPPED: { label: 'Enviado', className: 'bg-green-100 text-green-800' },
  DELIVERED: { label: 'Entregue', className: 'bg-green-100 text-green-800' },
  COMPLETED: { label: 'Concluído', className: 'bg-emerald-100 text-emerald-800' },
  CANCELED: { label: 'Cancelado', className: 'bg-red-100 text-red-800' },
  WITH_ISSUE: { label: 'Com problema', className: 'bg-red-100 text-red-800' },
}

interface OrdersTableProps {
  orders: OrderRow[]
  /**
   * Drives both column visibility (Clínica/Farmácia only show for admin)
   * AND the canonical price the user is allowed to see. Pharmacy view
   * NEVER renders the sales price — it shows the repasse total computed
   * from `order_items[].pharmacy_cost_per_unit × quantity`.
   * See lib/orders/view-mode.ts.
   */
  viewMode: FinancialViewMode
}

export function OrdersTable({ orders, viewMode }: OrdersTableProps) {
  const isAdmin = viewMode === 'admin'
  const isPharmacy = viewMode === 'pharmacy'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = (orders as OrderRow[]).filter((o) => {
    const matchSearch =
      !search ||
      o.code.toLowerCase().includes(search.toLowerCase()) ||
      o.order_items?.some((i) => i.products?.name.toLowerCase().includes(search.toLowerCase())) ||
      o.clinics?.trade_name.toLowerCase().includes(search.toLowerCase())

    const matchStatus = !statusFilter || o.order_status === statusFilter

    return matchSearch && matchStatus
  })

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* Filters */}
      <div className="flex gap-3 border-b border-gray-100 p-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por código, produto, clínica..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-[hsl(196,91%,33%)] focus:outline-none"
        >
          <option value="">Todos os status</option>
          {Object.entries(ORDER_STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="font-semibold">Código</TableHead>
              <TableHead className="font-semibold">Produto</TableHead>
              {isAdmin && <TableHead className="font-semibold">Clínica</TableHead>}
              <TableHead className="font-semibold">Médico</TableHead>
              {isAdmin && <TableHead className="font-semibold">Farmácia</TableHead>}
              <TableHead className="text-right font-semibold">
                {isPharmacy
                  ? 'Repasse'
                  : priceColumnLabel(viewMode) === 'Repasse'
                    ? 'Repasse'
                    : 'Valor'}
              </TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Data</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-gray-400">
                  Nenhum pedido encontrado
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((order) => {
                const statusConfig = ORDER_STATUS_CONFIG[order.order_status] ?? {
                  label: order.order_status,
                  className: 'bg-gray-100 text-gray-700',
                }
                return (
                  <TableRow key={order.id} className="hover:bg-gray-50">
                    <TableCell>
                      <span className="font-mono text-xs font-medium text-[hsl(213,75%,24%)]">
                        {order.code}
                      </span>
                    </TableCell>
                    <TableCell>
                      {order.order_items && order.order_items.length > 0 ? (
                        <>
                          <span className="block max-w-[180px] truncate text-sm text-gray-900">
                            {order.order_items[0]?.products?.name ?? '—'}
                          </span>
                          {order.order_items.length > 1 && (
                            <span className="text-xs text-gray-400">
                              +{order.order_items.length - 1} produto(s)
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm text-gray-600">
                        {order.clinics?.trade_name ?? '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-gray-600">
                      {order.doctors?.full_name ?? '—'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm text-gray-600">
                        {order.pharmacies?.trade_name ?? '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-sm font-medium">
                      {formatCurrency(visibleOrderTotal(viewMode, order))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}
                      >
                        {statusConfig.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {formatDate(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/orders/${order.id}`}
                        className="text-gray-400 transition-colors hover:text-[hsl(196,91%,33%)]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
