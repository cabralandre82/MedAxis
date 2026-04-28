import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Pin the contract of `advanceOrderAfterDocumentUpload`.
 *
 * This helper is the single bridge between "clinic uploaded a recipe"
 * and "pharmacy can now analyse it". The bug it fixes is the one
 * reported on 2026-04-28: late uploads (the common case) didn't
 * transition the order out of AWAITING_DOCUMENTS, so the pharmacy
 * never saw approve/reject buttons and the timeline lied.
 *
 * Properties that must hold:
 *   1. AWAITING_DOCUMENTS → READY_FOR_REVIEW with a status_history row
 *   2. Any other status: no-op (idempotent for late uploads after
 *      review/payment etc.)
 *   3. Idempotent across multiple uploads in quick succession (the
 *      optimistic guard `eq('order_status', 'AWAITING_DOCUMENTS')`
 *      prevents double-transition races)
 *   4. Failures in the secondary history insert are logged but do not
 *      undo the status update
 */

type OrdersTable = { order_status: string; id: string }
type StatusHistoryRow = {
  order_id: string
  old_status: string | null
  new_status: string
  changed_by_user_id: string
  reason: string | null
}

let orderRow: OrdersTable | null = null
let updateBody: Record<string, unknown> | null = null
let updateGuardEqs: Array<[string, unknown]> = []
let historyInserts: StatusHistoryRow[] = []
let historyShouldFail = false
let updateShouldFail = false

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                orderRow
                  ? { data: orderRow, error: null }
                  : { data: null, error: { message: 'not found' } },
            }),
          }),
          update: (body: Record<string, unknown>) => {
            updateBody = body
            updateGuardEqs = []
            const chain = {
              eq(col: string, value: unknown) {
                updateGuardEqs.push([col, value])
                if (updateGuardEqs.length === 2) {
                  // After both `.eq('id', ...).eq('order_status', ...)` chained,
                  // resolve the final promise.
                  if (updateShouldFail) {
                    return Promise.resolve({ error: { message: 'boom' } })
                  }
                  if (orderRow) orderRow.order_status = String(body.order_status)
                  return Promise.resolve({ error: null })
                }
                return chain
              },
            }
            return chain
          },
        }
      }
      if (table === 'order_status_history') {
        return {
          insert: async (row: StatusHistoryRow) => {
            historyInserts.push(row)
            return historyShouldFail ? { error: { message: 'history boom' } } : { error: null }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

beforeEach(() => {
  orderRow = null
  updateBody = null
  updateGuardEqs = []
  historyInserts = []
  historyShouldFail = false
  updateShouldFail = false
})

describe('advanceOrderAfterDocumentUpload', () => {
  it('AWAITING_DOCUMENTS → READY_FOR_REVIEW with a status history row', async () => {
    orderRow = { id: 'ord-1', order_status: 'AWAITING_DOCUMENTS' }
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    const result = await advanceOrderAfterDocumentUpload({
      orderId: 'ord-1',
      changedByUserId: 'user-1',
    })

    expect(result.transitioned).toBe(true)
    expect(result.status).toBe('READY_FOR_REVIEW')
    expect(updateBody).toMatchObject({ order_status: 'READY_FOR_REVIEW' })
    // Optimistic guard: must filter by current status to prevent races
    expect(updateGuardEqs.map(([k]) => k)).toContain('order_status')
    expect(historyInserts).toHaveLength(1)
    expect(historyInserts[0]).toMatchObject({
      order_id: 'ord-1',
      old_status: 'AWAITING_DOCUMENTS',
      new_status: 'READY_FOR_REVIEW',
      changed_by_user_id: 'user-1',
    })
  })

  it('uses a custom reason when provided', async () => {
    orderRow = { id: 'ord-2', order_status: 'AWAITING_DOCUMENTS' }
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    await advanceOrderAfterDocumentUpload({
      orderId: 'ord-2',
      changedByUserId: 'user-2',
      reason: '3 documento(s) enviado(s) — análise solicitada',
    })

    expect(historyInserts[0]?.reason).toBe('3 documento(s) enviado(s) — análise solicitada')
  })

  it('is a no-op for orders already past AWAITING_DOCUMENTS', async () => {
    orderRow = { id: 'ord-3', order_status: 'AWAITING_PAYMENT' }
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    const result = await advanceOrderAfterDocumentUpload({
      orderId: 'ord-3',
      changedByUserId: 'user-3',
    })

    expect(result.transitioned).toBe(false)
    expect(result.status).toBe('AWAITING_PAYMENT')
    expect(updateBody).toBeNull()
    expect(historyInserts).toHaveLength(0)
  })

  it('returns null status gracefully when the order does not exist', async () => {
    orderRow = null
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    const result = await advanceOrderAfterDocumentUpload({
      orderId: 'missing',
      changedByUserId: 'user-x',
    })

    expect(result.transitioned).toBe(false)
    expect(result.status).toBeNull()
    expect(updateBody).toBeNull()
    expect(historyInserts).toHaveLength(0)
  })

  it('does not roll back the status update when the history insert fails', async () => {
    orderRow = { id: 'ord-4', order_status: 'AWAITING_DOCUMENTS' }
    historyShouldFail = true
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    const result = await advanceOrderAfterDocumentUpload({
      orderId: 'ord-4',
      changedByUserId: 'user-4',
    })

    // The order is in the right state; the history failure is logged
    // but the function reports the transition succeeded — which is the
    // correct accounting. (We trade traceability for correctness.)
    expect(result.transitioned).toBe(true)
    expect(result.status).toBe('READY_FOR_REVIEW')
    expect(updateBody).toMatchObject({ order_status: 'READY_FOR_REVIEW' })
  })

  it('reports no-transition when the orders update fails', async () => {
    orderRow = { id: 'ord-5', order_status: 'AWAITING_DOCUMENTS' }
    updateShouldFail = true
    const { advanceOrderAfterDocumentUpload } = await import('@/lib/orders/document-transitions')

    const result = await advanceOrderAfterDocumentUpload({
      orderId: 'ord-5',
      changedByUserId: 'user-5',
    })

    expect(result.transitioned).toBe(false)
    expect(result.status).toBe('AWAITING_DOCUMENTS')
    expect(historyInserts).toHaveLength(0)
  })
})
