import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  createProduct,
  updateProduct,
  updateProductPrice,
  updatePharmacyCost,
  toggleProductActive,
  generateSKU,
} from '@/services/products'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    STATUS_CHANGE: 'STATUS_CHANGE',
    PRICE_CHANGE: 'PRICE_CHANGE',
  },
  AuditEntity: { PRODUCT: 'PRODUCT' },
}))
vi.mock('@/lib/validators', () => ({
  productSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: {
        name: 'Produto',
        sku: 'SKU-1',
        status: 'active',
        price_current: 100,
        pharmacy_cost: 60,
        featured: false,
      },
    }),
  },
  priceUpdateSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { new_price: 150, reason: 'ajuste' },
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

describe('generateSKU', () => {
  it('generates correct format from category and pharmacy names', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'product_categories')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { name: 'Hormônios' }, error: null }),
          }
        if (table === 'pharmacies')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { trade_name: 'FarmaMag SP' }, error: null }),
          }
        // products count
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sku = await generateSKU('cat-id', 'far-id', mockClient as any)
    expect(sku).toBe('HOR-FAR-0001')
  })

  it('uses sequential counter based on existing product count', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'product_categories')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { name: 'Vitaminas' }, error: null }),
          }
        if (table === 'pharmacies')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { trade_name: 'Clinipharma' }, error: null }),
          }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 14, error: null }),
        }
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sku = await generateSKU('cat-id', 'far-id', mockClient as any)
    expect(sku).toBe('VIT-CLI-0015')
  })

  it('strips accents and normalizes to uppercase', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'product_categories')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { name: 'Analgésicos' }, error: null }),
          }
        if (table === 'pharmacies')
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { trade_name: 'Phármácia' }, error: null }),
          }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sku = await generateSKU('cat-id', 'far-id', mockClient as any)
    expect(sku).toBe('ANA-PHA-0001')
  })

  it('falls back to PRD/FRM when queries fail', async () => {
    const mockClient = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sku = await generateSKU('cat-id', 'far-id', mockClient as any)
    expect(sku).toMatch(/^PRD-FRM-\d{4}$/)
  })
})

describe('createProduct', () => {
  it('returns product id and sku on success (sku provided in validator mock)', async () => {
    const qb = makeQueryBuilder({ id: 'prod-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'prod-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createProduct({} as Parameters<typeof createProduct>[0])
    expect(result.id).toBe('prod-1')
    expect(result.sku).toBe('SKU-1') // sku from validator mock
  })

  it('retries with random suffix on 23505 collision and succeeds', async () => {
    let insertCallCount = 0
    const adminMock = {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          insertCallCount++
          if (insertCallCount === 1)
            return Promise.resolve({ data: null, error: { code: '23505', message: 'sku dup' } })
          return Promise.resolve({ data: { id: 'prod-retry' }, error: null })
        }),
      })),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const result = await createProduct({} as Parameters<typeof createProduct>[0])
    expect(result.id).toBe('prod-retry')
    expect(result.sku).toMatch(/^SKU-1-[A-Z0-9]{4}$/)
  })

  it('returns error when both insert attempts fail', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'sku' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createProduct({} as Parameters<typeof createProduct>[0])
    expect(result.error).toBe('Erro ao criar produto')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createProduct({} as Parameters<typeof createProduct>[0])
    expect(result.error).toBe('Sem permissão')
  })
})

describe('updateProductPrice', () => {
  it('succeeds with valid price update', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    let callCount = 0
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) return Promise.resolve({ data: { price_current: 100 }, error: null })
          return Promise.resolve({ data: null, error: null })
        }),
        insert: insertMock,
        update: vi.fn().mockReturnValue({ eq: updateEqMock }),
      })),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateProductPrice('prod-1', { new_price: 150, reason: 'ajuste' })
    expect(result.error).toBeUndefined()
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ old_price: 100, new_price: 150 })
    )
  })

  it('returns error when product not found', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateProductPrice('prod-1', { new_price: 150, reason: 'ajuste' })
    expect(result.error).toBe('Produto não encontrado')
  })
})

describe('updatePharmacyCost', () => {
  it('returns error for missing reason', async () => {
    const result = await updatePharmacyCost('prod-1', 50, '')
    expect(result.error).toBe('Motivo é obrigatório')
  })

  it('returns error for whitespace-only reason', async () => {
    const result = await updatePharmacyCost('prod-1', 50, '   ')
    expect(result.error).toBe('Motivo é obrigatório')
  })

  it('returns error for negative cost', async () => {
    const result = await updatePharmacyCost('prod-1', -10, 'motivo')
    expect(result.error).toBe('Custo deve ser maior ou igual a zero')
  })

  it('succeeds with valid cost', async () => {
    const qb = makeQueryBuilder({ pharmacy_cost: 60 }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { pharmacy_cost: 60 }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updatePharmacyCost('prod-1', 70, 'ajuste custo')
    expect(result.error).toBeUndefined()
  })
})

describe('toggleProductActive', () => {
  it('toggles active to false', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await toggleProductActive('prod-1', false)
    expect(result.error).toBeUndefined()
  })

  it('toggles active to true', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await toggleProductActive('prod-1', true)
    expect(result.error).toBeUndefined()
  })
})

describe('updateProduct', () => {
  it('updates product successfully', async () => {
    const qb = makeQueryBuilder({ id: 'prod-1', name: 'Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateProduct('prod-1', { name: 'New' })
    expect(result.error).toBeUndefined()
  })

  it('returns error when update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'prod-1' }, error: null })
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateProduct('prod-1', { name: 'New' })
    expect(result.error).toBe('Erro ao atualizar produto')
  })

  it('returns Erro interno on exception', async () => {
    vi.mocked(adminModule.createAdminClient).mockImplementation(() => {
      throw new Error('db down')
    })

    const result = await updateProduct('prod-1', { name: 'New' })
    expect(result.error).toBe('Erro interno')
  })
})

describe('createProduct — PHARMACY_ADMIN role', () => {
  const pharmacyActorMock = {
    ...actorMock,
    id: 'pharm-user-1',
    roles: ['PHARMACY_ADMIN'] as ['PHARMACY_ADMIN'],
  }

  it('forces price_current=0 regardless of form input', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActorMock)

    // Override validator to include pharmacy_id so ownership check passes
    const { productSchema } = await import('@/lib/validators')
    vi.mocked(productSchema.safeParse).mockReturnValueOnce({
      success: true,
      data: {
        name: 'Produto Farmácia',
        sku: 'SKU-PHARM',
        status: 'active',
        price_current: 100, // should be overridden to 0 by the service
        pharmacy_cost: 60,
        pharmacy_id: 'pharm-1',
        featured: false,
      },
    } as ReturnType<typeof productSchema.safeParse>)

    const insertedPayloads: unknown[] = []
    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'pharmacy_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { pharmacy_id: 'pharm-1' }, error: null }),
          }
        }
        // product_categories / pharmacies for SKU generation
        if (table === 'product_categories' || table === 'pharmacies') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: { name: 'Cat', trade_name: 'Far' }, error: null }),
          }
        }
        // products table — count for SKU then insert
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            // count query resolves directly
            then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
          })),
          insert: vi.fn().mockImplementation((payload: unknown) => {
            insertedPayloads.push(payload)
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: 'prod-new' }, error: null }),
            }
          }),
        }
      }),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    // validator mock returns price_current: 100 — should be overridden to 0
    const result = await createProduct({
      pharmacy_id: 'pharm-1',
    } as Parameters<typeof createProduct>[0])

    expect(result.error).toBeUndefined()
    expect(result.id).toBe('prod-new')
    expect(insertedPayloads[0]).toMatchObject({ price_current: 0 })
  })

  it('returns error when PHARMACY_ADMIN tries to create product for another pharmacy', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActorMock)

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'pharmacy_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: { pharmacy_id: 'pharm-OTHER' }, error: null }),
          }
        }
        return makeQueryBuilder(null, null)
      }),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await createProduct({
      pharmacy_id: 'pharm-1',
    } as Parameters<typeof createProduct>[0])

    expect(result.error).toBe('Sem permissão para criar produto nesta farmácia')
  })
})

describe('updatePharmacyCost — PHARMACY_ADMIN role', () => {
  const pharmacyActorMock = {
    ...actorMock,
    id: 'pharm-user-1',
    roles: ['PHARMACY_ADMIN'] as ['PHARMACY_ADMIN'],
  }

  it('allows PHARMACY_ADMIN to update cost of their own pharmacy product', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActorMock)

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'pharmacy_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { pharmacy_id: 'pharm-1' }, error: null }),
          }
        }
        // products table
        const qb = makeQueryBuilder({ pharmacy_cost: 60, pharmacy_id: 'pharm-1' }, null)
        qb.single = vi.fn().mockResolvedValue({
          data: { pharmacy_cost: 60, pharmacy_id: 'pharm-1' },
          error: null,
        })
        return qb
      }),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updatePharmacyCost('prod-1', 75, 'revisao de custo')
    expect(result.error).toBeUndefined()
  })

  it('rejects PHARMACY_ADMIN trying to update cost of another pharmacy product', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValue(pharmacyActorMock)

    const adminMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'pharmacy_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: { pharmacy_id: 'pharm-OTHER' }, error: null }),
          }
        }
        const qb = makeQueryBuilder({ pharmacy_cost: 60, pharmacy_id: 'pharm-1' }, null)
        qb.single = vi.fn().mockResolvedValue({
          data: { pharmacy_cost: 60, pharmacy_id: 'pharm-1' },
          error: null,
        })
        return qb
      }),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      adminMock as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await updatePharmacyCost('prod-1', 75, 'revisao de custo')
    expect(result.error).toBe('Sem permissão para alterar custo deste produto')
  })
})

describe('createProduct — validation failure', () => {
  it('returns error when schema validation fails', async () => {
    const { productSchema } = await import('@/lib/validators')
    vi.mocked(productSchema.safeParse).mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'Nome obrigatório' }] },
    } as ReturnType<typeof productSchema.safeParse>)

    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createProduct({} as Parameters<typeof createProduct>[0])
    expect(result.error).toBe('Nome obrigatório')
  })
})

describe('updateProductPrice — validation failure', () => {
  it('returns error when priceUpdateSchema fails', async () => {
    const { priceUpdateSchema } = await import('@/lib/validators')
    vi.mocked(priceUpdateSchema.safeParse).mockReturnValueOnce({
      success: false,
      error: { issues: [{ message: 'Preço inválido' }] },
    } as ReturnType<typeof priceUpdateSchema.safeParse>)

    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateProductPrice('prod-1', { new_price: -1, reason: '' })
    expect(result.error).toBe('Preço inválido')
  })
})
