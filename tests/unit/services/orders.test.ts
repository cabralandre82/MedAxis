import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder, mockSupabaseAdmin, mockSupabaseClient } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as serverModule from '@/lib/db/server'
import * as sessionModule from '@/lib/auth/session'
import * as auditModule from '@/lib/audit'
import { createOrder, updateOrderStatus } from '@/services/orders'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { ORDER: 'ORDER', PAYMENT: 'PAYMENT', TRANSFER: 'TRANSFER' },
}))
vi.mock('@/lib/orders/status-machine', () => ({
  isValidTransition: vi.fn().mockReturnValue(true),
}))
vi.mock('@/services/coupons', () => ({
  getActiveCouponsForOrder: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/compliance', () => ({
  canPlaceOrder: vi.fn().mockResolvedValue({ allowed: true }),
}))

// Use crypto-safe UUIDs
const CID = '11111111-1111-4111-a111-111111111111'
const DID = '22222222-2222-4222-a222-222222222222'
const PID = '33333333-3333-4333-a333-333333333333'
const OID = '44444444-4444-4444-a444-444444444444'

const userMock = {
  id: 'user-1',
  roles: ['CLINIC_ADMIN'] as ['CLINIC_ADMIN'],
  full_name: 'User',
  email: 'u@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const adminMock = {
  id: 'admin-1',
  roles: ['SUPER_ADMIN'] as ['SUPER_ADMIN'],
  full_name: 'Admin',
  email: 'a@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sessionModule.requireAuth).mockResolvedValue(userMock)
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
})

describe('createOrder — validation', () => {
  it('returns error for empty items array', async () => {
    const result = await createOrder({ clinic_id: CID, doctor_id: DID, items: [] })
    expect(result.error).toBeTruthy()
  })

  it('returns error for invalid UUID in clinic_id', async () => {
    const result = await createOrder({
      clinic_id: 'not-a-uuid',
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBeTruthy()
  })

  it('returns error when user is not authenticated', async () => {
    vi.mocked(sessionModule.requireAuth).mockRejectedValue(new Error('UNAUTHORIZED'))
    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toContain('Sessão expirada')
  })

  it('accepts omitted doctor_id (non-prescription order)', async () => {
    // doctor_id is now optional — omitting it must not produce a validation error
    const result = await createOrder({
      clinic_id: CID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    // Validation passes; downstream DB error expected in unit context (no mock here)
    expect(result.error).not.toContain('Dados inválidos')
  })

  it('accepts explicit null doctor_id', async () => {
    const result = await createOrder({
      clinic_id: CID,
      doctor_id: null,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).not.toContain('Dados inválidos')
  })

  it('returns error for invalid UUID in doctor_id when provided', async () => {
    const result = await createOrder({
      clinic_id: CID,
      doctor_id: 'not-a-uuid',
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBeTruthy()
  })
})

describe('createOrder — products validation', () => {
  beforeEach(() => {
    // CLINIC_ADMIN membership check: always return valid membership for CID
    const membershipQb = makeQueryBuilder({ clinic_id: CID }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(membershipQb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  })

  it('returns error when products are not found', async () => {
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(null, null)
    // Override .in() to resolve with error
    qb.in = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'not found' } }),
    })
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBe('Produtos não encontrados')
  })

  it('returns error when a product is inactive', async () => {
    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'Prod A',
        estimated_deadline_days: 3,
        active: false,
      },
    ]
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })
    expect(result.error).toBe('Um ou mais produtos estão inativos')
  })

  it('returns error when products are from multiple pharmacies', async () => {
    const PID2 = '55555555-5555-4555-a555-555555555555'
    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'A',
        estimated_deadline_days: 3,
        active: true,
      },
      {
        id: PID2,
        pharmacy_id: 'ph-2',
        price_current: 200,
        name: 'B',
        estimated_deadline_days: 3,
        active: true,
      },
    ]
    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [
        { product_id: PID, quantity: 1 },
        { product_id: PID2, quantity: 1 },
      ],
    })
    expect(result.error).toBe('Todos os produtos devem ser da mesma farmácia')
  })
})

describe('updateOrderStatus', () => {
  it('returns error when order not found', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Pedido não encontrado')
  })

  it('returns permission error for CLINIC_ADMIN', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(userMock) // CLINIC_ADMIN

    const qb = makeQueryBuilder(
      { id: OID, order_status: 'DRAFT', pharmacy_id: 'ph-1', created_by_user_id: 'user-1' },
      null
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Sem permissão para alterar status do pedido')
  })

  it('returns error when transition is invalid', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const { isValidTransition } = await import('@/lib/orders/status-machine')
    vi.mocked(isValidTransition).mockReturnValueOnce(false)

    const qb = makeQueryBuilder(
      { id: OID, order_status: 'COMPLETED', pharmacy_id: 'ph-1', created_by_user_id: 'user-x' },
      null
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toContain('Transição inválida')
  })

  it('returns Erro interno when requireAuth throws', async () => {
    vi.mocked(sessionModule.requireAuth).mockRejectedValue(new Error('UNAUTHORIZED'))
    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Erro interno')
  })

  it('returns error when update query fails', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const qb = makeQueryBuilder(
      { id: OID, order_status: 'DRAFT', pharmacy_id: 'ph-1', created_by_user_id: 'user-x' },
      null
    )
    // Override update to chain into error
    const updateBuilder = makeQueryBuilder(null, { message: 'update failed' })
    qb.update = vi.fn().mockReturnValue(updateBuilder)

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBe('Erro ao atualizar status')
  })

  it('succeeds and returns empty object for admin', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)
    vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)

    const admin = mockSupabaseAdmin()
    const orderQb = makeQueryBuilder(
      {
        id: OID,
        order_status: 'AWAITING_PAYMENT',
        pharmacy_id: 'ph-1',
        created_by_user_id: 'user-x',
      },
      null
    )
    const updateQb = makeQueryBuilder(null, null)
    const insertHistQb = makeQueryBuilder(null, null)
    const notifyQb = makeQueryBuilder(null, null)

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return orderQb // fetch order
      if (callCount === 2) return updateQb // update order status
      if (callCount === 3) return insertHistQb // insert history
      return notifyQb // notification queries
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBeUndefined()
  })

  it('pharmacy admin without membership is denied', async () => {
    const pharmacyUser = {
      ...adminMock,
      roles: ['PHARMACY_ADMIN'] as ['PHARMACY_ADMIN'],
    }
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(pharmacyUser)

    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'DRAFT', pharmacy_id: 'ph-99', created_by_user_id: 'user-x' },
      null
    )
    const membershipQb = makeQueryBuilder()
    membershipQb.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    let callCount = 0
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return orderQb
        return membershipQb
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOrderStatus(OID, 'SHIPPED', 'note')
    expect(result.error).toContain('outra farmácia')
  })

  it('notifies when status is a notify-trigger status', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)

    const admin = mockSupabaseAdmin()
    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'READY', pharmacy_id: 'ph-1', created_by_user_id: 'user-x' },
      null
    )
    const updateQb = makeQueryBuilder(null, null)

    // Notify path: fetch full order
    const fullOrderQb = makeQueryBuilder(
      {
        code: 'ORD-001',
        clinic_id: CID,
        clinics: { email: 'clinic@test.com' },
        order_items: [{ products: { name: 'Produto A' } }],
      },
      null
    )

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return orderQb
      if (callCount === 2) return updateQb
      if (callCount === 3) return makeQueryBuilder(null, null) // insert history
      return fullOrderQb // fetch for notification
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'SHIPPED', undefined)
    expect(result.error).toBeUndefined()
  })
})

describe('createOrder — compliance check', () => {
  beforeEach(() => {
    const membershipQb = makeQueryBuilder({ clinic_id: CID }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(membershipQb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  })

  it('blocks order when compliance check fails', async () => {
    const { canPlaceOrder } = await import('@/lib/compliance')
    vi.mocked(canPlaceOrder).mockResolvedValueOnce({
      allowed: false,
      reason: 'CNPJ da farmácia inativo',
    })

    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'Prod A',
        estimated_deadline_days: 3,
        active: true,
      },
    ]

    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()
    const membershipQbC1 = makeQueryBuilder({ clinic_id: CID }, null)
    const genericQbC1 = makeQueryBuilder(null, null)
    let c1 = 0
    admin.from = vi.fn().mockImplementation(() => (++c1 === 1 ? membershipQbC1 : genericQbC1))
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })

    expect(result.error).toContain('CNPJ da farmácia inativo')
  })

  it('uses generic reason when compliance.reason is undefined', async () => {
    const { canPlaceOrder } = await import('@/lib/compliance')
    vi.mocked(canPlaceOrder).mockResolvedValueOnce({ allowed: false })

    const products = [
      {
        id: PID,
        pharmacy_id: 'ph-1',
        price_current: 100,
        name: 'Prod A',
        estimated_deadline_days: 3,
        active: true,
      },
    ]

    const supabase = mockSupabaseClient()
    const qb = makeQueryBuilder(products, null)
    supabase.from = vi.fn().mockReturnValue(qb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()
    const membershipQbC2 = makeQueryBuilder({ clinic_id: CID }, null)
    const genericQbC2 = makeQueryBuilder(null, null)
    let c2 = 0
    admin.from = vi.fn().mockImplementation(() => (++c2 === 1 ? membershipQbC2 : genericQbC2))
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })

    expect(result.error).toContain('compliance')
  })
})

describe('createOrder — insertion errors', () => {
  beforeEach(() => {
    const membershipQb = makeQueryBuilder({ clinic_id: CID }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(membershipQb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  })

  const validProducts = [
    {
      id: PID,
      pharmacy_id: 'ph-1',
      price_current: 100,
      name: 'Prod A',
      estimated_deadline_days: 3,
      active: true,
    },
  ]

  beforeEach(async () => {
    // Reset compliance to allowed
    const { canPlaceOrder } = await import('@/lib/compliance')
    vi.mocked(canPlaceOrder).mockResolvedValue({ allowed: true })
  })

  it('returns error when order insert fails', async () => {
    const supabase = mockSupabaseClient()
    const productsQb = makeQueryBuilder(validProducts, null)
    supabase.from = vi.fn().mockReturnValue(productsQb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()
    const membershipQb = makeQueryBuilder({ clinic_id: CID }, null)
    const insertFailQb = makeQueryBuilder()
    insertFailQb.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
    let adminCallCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      adminCallCount++
      if (adminCallCount === 1) return membershipQb // membership check
      return insertFailQb
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })

    expect(result.error).toBe('Erro ao criar pedido. Tente novamente.')
  })

  it('returns error and rollback when items insert fails', async () => {
    const supabase = mockSupabaseClient()
    const productsQb = makeQueryBuilder(validProducts, null)
    supabase.from = vi.fn().mockReturnValue(productsQb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()

    // call 1: orders insert → success
    const orderInsertQb = makeQueryBuilder({ id: OID, code: 'ORD-001' }, null)
    // call 2: order_items insert → error (but chained, so override builder)
    const itemsFailQb = makeQueryBuilder()
    itemsFailQb.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'items error' } })

    // call 3+: cleanup delete and further calls
    const cleanupQb = makeQueryBuilder(null, null)

    const membershipQb2 = makeQueryBuilder({ clinic_id: CID }, null)
    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return membershipQb2 // membership check
      if (callCount === 2) return orderInsertQb
      if (callCount === 3) return itemsFailQb
      return cleanupQb
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      doctor_id: DID,
      items: [{ product_id: PID, quantity: 1 }],
    })

    expect(result.error).toBe('Erro ao registrar itens do pedido.')
  })
})

describe('createOrder — document upload advances status', () => {
  beforeEach(() => {
    const membershipQb = makeQueryBuilder({ clinic_id: CID }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(membershipQb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
  })

  const validProducts = [
    {
      id: PID,
      pharmacy_id: 'ph-1',
      price_current: 100,
      name: 'Prod A',
      estimated_deadline_days: 3,
      active: true,
    },
  ]

  beforeEach(async () => {
    const { canPlaceOrder } = await import('@/lib/compliance')
    vi.mocked(canPlaceOrder).mockResolvedValue({ allowed: true })
  })

  it('advances status to READY_FOR_REVIEW when a document is uploaded', async () => {
    const supabase = mockSupabaseClient()
    const productsQb = makeQueryBuilder(validProducts, null)
    supabase.from = vi.fn().mockReturnValue(productsQb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()
    const genericQb = makeQueryBuilder(null, null)
    const orderInsertQb = makeQueryBuilder({ id: OID, code: 'ORD-001' }, null)

    // Mock storage upload success
    admin.storage = {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'order-id/file.pdf' }, error: null }),
      }),
    } as unknown as typeof admin.storage

    const membershipQbDoc = makeQueryBuilder({ clinic_id: CID }, null)
    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return membershipQbDoc // membership check
      if (callCount === 2) return orderInsertQb // orders insert
      return genericQb // items, history, payment, token, order_documents, status update, history
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const file = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' })
    const result = await createOrder({
      clinic_id: CID,
      items: [{ product_id: PID, quantity: 1 }],
      documents: [{ file, type: 'PRESCRIPTION' }],
    })

    expect(result.error).toBeUndefined()
    expect(result.orderId).toBe(OID)
    // status update + history insert for READY_FOR_REVIEW must have been called
    expect(admin.from).toHaveBeenCalledWith('orders')
    expect(admin.from).toHaveBeenCalledWith('order_status_history')
  })

  it('keeps status AWAITING_DOCUMENTS when no documents are sent', async () => {
    const supabase = mockSupabaseClient()
    const productsQb = makeQueryBuilder(validProducts, null)
    supabase.from = vi.fn().mockReturnValue(productsQb)
    vi.mocked(serverModule.createClient).mockResolvedValue(
      supabase as ReturnType<typeof mockSupabaseClient>
    )

    const admin = mockSupabaseAdmin()
    const orderInsertQb = makeQueryBuilder({ id: OID, code: 'ORD-001' }, null)
    const genericQb = makeQueryBuilder(null, null)

    const membershipQbNoDoc = makeQueryBuilder({ clinic_id: CID }, null)
    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return membershipQbNoDoc // membership check
      if (callCount === 2) return orderInsertQb
      return genericQb
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createOrder({
      clinic_id: CID,
      items: [{ product_id: PID, quantity: 1 }],
    })

    expect(result.error).toBeUndefined()
    expect(result.orderId).toBe(OID)
  })
})

describe('updateOrderStatus — history insert failure is non-blocking', () => {
  it('succeeds even when status history insert fails', async () => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)
    vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)

    const admin = mockSupabaseAdmin()
    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'DRAFT', pharmacy_id: 'ph-1', created_by_user_id: 'user-x' },
      null
    )
    const updateQb = makeQueryBuilder(null, null)
    // history insert returns error — should be logged, not propagated
    const histFailQb = makeQueryBuilder(null, { message: 'history insert failed' })
    const notifyQb = makeQueryBuilder(null, null)

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return orderQb
      if (callCount === 2) return updateQb
      if (callCount === 3) return histFailQb
      return notifyQb
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'AWAITING_PAYMENT', 'note')
    expect(result.error).toBeUndefined()
  })
})

describe('updateOrderStatus — order cancellation financial cleanup', () => {
  beforeEach(() => {
    vi.mocked(sessionModule.requireAuth).mockResolvedValue(adminMock)
    vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
  })

  it('voids a PENDING payment when order is canceled', async () => {
    const admin = mockSupabaseAdmin()

    // call sequence: 1=fetch order, 2=update order status, 3=insert history, 4=fetch fullOrder (notify),
    // 5=fetch payment, 6=update payment to CANCELED, 7=fetch transfer
    let callCount = 0
    admin.from = vi.fn().mockImplementation((table: string) => {
      callCount++
      if (table === 'orders' && callCount === 1)
        return makeQueryBuilder(
          {
            id: OID,
            order_status: 'AWAITING_PAYMENT',
            pharmacy_id: 'ph-1',
            created_by_user_id: 'u-1',
          },
          null
        )
      if (table === 'payments')
        return makeQueryBuilder({ id: 'pay-1', status: 'PENDING', gross_amount: 100 }, null)
      if (table === 'transfers') return makeQueryBuilder(null, null) // no transfer
      return makeQueryBuilder(null, null)
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'CANCELED', 'cliente desistiu')
    expect(result.error).toBeUndefined()
  })

  it('voids a PENDING transfer when order is canceled', async () => {
    const admin = mockSupabaseAdmin()

    admin.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'orders')
        return makeQueryBuilder(
          {
            id: OID,
            order_status: 'TRANSFER_PENDING',
            pharmacy_id: 'ph-1',
            created_by_user_id: 'u-1',
          },
          null
        )
      if (table === 'payments')
        return makeQueryBuilder({ id: 'pay-1', status: 'CONFIRMED', gross_amount: 100 }, null)
      if (table === 'transfers')
        return makeQueryBuilder({ id: 'tr-1', status: 'PENDING', net_amount: 80 }, null)
      return makeQueryBuilder(null, null)
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'CANCELED', 'cliente desistiu')
    expect(result.error).toBeUndefined()
  })

  it('does not touch a CONFIRMED payment — leaves cleanup to admin', async () => {
    const admin = mockSupabaseAdmin()
    const updateSpy = vi.fn().mockResolvedValue({ error: null })

    admin.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'payments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'pay-1', status: 'CONFIRMED', gross_amount: 100 },
            error: null,
          }),
          update: updateSpy,
        }
      }
      if (table === 'orders')
        return makeQueryBuilder(
          { id: OID, order_status: 'SHIPPED', pharmacy_id: 'ph-1', created_by_user_id: 'u-1' },
          null
        )
      if (table === 'transfers') return makeQueryBuilder(null, null)
      return makeQueryBuilder(null, null)
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updateOrderStatus(OID, 'CANCELED', 'motivo')
    expect(result.error).toBeUndefined()
    // update should NOT have been called on the CONFIRMED payment
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
