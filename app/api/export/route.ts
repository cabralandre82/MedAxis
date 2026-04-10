/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { getCurrentUser } from '@/lib/auth/session'
import { toCSV, toXLSX } from '@/lib/export'
import { formatCurrency } from '@/lib/utils'

const ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN']
const BATCH_SIZE = 1000

/**
 * GET /api/export?type=orders|payments|commissions|transfers&format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * CSV exports stream data in batches of 1000 rows — O(1) memory regardless of dataset size.
 * XLSX exports remain buffered (ExcelJS limitation).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !user.roles.some((r) => ADMIN_ROLES.includes(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'orders'
  const format = searchParams.get('format') ?? 'csv'
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const now = new Date().toISOString().slice(0, 10)
  const rangeFrom = fromParam ? `${fromParam}T00:00:00` : null
  const rangeTo = toParam ? `${toParam}T23:59:59` : null
  const periodSuffix = fromParam && toParam ? `_${fromParam}_a_${toParam}` : ''

  const filename = buildFilename(type, periodSuffix, now)

  // XLSX: buffer everything (ExcelJS requires complete dataset)
  if (format === 'xlsx') {
    const allRows = await fetchAllRows(type, rangeFrom, rangeTo)
    const uint8 = await toXLSX([{ name: filename.slice(0, 31), rows: allRows }])
    return new NextResponse(uint8.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    })
  }

  // CSV: stream in batches — O(1) memory usage regardless of total rows
  const encoder = new TextEncoder()
  let isFirstBatch = true
  let cursor: string | null = null

  const stream = new ReadableStream({
    async start(controller) {
      try {
        do {
          const { rows, nextCursor } = await fetchBatch(type, rangeFrom, rangeTo, cursor)
          if (rows.length === 0) break

          if (isFirstBatch) {
            // Write CSV header on first batch
            const header = Object.keys(rows[0]).join(',') + '\n'
            controller.enqueue(encoder.encode(header))
            isFirstBatch = false
          }

          // Write rows without header (skipHeader=true)
          const csvChunk = toCSV(rows, { skipHeader: true })
          controller.enqueue(encoder.encode(csvChunk))

          cursor = nextCursor
        } while (cursor)

        controller.close()
      } catch (err) {
        console.error('[export] stream error:', err)
        controller.error(err)
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
      // Disable buffering in proxies so streaming works end-to-end
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildFilename(type: string, periodSuffix: string, now: string): string {
  const names: Record<string, string> = {
    orders: 'pedidos',
    payments: 'pagamentos',
    commissions: 'comissoes',
    transfers: 'repasses',
  }
  return `${names[type] ?? type}${periodSuffix || '-' + now}`
}

/** Fetch a single batch (cursor-based). Returns rows + next cursor. */
async function fetchBatch(
  type: string,
  rangeFrom: string | null,
  rangeTo: string | null,
  cursor: string | null
): Promise<{ rows: Record<string, unknown>[]; nextCursor: string | null }> {
  const admin = createAdminClient()

  function applyFilters(q: any) {
    if (rangeFrom) q = q.gte('created_at', rangeFrom)
    if (rangeTo) q = q.lte('created_at', rangeTo)
    if (cursor) q = q.lt('created_at', cursor)
    return q
  }

  if (type === 'orders') {
    const { data } = await applyFilters(
      admin
        .from('orders')
        .select(
          `code, order_status, payment_status, transfer_status, total_price, created_at,
           clinics(trade_name), doctors(full_name), pharmacies(trade_name),
           order_items(quantity, unit_price, total_price, products(name))`
        )
        .order('created_at', { ascending: false })
        .limit(BATCH_SIZE)
    )
    const rows = (data ?? []).map((o: any) => {
      const items = (o.order_items ?? []) as Array<{
        quantity: number
        unit_price: number
        total_price: number
        products: { name: string } | null
      }>
      return {
        Código: o.code,
        Clínica: (o.clinics as any)?.trade_name ?? '—',
        Médico: (o.doctors as any)?.full_name ?? '—',
        Farmácia: (o.pharmacies as any)?.trade_name ?? '—',
        Produtos: items.map((i) => `${i.products?.name ?? '—'} ×${i.quantity}`).join(' | '),
        Total: formatCurrency(Number(o.total_price)),
        'Status do pedido': o.order_status,
        'Status pagamento': o.payment_status,
        'Status repasse': o.transfer_status,
        'Data criação': o.created_at?.slice(0, 16).replace('T', ' '),
      }
    })
    const lastCreatedAt = data?.[data.length - 1]?.created_at ?? null
    return { rows, nextCursor: rows.length === BATCH_SIZE ? lastCreatedAt : null }
  }

  if (type === 'payments') {
    const { data } = await applyFilters(
      admin
        .from('payments')
        .select(
          `gross_amount, status, payment_method, reference_code, confirmed_at, created_at,
           orders(code, clinics(trade_name))`
        )
        .order('created_at', { ascending: false })
        .limit(BATCH_SIZE)
    )
    const rows = (data ?? []).map((p: any) => {
      const order = p.orders as { code?: string; clinics?: { trade_name?: string } } | null
      return {
        Pedido: order?.code ?? '—',
        Clínica: order?.clinics?.trade_name ?? '—',
        Valor: formatCurrency(Number(p.gross_amount)),
        Status: p.status,
        Método: p.payment_method ?? '—',
        Referência: p.reference_code ?? '—',
        'Data confirmação': p.confirmed_at?.slice(0, 16).replace('T', ' ') ?? '—',
        'Data criação': p.created_at?.slice(0, 16).replace('T', ' '),
      }
    })
    const lastCreatedAt = data?.[data.length - 1]?.created_at ?? null
    return { rows, nextCursor: rows.length === BATCH_SIZE ? lastCreatedAt : null }
  }

  if (type === 'commissions') {
    const { data } = await applyFilters(
      admin
        .from('consultant_commissions')
        .select(
          `commission_amount, commission_rate, order_total, status, created_at,
           orders(code), sales_consultants(full_name)`
        )
        .order('created_at', { ascending: false })
        .limit(BATCH_SIZE)
    )
    const rows = (data ?? []).map((c: any) => ({
      Consultor: (c.sales_consultants as any)?.full_name ?? '—',
      Pedido: (c.orders as any)?.code ?? '—',
      'Total do pedido': formatCurrency(Number(c.order_total)),
      'Taxa (%)': Number(c.commission_rate).toFixed(2),
      Comissão: formatCurrency(Number(c.commission_amount)),
      Status: c.status,
      Data: c.created_at?.slice(0, 16).replace('T', ' '),
    }))
    const lastCreatedAt = data?.[data.length - 1]?.created_at ?? null
    return { rows, nextCursor: rows.length === BATCH_SIZE ? lastCreatedAt : null }
  }

  if (type === 'transfers') {
    const { data } = await applyFilters(
      admin
        .from('transfers')
        .select(
          `gross_amount, commission_amount, net_amount, status,
           transfer_reference, processed_at, created_at,
           pharmacies(trade_name), orders(code)`
        )
        .order('created_at', { ascending: false })
        .limit(BATCH_SIZE)
    )
    const rows = (data ?? []).map((t: any) => ({
      Pedido: (t.orders as any)?.code ?? '—',
      Farmácia: (t.pharmacies as any)?.trade_name ?? '—',
      Bruto: formatCurrency(Number(t.gross_amount)),
      'Comissão plataforma': formatCurrency(Number(t.commission_amount)),
      Líquido: formatCurrency(Number(t.net_amount)),
      Status: t.status,
      Referência: t.transfer_reference ?? '—',
      'Data repasse': t.processed_at?.slice(0, 16).replace('T', ' ') ?? '—',
      Criado: t.created_at?.slice(0, 16).replace('T', ' '),
    }))
    const lastCreatedAt = data?.[data.length - 1]?.created_at ?? null
    return { rows, nextCursor: rows.length === BATCH_SIZE ? lastCreatedAt : null }
  }

  return { rows: [], nextCursor: null }
}

/** Fetch ALL rows (for XLSX, which needs a complete buffer). */
async function fetchAllRows(
  type: string,
  rangeFrom: string | null,
  rangeTo: string | null
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = []
  let cursor: string | null = null
  let iterations = 0
  const MAX_ITERATIONS = 100 // safety cap: 100 × 1000 = 100k rows max

  do {
    const { rows, nextCursor } = await fetchBatch(type, rangeFrom, rangeTo, cursor)
    allRows.push(...rows)
    cursor = nextCursor
    iterations++
  } while (cursor && iterations < MAX_ITERATIONS)

  return allRows
}
