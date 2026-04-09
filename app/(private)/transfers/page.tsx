import { Metadata } from 'next'
import { createClient } from '@/lib/db/server'
import { getCurrentUser } from '@/lib/auth/session'
import { formatCurrency, formatDate, parsePage, paginationRange } from '@/lib/utils'
import { TransferCompleteDialog } from '@/components/shared/transfer-complete-dialog'
import { PaginationWrapper } from '@/components/ui/pagination-wrapper'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Repasses | Clinipharma' }

const PAGE_SIZE = 20

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function TransfersPage({ searchParams }: Props) {
  const { page: pageRaw } = await searchParams
  const user = await getCurrentUser()
  const supabase = await createClient()
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(r))

  const page = parsePage(pageRaw)
  const { from, to } = paginationRange(page, PAGE_SIZE)

  const { data: transfers, count } = await supabase
    .from('transfers')
    .select(
      `id, gross_amount, commission_amount, net_amount, status,
       transfer_reference, processed_at, created_at,
       pharmacies (trade_name), orders (code)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Repasses</h1>
        <p className="mt-0.5 text-sm text-gray-500">{count ?? 0} repasse(s) no total</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Pedido</TableHead>
                <TableHead className="font-semibold">Farmácia</TableHead>
                <TableHead className="text-right font-semibold">Bruto</TableHead>
                <TableHead className="text-right font-semibold">Comissão</TableHead>
                <TableHead className="text-right font-semibold">Líquido</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Data</TableHead>
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(transfers?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-gray-400">
                    Nenhum repasse encontrado
                  </TableCell>
                </TableRow>
              ) : (
                transfers?.map((t) => {
                  const order = t.orders as unknown as { code: string } | null
                  const pharmacy = t.pharmacies as unknown as { trade_name: string } | null
                  return (
                    <TableRow key={t.id} className="hover:bg-gray-50">
                      <TableCell>
                        <span className="font-mono text-xs font-medium text-[hsl(213,75%,24%)]">
                          {order?.code ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-700">{pharmacy?.trade_name ?? '—'}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(t.gross_amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-red-600">
                        - {formatCurrency(t.commission_amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold text-green-700">
                        {formatCurrency(t.net_amount)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            t.status === 'COMPLETED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {t.status === 'COMPLETED' ? 'Concluído' : 'Pendente'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {t.processed_at ? formatDate(t.processed_at) : formatDate(t.created_at)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {t.status === 'PENDING' && (
                            <TransferCompleteDialog
                              transferId={t.id}
                              amount={t.net_amount}
                              pharmacyName={pharmacy?.trade_name ?? ''}
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PaginationWrapper total={count ?? 0} pageSize={PAGE_SIZE} currentPage={page} />
    </div>
  )
}
