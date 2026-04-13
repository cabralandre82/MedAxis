import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder, mockSupabaseAdmin } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import * as notifModule from '@/lib/notifications'
import { reviewDocument, removeOrderItem } from '@/services/document-review'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { UPDATE: 'UPDATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { ORDER: 'ORDER' },
}))
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

const OID = '11111111-1111-4111-a111-111111111111'
const DID = '22222222-2222-4222-a222-222222222222'
const IID = '33333333-3333-4333-a333-333333333333'

const pharmacyActor = {
  id: 'ph-user-1',
  roles: ['PHARMACY_ADMIN'] as ['PHARMACY_ADMIN'],
  full_name: 'Farmácia Admin',
  email: 'ph@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const clinicActor = {
  id: 'clinic-user-1',
  roles: ['CLINIC_ADMIN'] as ['CLINIC_ADMIN'],
  full_name: 'Clínica Admin',
  email: 'clinic@test.com',
  is_active: true,
  registration_status: 'APPROVED' as const,
  notification_preferences: {},
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
  vi.mocked(notifModule.createNotification).mockResolvedValue(undefined)
})

describe('reviewDocument', () => {
  it('returns error when rejection reason is missing for REJECTED decision', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActor)
    const result = await reviewDocument(DID, 'REJECTED', '')
    expect(result.error).toBe('Informe o motivo da rejeição')
  })

  it('returns error when document is not found', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActor)
    const admin = mockSupabaseAdmin()
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: null })
    admin.from = vi.fn().mockReturnValue(qb)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const result = await reviewDocument(DID, 'APPROVED')
    expect(result.error).toBe('Documento não encontrado')
  })

  it('returns error when order is not in READY_FOR_REVIEW', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActor)
    const admin = mockSupabaseAdmin()

    const docQb = makeQueryBuilder({ id: DID, order_id: OID }, null)
    const orderQb = makeQueryBuilder(
      {
        id: OID,
        order_status: 'AWAITING_PAYMENT',
        clinic_id: 'c1',
        pharmacy_id: 'ph-1',
        created_by_user_id: 'u1',
      },
      null
    )

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return docQb
      return orderQb
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await reviewDocument(DID, 'APPROVED')
    expect(result.error).toBe('Pedido não está em revisão')
  })

  it('returns Sem permissão when PHARMACY_ADMIN does not belong to the order pharmacy', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActor)
    const admin = mockSupabaseAdmin()

    const docQb = makeQueryBuilder({ id: DID, order_id: OID }, null)
    const orderQb = makeQueryBuilder(
      {
        id: OID,
        order_status: 'READY_FOR_REVIEW',
        clinic_id: 'c1',
        pharmacy_id: 'ph-99',
        created_by_user_id: 'u1',
      },
      null
    )
    const memberQb = makeQueryBuilder(null, null)
    memberQb.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return docQb
      if (callCount === 2) return orderQb
      return memberQb
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await reviewDocument(DID, 'APPROVED')
    expect(result.error).toContain('outra farmácia')
  })
})

describe('removeOrderItem', () => {
  it('returns error when order is not in AWAITING_DOCUMENTS', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(clinicActor)
    const admin = mockSupabaseAdmin()

    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'READY_FOR_REVIEW', clinic_id: 'c1', created_by_user_id: 'u1' },
      null
    )
    admin.from = vi.fn().mockReturnValue(orderQb)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await removeOrderItem(OID, IID)
    expect(result.error).toContain('aguarda documentação')
  })

  it('returns error when item doc_status is not REJECTED_DOCS', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(clinicActor)
    const admin = mockSupabaseAdmin()

    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'AWAITING_DOCUMENTS', clinic_id: 'c1', created_by_user_id: 'u1' },
      null
    )
    const memberQb = makeQueryBuilder(null, null)
    memberQb.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { user_id: 'clinic-user-1' }, error: null })
    const itemQb = makeQueryBuilder({ id: IID, doc_status: 'OK' }, null)

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return orderQb
      if (callCount === 2) return memberQb
      return itemQb
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await removeOrderItem(OID, IID)
    expect(result.error).toContain('documentação rejeitada')
  })

  it('cancels order when removing the last item', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(clinicActor)
    const admin = mockSupabaseAdmin()

    const orderQb = makeQueryBuilder(
      { id: OID, order_status: 'AWAITING_DOCUMENTS', clinic_id: 'c1', created_by_user_id: 'u1' },
      null
    )
    const memberQb = makeQueryBuilder(null, null)
    memberQb.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { user_id: 'clinic-user-1' }, error: null })
    const itemQb = makeQueryBuilder({ id: IID, doc_status: 'REJECTED_DOCS' }, null)
    // count = 1 (last item)
    const countQb = makeQueryBuilder(null, null)
    countQb.select = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
    })
    const genericQb = makeQueryBuilder(null, null)

    let callCount = 0
    admin.from = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return orderQb
      if (callCount === 2) return memberQb
      if (callCount === 3) return itemQb
      if (callCount === 4) return countQb
      return genericQb
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await removeOrderItem(OID, IID)
    expect(result.error).toBeUndefined()
    // orders.update (CANCELED) must have been called
    expect(admin.from).toHaveBeenCalledWith('orders')
    expect(admin.from).toHaveBeenCalledWith('order_status_history')
  })
})
