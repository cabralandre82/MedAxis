// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/prescription-rules', () => ({
  isPrescriptionRequirementMet: vi.fn(),
  getPrescriptionState: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditEntity: { ORDER: 'ORDER' },
  AuditAction: { UPDATE: 'UPDATE' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { getCurrentUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/db/admin'
import { isPrescriptionRequirementMet, getPrescriptionState } from '@/lib/prescription-rules'

const ADMIN_USER = {
  id: 'admin-1',
  roles: ['SUPER_ADMIN'],
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/orders/order-1/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(id = 'order-1') {
  return { params: Promise.resolve({ id }) }
}

function makeAdmin(order: object | null) {
  const historyInsert = vi.fn().mockResolvedValue({ error: null })
  const orderUpdate = vi.fn().mockResolvedValue({ error: null })
  const historyInsertChain = { insert: historyInsert }
  const orderChain = {
    update: () => ({ eq: () => orderUpdate() }),
    insert: () => historyInsert(),
  }

  return {
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: order, error: null }) }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      }
      if (table === 'order_status_history') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      if (table === 'pharmacy_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: () => Promise.resolve({ data: { id: 'm1' }, error: null }) }),
            }),
          }),
        }
      }
      return orderChain
    },
    _historyInsert: historyInsert,
  }
}

describe('POST /api/orders/[id]/advance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(isPrescriptionRequirementMet as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(getPrescriptionState as ReturnType<typeof vi.fn>).mockResolvedValue({
      met: true,
      items: [],
    })
  })

  it('TC-ADV-01: unauthenticated → 401', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'READY_FOR_REVIEW' }), makeParams())
    expect(res.status).toBe(401)
  })

  it('TC-ADV-02: non-admin/pharmacy user → 403', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      roles: ['CLINIC_ADMIN'],
    })

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'READY_FOR_REVIEW' }), makeParams())
    expect(res.status).toBe(403)
  })

  it('TC-ADV-03: invalid transition → 422', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({ id: 'order-1', order_status: 'COMPLETED', clinic_id: 'c1', pharmacy_id: 'p1' })
    )

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'AWAITING_DOCUMENTS' }), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('Transição inválida')
  })

  it('TC-ADV-04: leaving AWAITING_DOCUMENTS with prescriptions unmet → 422', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        id: 'order-1',
        order_status: 'AWAITING_DOCUMENTS',
        clinic_id: 'c1',
        pharmacy_id: 'p1',
      })
    )
    ;(isPrescriptionRequirementMet as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    ;(getPrescriptionState as ReturnType<typeof vi.fn>).mockResolvedValue({
      met: false,
      reason: '"Controlado Z": 3 receita(s) faltando',
      items: [],
    })

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'READY_FOR_REVIEW' }), makeParams())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Receitas médicas pendentes')
    expect(body.detail).toContain('Controlado Z')
  })

  it('TC-ADV-05: prescriptions met, valid transition → 200', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        id: 'order-1',
        order_status: 'AWAITING_DOCUMENTS',
        clinic_id: 'c1',
        pharmacy_id: 'p1',
      })
    )
    ;(isPrescriptionRequirementMet as ReturnType<typeof vi.fn>).mockResolvedValue(true)

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'READY_FOR_REVIEW' }), makeParams())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.status).toBe('READY_FOR_REVIEW')
  })

  it('TC-ADV-06: cancellation from AWAITING_DOCUMENTS bypasses prescription check', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        id: 'order-1',
        order_status: 'AWAITING_DOCUMENTS',
        clinic_id: 'c1',
        pharmacy_id: 'p1',
      })
    )
    ;(isPrescriptionRequirementMet as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'CANCELED' }), makeParams())
    expect(res.status).toBe(200)
    // isPrescriptionRequirementMet should NOT have been called
    expect(isPrescriptionRequirementMet).not.toHaveBeenCalled()
  })

  it('TC-ADV-07: order not found → 404', async () => {
    ;(getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN_USER)
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin(null))

    const { POST } = await import('@/app/api/orders/[id]/advance/route')
    const res = await POST(makeRequest({ newStatus: 'READY_FOR_REVIEW' }), makeParams())
    expect(res.status).toBe(404)
  })
})
