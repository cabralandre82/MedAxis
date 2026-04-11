import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  createCategory,
  updateCategory,
  toggleCategoryActive,
  reorderCategory,
} from '@/services/categories'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE' },
  AuditEntity: { PRODUCT: 'PRODUCT' },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

describe('createCategory', () => {
  it('creates category and returns id', async () => {
    const qb = makeQueryBuilder({ id: 'cat-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'cat-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createCategory({ name: 'Hormônios' })
    expect(result.id).toBe('cat-1')
    expect(result.error).toBeUndefined()
  })

  it('returns error on duplicate name', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createCategory({ name: 'Hormônios' })
    expect(result.error).toBe('Já existe uma categoria com esse nome ou slug')
  })

  it('returns validation error when name is too short', async () => {
    const result = await createCategory({ name: 'X' })
    expect(result.error).toBe('Nome deve ter ao menos 2 caracteres')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createCategory({ name: 'Vitaminas' })
    expect(result.error).toBe('Sem permissão')
  })

  it('returns error on generic DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: { code: '99999', message: 'fail' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createCategory({ name: 'Analgésicos' })
    expect(result.error).toBe('Erro ao criar categoria')
  })
})

describe('updateCategory', () => {
  it('updates category successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateCategory('cat-1', { name: 'Novo Nome' })
    expect(result.error).toBeUndefined()
  })

  it('returns duplicate error on name conflict', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { code: '23505' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateCategory('cat-1', { name: 'Duplicado' })
    expect(result.error).toBe('Já existe uma categoria com esse nome')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await updateCategory('cat-1', { name: 'X' })
    expect(result.error).toBe('Sem permissão')
  })
})

describe('toggleCategoryActive', () => {
  it('deactivates an active category', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await toggleCategoryActive('cat-1', false)
    expect(result.error).toBeUndefined()
  })

  it('activates an inactive category', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await toggleCategoryActive('cat-1', true)
    expect(result.error).toBeUndefined()
  })

  it('returns error on DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await toggleCategoryActive('cat-1', false)
    expect(result.error).toBe('Erro ao alterar status da categoria')
  })
})

describe('reorderCategory', () => {
  it('updates sort_order successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await reorderCategory('cat-1', 3)
    expect(result.error).toBeUndefined()
  })

  it('returns error on DB failure', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await reorderCategory('cat-1', 5)
    expect(result.error).toBe('Erro ao reordenar categoria')
  })
})
