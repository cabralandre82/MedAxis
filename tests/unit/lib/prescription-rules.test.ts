// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createAdminClient } from '@/lib/db/admin'

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {}
  chain.eq = () => chain
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve)
  // make it thenable so await works
  return new Proxy(chain, {
    get(target, prop) {
      if (prop === 'eq') return () => chain
      if (prop === 'then')
        return (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve)
      return target[prop as string]
    },
  })
}

function makeAdmin({
  items = [],
  perUnitDocs = [],
  simpleDocs = [],
}: {
  items?: unknown[]
  perUnitDocs?: unknown[]
  simpleDocs?: unknown[]
}) {
  const mockFrom = (table: string) => {
    if (table === 'order_items') {
      return { select: () => makeChain(items) }
    }
    if (table === 'order_item_prescriptions') {
      // .select().eq('order_id', orderId) → resolves to { data: perUnitDocs }
      return { select: () => makeChain(perUnitDocs) }
    }
    if (table === 'order_documents') {
      // .select().eq('order_id', orderId).eq('document_type', 'PRESCRIPTION')
      return { select: () => makeChain(simpleDocs) }
    }
    return { select: () => makeChain([]) }
  }
  return { from: mockFrom }
}

describe('getPrescriptionState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-RX-01: order with no prescription products → met=true, anyRequiresPrescription=false', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-1',
            quantity: 2,
            product_id: 'prod-1',
            products: {
              id: 'prod-1',
              name: 'Vitamina C',
              requires_prescription: false,
              prescription_type: null,
              max_units_per_prescription: null,
            },
          },
        ],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(true)
    expect(result.anyRequiresPrescription).toBe(false)
    expect(result.needsSimplePrescription).toBe(false)
    expect(result.needsPerUnitPrescription).toBe(false)
    expect(result.items[0].satisfied).toBe(true)
  })

  it('TC-RX-02: Model A product without uploaded prescription → met=false', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-1',
            quantity: 3,
            product_id: 'prod-rx',
            products: {
              id: 'prod-rx',
              name: 'Medicamento X',
              requires_prescription: true,
              prescription_type: 'SIMPLE',
              max_units_per_prescription: null,
            },
          },
        ],
        simpleDocs: [],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(false)
    expect(result.needsSimplePrescription).toBe(true)
    expect(result.items[0].satisfied).toBe(false)
    expect(result.items[0].prescriptions_needed).toBe(1)
    expect(result.reason).toContain('Medicamento X')
  })

  it('TC-RX-03: Model A product with prescription uploaded → met=true', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-1',
            quantity: 3,
            product_id: 'prod-rx',
            products: {
              id: 'prod-rx',
              name: 'Medicamento X',
              requires_prescription: true,
              prescription_type: 'SIMPLE',
              max_units_per_prescription: null,
            },
          },
        ],
        simpleDocs: [{ id: 'doc-1' }],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(true)
    expect(result.items[0].satisfied).toBe(true)
    expect(result.items[0].units_covered).toBe(3) // covers full quantity
  })

  it('TC-RX-04: Model B product (1 per unit), quantity=3, 0 uploaded → 3 needed', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-2',
            quantity: 3,
            product_id: 'prod-ctrl',
            products: {
              id: 'prod-ctrl',
              name: 'Controlado Z',
              requires_prescription: true,
              prescription_type: 'SPECIAL_CONTROL',
              max_units_per_prescription: 1,
            },
          },
        ],
        perUnitDocs: [],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(false)
    expect(result.needsPerUnitPrescription).toBe(true)
    const item = result.items[0]
    expect(item.prescriptions_needed).toBe(3)
    expect(item.units_covered).toBe(0)
    expect(item.satisfied).toBe(false)
    expect(result.reason).toContain('3 receita(s) faltando')
  })

  it('TC-RX-05: Model B quantity=3, 2 uploaded covering 2 units → 1 still needed', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-2',
            quantity: 3,
            product_id: 'prod-ctrl',
            products: {
              id: 'prod-ctrl',
              name: 'Controlado Z',
              requires_prescription: true,
              prescription_type: 'SPECIAL_CONTROL',
              max_units_per_prescription: 1,
            },
          },
        ],
        perUnitDocs: [
          { order_item_id: 'item-2', units_covered: 1 },
          { order_item_id: 'item-2', units_covered: 1 },
        ],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    const item = result.items[0]
    expect(item.units_covered).toBe(2)
    expect(item.prescriptions_uploaded).toBe(2)
    expect(item.prescriptions_needed).toBe(1)
    expect(item.satisfied).toBe(false)
    expect(result.met).toBe(false)
  })

  it('TC-RX-06: Model B quantity=3, 3 uploaded → satisfied', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-2',
            quantity: 3,
            product_id: 'prod-ctrl',
            products: {
              id: 'prod-ctrl',
              name: 'Controlado Z',
              requires_prescription: true,
              prescription_type: 'SPECIAL_CONTROL',
              max_units_per_prescription: 1,
            },
          },
        ],
        perUnitDocs: [
          { order_item_id: 'item-2', units_covered: 1 },
          { order_item_id: 'item-2', units_covered: 1 },
          { order_item_id: 'item-2', units_covered: 1 },
        ],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(true)
    expect(result.items[0].satisfied).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('TC-RX-07: max_units_per_prescription=2, quantity=5 → ceil(5/2)=3 prescriptions needed', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(
      makeAdmin({
        items: [
          {
            id: 'item-3',
            quantity: 5,
            product_id: 'prod-m',
            products: {
              id: 'prod-m',
              name: 'Medicamento M',
              requires_prescription: true,
              prescription_type: 'SIMPLE',
              max_units_per_prescription: 2,
            },
          },
        ],
        perUnitDocs: [],
      })
    )

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.items[0].prescriptions_needed).toBe(3)
  })

  it('TC-RX-08: DB error fetching items → met=false with error reason', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'DB error' } }),
        }),
      }),
    })

    const { getPrescriptionState } = await import('@/lib/prescription-rules')
    const result = await getPrescriptionState('order-1')

    expect(result.met).toBe(false)
    expect(result.reason).toContain('Erro ao verificar')
  })

  it('TC-RX-09: isPrescriptionRequirementMet returns boolean wrapper', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(makeAdmin({ items: [] }))

    const { isPrescriptionRequirementMet } = await import('@/lib/prescription-rules')
    const met = await isPrescriptionRequirementMet('order-1')
    expect(typeof met).toBe('boolean')
    expect(met).toBe(true)
  })
})
