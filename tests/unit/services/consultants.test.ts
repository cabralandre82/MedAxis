import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  createConsultant,
  updateConsultantStatus,
  assignConsultantToClinic,
  registerConsultantTransfer,
  deleteConsultant,
} from '@/services/consultants'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    TRANSFER_REGISTERED: 'TRANSFER_REGISTERED',
  },
  AuditEntity: { PROFILE: 'PROFILE', CLINIC: 'CLINIC', TRANSFER: 'TRANSFER' },
}))
vi.mock('@/lib/validators', () => ({
  salesConsultantSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { full_name: 'Consultor', email: 'c@test.com', cnpj: '11222333000181' },
    }),
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }))

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

describe('createConsultant', () => {
  it('creates consultant and returns id', async () => {
    const qb = makeQueryBuilder({ id: 'cons-1' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'cons-1' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.id).toBe('cons-1')
  })

  it('returns CNPJ error on cnpj duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'cnpj dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toMatch(/CNPJ já cadastrado/)
  })

  it('returns email error on email duplicate', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '23505', message: 'email dup' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toMatch(/Email já cadastrado/)
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await createConsultant({
      full_name: 'C',
      email: 'c@test.com',
      cnpj: '11222333000181',
    } as Parameters<typeof createConsultant>[0])
    expect(result.error).toBe('Sem permissão')
  })

  // ─── Onboarding behaviour pinned for issue #30 ──────────────────────
  // The consultant must be promoted to a full platform user: auth.users
  // row + profiles mirror + user_roles row + welcome email. This block
  // pins all four invariants so a future "optimisation" cannot silently
  // remove any of them.
  describe('full onboarding (auth provisioning)', () => {
    it('creates auth user, seeds SALES_CONSULTANT role, links user_id, sends welcome email', async () => {
      const emailModule = await import('@/lib/email')
      vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined)

      const consultantInsertSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'cons-1',
          full_name: 'Consultor',
          email: 'c@test.com',
          commission_rate: 7.5,
        },
        error: null,
      })
      const consultantInsertSelect = vi.fn().mockReturnValue({ single: consultantInsertSingle })
      const consultantInsert = vi.fn().mockReturnValue({ select: consultantInsertSelect })

      const profilesUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const userRolesUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const consultantUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      // sales_consultants is hit twice: once on insert, once on the
      // user_id link update. We track call count to switch behaviour.
      let consultantCalls = 0
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_consultants') {
          consultantCalls++
          return consultantCalls === 1 ? { insert: consultantInsert } : { update: consultantUpdate }
        }
        if (table === 'profiles') return { upsert: profilesUpsert }
        if (table === 'user_roles') return { upsert: userRolesUpsert }
        return makeQueryBuilder(null, null)
      })

      const createUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user-1', email: 'c@test.com' } },
        error: null,
      })
      const generateLinkMock = vi.fn().mockResolvedValue({
        data: { properties: { hashed_token: 'tok-abc' } },
        error: null,
      })
      const deleteUserMock = vi.fn().mockResolvedValue({ data: null, error: null })

      vi.mocked(adminModule.createAdminClient).mockReturnValue({
        from: fromMock,
        auth: {
          admin: {
            createUser: createUserMock,
            generateLink: generateLinkMock,
            deleteUser: deleteUserMock,
            listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
          },
        },
      } as unknown as ReturnType<typeof adminModule.createAdminClient>)

      const result = await createConsultant({
        full_name: 'Consultor',
        email: 'c@test.com',
        cnpj: '11222333000181',
      } as Parameters<typeof createConsultant>[0])

      expect(result.id).toBe('cons-1')
      expect(createUserMock).toHaveBeenCalledOnce()
      expect(createUserMock.mock.calls[0]?.[0]).toMatchObject({
        email: 'c@test.com',
        email_confirm: true,
      })
      expect(userRolesUpsert).toHaveBeenCalledWith(
        { user_id: 'auth-user-1', role: 'SALES_CONSULTANT' },
        expect.objectContaining({ onConflict: 'user_id,role' })
      )
      expect(consultantCalls).toBe(2)
      expect(generateLinkMock).toHaveBeenCalledOnce()
      expect(generateLinkMock.mock.calls[0]?.[0]).toMatchObject({
        type: 'recovery',
        email: 'c@test.com',
      })
      expect(emailModule.sendEmail).toHaveBeenCalledOnce()
      const emailArg = vi.mocked(emailModule.sendEmail).mock.calls[0]?.[0]
      expect(emailArg?.to).toBe('c@test.com')
      expect(emailArg?.subject).toContain('senha')
      expect(emailArg?.html).toContain('tok-abc')
    })

    it('reuses existing auth user when email already exists (idempotent re-link)', async () => {
      const emailModule = await import('@/lib/email')
      vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined)

      const consultantInsertSingle = vi.fn().mockResolvedValue({
        data: { id: 'cons-2', full_name: 'C', email: 'c@test.com', commission_rate: 5 },
        error: null,
      })
      const consultantInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: consultantInsertSingle }),
      })

      let consultantCalls = 0
      const userRolesUpsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_consultants') {
          consultantCalls++
          return consultantCalls === 1
            ? { insert: consultantInsert }
            : {
                update: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }
        }
        if (table === 'profiles')
          return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
        if (table === 'user_roles') return { upsert: userRolesUpsert }
        return makeQueryBuilder(null, null)
      })

      vi.mocked(adminModule.createAdminClient).mockReturnValue({
        from: fromMock,
        auth: {
          admin: {
            // First createUser fails because the email already exists.
            createUser: vi.fn().mockResolvedValue({
              data: { user: null },
              error: { message: 'User already registered' },
            }),
            // listUsers should then return the pre-existing user so we
            // can link to it instead of failing the whole onboarding.
            listUsers: vi.fn().mockResolvedValue({
              data: {
                users: [{ id: 'existing-user-9', email: 'c@test.com', banned_until: null }],
              },
              error: null,
            }),
            generateLink: vi
              .fn()
              .mockResolvedValue({ data: { properties: { hashed_token: 'tok' } }, error: null }),
            deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
          },
        },
      } as unknown as ReturnType<typeof adminModule.createAdminClient>)

      const result = await createConsultant({
        full_name: 'C',
        email: 'c@test.com',
        cnpj: '11222333000181',
      } as Parameters<typeof createConsultant>[0])

      expect(result.id).toBe('cons-2')
      // We must have used the existing auth user, NOT a brand new one.
      expect(userRolesUpsert).toHaveBeenCalledWith(
        { user_id: 'existing-user-9', role: 'SALES_CONSULTANT' },
        expect.anything()
      )
    })

    it('rolls back fully when user_roles.upsert is rejected by CHECK constraint', async () => {
      // Pre-2026-04-29 the user_roles.role CHECK didn't include
      // SALES_CONSULTANT, so the upsert returned 23514 check_violation
      // and the operator saw "Erro ao atribuir papel ao consultor".
      // Migration 065 fixed the constraint, but this test pins the
      // rollback contract: if user_roles.upsert ever fails again
      // (different reason), the new auth user AND the half-created
      // sales_consultants row must both be reverted, and the
      // surfaced toast must include the underlying SQL detail.
      const consultantInsertSingle = vi.fn().mockResolvedValue({
        data: { id: 'cons-9', full_name: 'C', email: 'c@test.com' },
        error: null,
      })
      const consultantInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: consultantInsertSingle }),
      })
      const consultantDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      let consultantCalls = 0
      const userRolesUpsert = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23514', message: 'check constraint user_roles_role_check' },
      })
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_consultants') {
          consultantCalls++
          return consultantCalls === 1 ? { insert: consultantInsert } : { delete: consultantDelete }
        }
        if (table === 'profiles')
          return { upsert: vi.fn().mockResolvedValue({ data: null, error: null }) }
        if (table === 'user_roles') return { upsert: userRolesUpsert }
        return makeQueryBuilder(null, null)
      })

      const deleteUserMock = vi.fn().mockResolvedValue({ data: null, error: null })
      vi.mocked(adminModule.createAdminClient).mockReturnValue({
        from: fromMock,
        auth: {
          admin: {
            createUser: vi.fn().mockResolvedValue({
              data: { user: { id: 'auth-9', email: 'c@test.com' } },
              error: null,
            }),
            generateLink: vi.fn(),
            deleteUser: deleteUserMock,
            listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
          },
        },
      } as unknown as ReturnType<typeof adminModule.createAdminClient>)

      const result = await createConsultant({
        full_name: 'C',
        email: 'c@test.com',
        cnpj: '11222333000181',
      } as Parameters<typeof createConsultant>[0])

      // Toast carries the SQL detail (not the old generic string).
      expect(result.error).toMatch(/SALES_CONSULTANT/)
      expect(result.error).toMatch(/user_roles_role_check/)
      expect(result.error).toMatch(/constraint violada/)
      // Both rollbacks executed: auth.users + sales_consultants row.
      expect(deleteUserMock).toHaveBeenCalledWith('auth-9')
      expect(consultantDelete).toHaveBeenCalled()
    })
  })
})

describe('assignConsultantToClinic — clinic-linked email', () => {
  // Pinning issue #16: the consultant must be told via email when a new
  // clinic is associated with their account. Failure of the email send
  // must NEVER block the assignment write.
  it('sends consultantClinicLinked email when assigning a consultant', async () => {
    const emailModule = await import('@/lib/email')
    vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined)

    // clinics.update — primary write
    const clinicsUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    // sales_consultants single() and clinics single() for the email build
    const consultantSingle = vi.fn().mockResolvedValue({
      data: { email: 'c@test.com', full_name: 'C', commission_rate: 5 },
      error: null,
    })
    const clinicSingle = vi.fn().mockResolvedValue({
      data: { trade_name: 'Clínica X' },
      error: null,
    })

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'sales_consultants') {
        return {
          select: vi
            .fn()
            .mockReturnValue({ eq: vi.fn().mockReturnValue({ single: consultantSingle }) }),
        }
      }
      if (table === 'clinics') {
        // First call is the update; subsequent select for the email
        return {
          update: clinicsUpdate,
          select: vi
            .fn()
            .mockReturnValue({ eq: vi.fn().mockReturnValue({ single: clinicSingle }) }),
        }
      }
      return makeQueryBuilder(null, null)
    })

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: fromMock,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', 'cons-1')
    expect(result.error).toBeUndefined()
    expect(emailModule.sendEmail).toHaveBeenCalledOnce()
    const emailArg = vi.mocked(emailModule.sendEmail).mock.calls[0]?.[0]
    expect(emailArg?.to).toBe('c@test.com')
    expect(emailArg?.html).toContain('Clínica X')
  })

  it('does NOT send email when unlinking (consultantId === null)', async () => {
    const emailModule = await import('@/lib/email')
    vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined)

    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', null)
    expect(result.error).toBeUndefined()
    expect(emailModule.sendEmail).not.toHaveBeenCalled()
  })
})

describe('updateConsultantStatus', () => {
  it('updates to INACTIVE successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateConsultantStatus('cons-1', 'INACTIVE')
    expect(result.error).toBeUndefined()
  })

  it('returns error when db fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateConsultantStatus('cons-1', 'ACTIVE')
    // The status updater now goes through the same friendly-error
    // helper as create/update — operators were getting "Erro ao
    // atualizar status" with no diagnostic. We pin that an error
    // came back AND that it carries the diagnostic detail.
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/fail/)
  })
})

describe('assignConsultantToClinic', () => {
  it('assigns consultant successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', 'cons-1')
    expect(result.error).toBeUndefined()
  })

  it('allows unassigning (null consultantId)', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignConsultantToClinic('clinic-1', null)
    expect(result.error).toBeUndefined()
  })
})

describe('updateConsultant', () => {
  it('updates consultant data successfully', async () => {
    const qb = makeQueryBuilder({ id: 'cons-1', full_name: 'Old' }, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { updateConsultant } = await import('@/services/consultants')
    const result = await updateConsultant('cons-1', { full_name: 'New' })
    expect(result.error).toBeUndefined()
  })

  it('returns error when db update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { updateConsultant } = await import('@/services/consultants')
    const result = await updateConsultant('cons-1', { full_name: 'New' })
    // The new helper surfaces the underlying message instead of the
    // generic "Erro ao atualizar consultor" toast — operators were
    // staring at black-box errors with no way to triage. The exact
    // string includes the raw message; we only pin that an error was
    // returned and that it carries the diagnostic detail.
    expect(result.error).toBeDefined()
    expect(result.error).toMatch(/fail/)
  })
})

describe('linkConsultantUser', () => {
  it('links user to consultant profile', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { linkConsultantUser } = await import('@/services/consultants')
    const result = await linkConsultantUser('cons-1', 'user-1')
    expect(result.error).toBeUndefined()
  })

  it('returns error when update fails', async () => {
    const qb = makeQueryBuilder(null, null)
    qb.update = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { linkConsultantUser } = await import('@/services/consultants')
    const result = await linkConsultantUser('cons-1', 'user-1')
    expect(result.error).toBe('Erro ao vincular usuário')
  })
})

describe('registerConsultantTransfer', () => {
  it('returns error for empty commissionIds', async () => {
    const result = await registerConsultantTransfer('cons-1', [], 'REF-001')
    expect(result.error).toBe('Nenhuma comissão selecionada')
  })

  it('returns error when atomic claim finds no commissions (already paid or error)', async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const eqMock2 = vi.fn().mockReturnValue({ select: selectMock })
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 })
    const inMock = vi.fn().mockReturnValue({ eq: eqMock1 })
    const updateMock = vi.fn().mockReturnValue({ in: inMock })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ update: updateMock }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Comissões não encontradas ou já estão sendo processadas')
  })

  it('returns error when atomic claim returns empty array (all already claimed)', async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const eqMock2 = vi.fn().mockReturnValue({ select: selectMock })
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 })
    const inMock = vi.fn().mockReturnValue({ eq: eqMock1 })
    const updateMock = vi.fn().mockReturnValue({ in: inMock })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ update: updateMock }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Comissões não encontradas ou já estão sendo processadas')
  })

  it('returns error when transfer insert fails (rollback path)', async () => {
    // claim succeeds, transfer insert fails
    const claimSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'comm-1', commission_amount: 100 }],
      error: null,
    })
    const claimEq2 = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEq1 = vi.fn().mockReturnValue({ eq: claimEq2 })
    const claimIn = vi.fn().mockReturnValue({ eq: claimEq1 })
    const claimUpdate = vi.fn().mockReturnValue({ in: claimIn })

    // transfer insert fails
    const transferSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } })
    const transferSelect = vi.fn().mockReturnValue({ single: transferSingle })
    const transferInsert = vi.fn().mockReturnValue({ select: transferSelect })

    // rollback update (commissions → PENDING)
    const rollbackQb = makeQueryBuilder(null, null)

    let consultantQbUsed = false
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'consultant_commissions' && !consultantQbUsed) {
          consultantQbUsed = true
          return { update: claimUpdate }
        }
        if (table === 'consultant_transfers') {
          return { insert: transferInsert }
        }
        return rollbackQb
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Erro ao registrar repasse')
  })

  it('returns id on successful transfer', async () => {
    const claimSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'comm-1', commission_amount: 150 }],
      error: null,
    })
    const claimEq2 = vi.fn().mockReturnValue({ select: claimSelect })
    const claimEq1 = vi.fn().mockReturnValue({ eq: claimEq2 })
    const claimIn = vi.fn().mockReturnValue({ eq: claimEq1 })
    const claimUpdate = vi.fn().mockReturnValue({ in: claimIn })

    const transferSingle = vi.fn().mockResolvedValue({ data: { id: 'transfer-99' }, error: null })
    const transferSelect = vi.fn().mockReturnValue({ single: transferSingle })
    const transferInsert = vi.fn().mockReturnValue({ select: transferSelect })

    const genericQb = makeQueryBuilder(null, null)

    let consultantCommUsed = false
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'consultant_commissions' && !consultantCommUsed) {
          consultantCommUsed = true
          return { update: claimUpdate }
        }
        if (table === 'consultant_transfers') {
          return { insert: transferInsert }
        }
        return genericQb
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.id).toBe('transfer-99')
    expect(result.error).toBeUndefined()
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await registerConsultantTransfer('cons-1', ['comm-1'], 'REF-001')
    expect(result.error).toBe('Sem permissão')
  })
})

describe('deleteConsultant', () => {
  function buildAdminClient(opts: {
    consultant: Record<string, unknown> | null
    fetchErr?: { message: string } | null
    commissionCount: number
    transferCount: number
    linkedClinics?: Array<{ id: string }>
    deleteErr?: { code?: string; message: string } | null
    userRoles?: Array<{ role: string }>
    deleteAuthErr?: { message: string } | null
  }) {
    const consultantSingle = vi.fn().mockResolvedValue({
      data: opts.consultant,
      error: opts.fetchErr ?? null,
    })
    const consultantSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: consultantSingle }),
    })

    const commissionsCount = vi
      .fn()
      .mockResolvedValue({ count: opts.commissionCount, data: null, error: null })
    const transfersCount = vi
      .fn()
      .mockResolvedValue({ count: opts.transferCount, data: null, error: null })
    const commissionsSelect = vi.fn().mockReturnValue({ eq: commissionsCount })
    const transfersSelect = vi.fn().mockReturnValue({ eq: transfersCount })

    const clinicsFetch = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: opts.linkedClinics ?? [], error: null }),
    })
    const clinicsUnlinkUpdate = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null }),
    })

    const consultantDeleteEq = vi.fn().mockResolvedValue({ error: opts.deleteErr ?? null })
    const consultantDelete = vi.fn().mockReturnValue({ eq: consultantDeleteEq })

    const userRolesSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: opts.userRoles ?? [], error: null }),
    })
    const userRolesDeleteEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const userRolesDelete = vi.fn().mockReturnValue({ eq: userRolesDeleteEq })

    let consultantHits = 0
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'sales_consultants') {
        consultantHits++
        // First call is the load (.select).
        // Second call is the .delete().
        if (consultantHits === 1) {
          return { select: consultantSelect }
        }
        return { delete: consultantDelete }
      }
      if (table === 'consultant_commissions') return { select: commissionsSelect }
      if (table === 'consultant_transfers') return { select: transfersSelect }
      if (table === 'clinics') return { select: clinicsFetch, update: clinicsUnlinkUpdate }
      if (table === 'user_roles') return { select: userRolesSelect, delete: userRolesDelete }
      return makeQueryBuilder(null, null)
    })

    return {
      admin: {
        from: fromMock,
        auth: {
          admin: {
            deleteUser: vi.fn().mockResolvedValue({ error: opts.deleteAuthErr ?? null }),
          },
        },
      },
      consultantSingle,
      clinicsUnlinkUpdate,
    }
  }

  it('deletes a clean consultant (no FK refs, no auth user)', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'Teste',
        email: 'c@test.com',
        cnpj: '11222333000181',
        user_id: null,
        status: 'ACTIVE',
      },
      commissionCount: 0,
      transferCount: 0,
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toBeUndefined()
    expect(result.unlinkedClinics).toBe(0)
    expect(result.deletedAuthUser).toBe(false)
  })

  it('refuses delete when commissions exist (LGPD/fiscal retention)', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'X',
        email: 'x@x.com',
        user_id: null,
        cnpj: 'x',
        status: 'ACTIVE',
      },
      commissionCount: 3,
      transferCount: 0,
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toMatch(/3 comissão/)
    expect(result.error).toMatch(/Inativo/)
  })

  it('refuses delete when transfers exist', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'X',
        email: 'x@x.com',
        user_id: null,
        cnpj: 'x',
        status: 'ACTIVE',
      },
      commissionCount: 0,
      transferCount: 2,
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toMatch(/2 repasse/)
  })

  it('unlinks linked clinics before deleting', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'X',
        email: 'x@x.com',
        user_id: null,
        cnpj: 'x',
        status: 'ACTIVE',
      },
      commissionCount: 0,
      transferCount: 0,
      linkedClinics: [{ id: 'clinic-a' }, { id: 'clinic-b' }],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toBeUndefined()
    expect(result.unlinkedClinics).toBe(2)
    expect(stub.clinicsUnlinkUpdate).toHaveBeenCalledOnce()
  })

  it('removes auth user only when SALES_CONSULTANT is the only role', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'X',
        email: 'x@x.com',
        cnpj: 'x',
        status: 'ACTIVE',
        user_id: 'user-1',
      },
      commissionCount: 0,
      transferCount: 0,
      userRoles: [{ role: 'SALES_CONSULTANT' }],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toBeUndefined()
    expect(result.deletedAuthUser).toBe(true)
  })

  it('keeps auth user when consultant wears another hat (multi-role)', async () => {
    const stub = buildAdminClient({
      consultant: {
        id: 'cons-1',
        full_name: 'X',
        email: 'x@x.com',
        cnpj: 'x',
        status: 'ACTIVE',
        user_id: 'user-1',
      },
      commissionCount: 0,
      transferCount: 0,
      userRoles: [{ role: 'SALES_CONSULTANT' }, { role: 'CLINIC_ADMIN' }],
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('cons-1')
    expect(result.error).toBeUndefined()
    expect(result.deletedAuthUser).toBe(false)
  })

  it('returns "Consultor não encontrado" when consultant does not exist', async () => {
    const stub = buildAdminClient({
      consultant: null,
      fetchErr: { message: 'PGRST116' },
      commissionCount: 0,
      transferCount: 0,
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deleteConsultant('does-not-exist')
    expect(result.error).toMatch(/não encontrado/)
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))
    const result = await deleteConsultant('cons-1')
    expect(result.error).toBe('Sem permissão')
  })
})
