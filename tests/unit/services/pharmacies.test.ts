import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import { createPharmacy, updatePharmacy, updatePharmacyStatus } from '@/services/pharmacies'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/compliance', () => ({
  validateCNPJ: vi.fn().mockResolvedValue({ valid: true, situation: 'ATIVA' }),
  canPlaceOrder: vi.fn(),
  canAcceptOrder: vi.fn(),
}))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { PHARMACY: 'PHARMACY' },
}))
vi.mock('@/lib/validators', () => ({
  pharmacySchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { trade_name: 'Farmácia Teste', cnpj: '11222333000181', email: 'f@test.com' },
    }),
  },
}))

const actorMock = {
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
  vi.mocked(rbacModule.requireRole).mockResolvedValue(actorMock)
  vi.mocked(auditModule.createAuditLog).mockResolvedValue(undefined)
})

describe('createPharmacy', () => {
  it('creates pharmacy and returns id', async () => {
    const qb = makeQueryBuilder({ id: 'ph-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'ph-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: '11222333000181',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])
    expect(result.id).toBe('ph-1')
    expect(result.error).toBeUndefined()
  })

  it('returns CNPJ error on duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'cnpj dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: '11222333000181',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])
    expect(result.error).toBe('CNPJ já cadastrado')
  })

  it('returns generic error on other DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '99999', message: 'other' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: '11222333000181',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])
    expect(result.error).toBe('Erro ao criar farmácia')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: '11222333000181',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])
    expect(result.error).toBe('Sem permissão')
  })

  it('returns validation error when schema fails', async () => {
    const validators = await import('@/lib/validators')
    vi.mocked(
      (validators as Record<string, unknown>).pharmacySchema as {
        safeParse: ReturnType<typeof vi.fn>
      }
    ).safeParse.mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'CNPJ inválido' }] },
    })

    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: 'bad',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])
    expect(result.error).toBe('CNPJ inválido')
  })
})

describe('createPharmacy — entity_type', () => {
  it('creates a distributor when entity_type is DISTRIBUTOR', async () => {
    const validators = await import('@/lib/validators')
    vi.mocked(
      (validators as Record<string, unknown>).pharmacySchema as {
        safeParse: ReturnType<typeof vi.fn>
      }
    ).safeParse.mockReturnValueOnce({
      success: true,
      data: {
        trade_name: 'Dist Teste',
        cnpj: '11222333000181',
        email: 'd@test.com',
        entity_type: 'DISTRIBUTOR',
      },
    })

    const qb = makeQueryBuilder({ id: 'dist-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'dist-1' }, error: null })
    const fromMock = vi.fn().mockReturnValue(qb)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createPharmacy({
      trade_name: 'Dist Teste',
      cnpj: '11222333000181',
      email: 'd@test.com',
    } as Parameters<typeof createPharmacy>[0])

    expect(result.id).toBe('dist-1')
    expect(result.error).toBeUndefined()
    const insertCall = qb.insert as ReturnType<typeof vi.fn>
    expect(insertCall).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'DISTRIBUTOR' }))
  })

  it('defaults entity_type to PHARMACY when not provided', async () => {
    const qb = makeQueryBuilder({ id: 'ph-2' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'ph-2' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createPharmacy({
      trade_name: 'F',
      cnpj: '11222333000181',
      email: 'f@test.com',
    } as Parameters<typeof createPharmacy>[0])

    expect(result.id).toBe('ph-2')
    const insertCall = qb.insert as ReturnType<typeof vi.fn>
    expect(insertCall).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'PHARMACY' }))
  })
})

describe('updatePharmacy', () => {
  it('updates pharmacy successfully', async () => {
    const qb = makeQueryBuilder({ id: 'ph-1', trade_name: 'Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updatePharmacy('ph-1', { trade_name: 'New' })
    expect(result.error).toBeUndefined()
  })

  it('returns error when DB update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updatePharmacy('ph-1', { trade_name: 'New' })
    expect(result.error).toBe('Erro ao atualizar farmácia')
  })
})

describe('updatePharmacyStatus', () => {
  it('updates status to ACTIVE', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updatePharmacyStatus('ph-1', 'ACTIVE')
    expect(result.error).toBeUndefined()
  })

  it('updates status to INACTIVE', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updatePharmacyStatus('ph-1', 'INACTIVE')
    expect(result.error).toBeUndefined()
  })
})
