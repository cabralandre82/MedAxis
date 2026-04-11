import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeQueryBuilder, mockSupabaseAdmin, mockSupabaseClient } from '../../setup'
import * as adminModule from '@/lib/db/admin'
import * as serverModule from '@/lib/db/server'
import * as rbacModule from '@/lib/rbac'
import * as auditModule from '@/lib/audit'
import {
  resetUserPassword,
  deactivateUser,
  reactivateUser,
  updateOwnProfile,
  updateUserProfile,
  assignUserRole,
} from '@/services/users'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', STATUS_CHANGE: 'STATUS_CHANGE' },
  AuditEntity: { PROFILE: 'PROFILE' },
}))
vi.mock('@/lib/token-revocation', () => ({
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
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

describe('resetUserPassword', () => {
  it('returns error for short password', async () => {
    const result = await resetUserPassword('user-1', 'short')
    expect(result.error).toBe('Senha deve ter pelo menos 8 caracteres')
  })

  it('succeeds with valid password', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: null,
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await resetUserPassword('user-1', 'StrongPass123!')
    expect(result.error).toBeUndefined()
  })

  it('returns error when auth update fails', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: { message: 'Auth error' },
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await resetUserPassword('user-1', 'StrongPass123!')
    expect(result.error).toBe('Erro ao redefinir senha')
  })
})

describe('updateOwnProfile — IDOR protection', () => {
  it('returns Sem permissão when userId does not match caller', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'different-user' } }, error: null }),
      },
    } as ReturnType<typeof mockSupabaseClient>)

    const result = await updateOwnProfile('target-user', { full_name: 'Hacker' })
    expect(result.error).toBe('Sem permissão')
  })

  it('returns Sem permissão when no user is authenticated', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as ReturnType<typeof mockSupabaseClient>)

    const result = await updateOwnProfile('my-user', { full_name: 'André' })
    expect(result.error).toBe('Sem permissão')
  })

  it('updates profile when userId matches caller', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'my-user' } }, error: null }),
      },
    } as ReturnType<typeof mockSupabaseClient>)

    const qb = makeQueryBuilder(null, null)
    const admin = mockSupabaseAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...admin,
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateOwnProfile('my-user', { full_name: 'André Atualizado' })
    expect(result.error).toBeUndefined()
  })
})

describe('updateUserProfile', () => {
  it('updates profile fields successfully', async () => {
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await updateUserProfile('user-1', {
      full_name: 'Updated Name',
      phone: '11999999999',
    })
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

    const result = await updateUserProfile('user-1', { full_name: 'Nome Valido' })
    expect(result.error).toBe('Erro ao atualizar perfil')
  })

  it('returns validation error for short name', async () => {
    const result = await updateUserProfile('user-1', { full_name: 'X' } as Parameters<
      typeof updateUserProfile
    >[1])
    expect(result.error).toBe('Nome é obrigatório')
  })
})

describe('deactivateUser', () => {
  it('bans user, mirrors is_active=false in profiles, returns no error', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: null,
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...admin,
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await deactivateUser('user-1')
    expect(result.error).toBeUndefined()
    expect(vi.mocked(admin.auth.admin.updateUserById)).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ ban_duration: '876600h' })
    )
  })

  it('returns error when auth ban fails', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: { message: 'ban fail' },
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await deactivateUser('user-1')
    expect(result.error).toBe('Erro ao desativar usuário')
  })

  it('logs error when profiles.update fails after auth ban but still succeeds', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: null,
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    const qb = makeQueryBuilder(null, null)
    qb.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'db error' }, data: null }),
    })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...admin,
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    // profiles.update failure is non-fatal — ban is already set in Auth
    const result = await deactivateUser('user-1')
    expect(result.error).toBeUndefined()
  })
})

describe('deactivateUser — self-deactivation guard', () => {
  it('returns error when actor tries to deactivate their own account', async () => {
    // actorMock.id === 'admin-1'
    const result = await deactivateUser('admin-1')
    expect(result.error).toBe('Você não pode desativar sua própria conta')
  })
})

describe('reactivateUser', () => {
  it('removes ban, mirrors is_active=true in profiles, returns no error', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: null,
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    const qb = makeQueryBuilder(null, null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...admin,
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await reactivateUser('user-1')
    expect(result.error).toBeUndefined()
    expect(vi.mocked(admin.auth.admin.updateUserById)).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ ban_duration: 'none' })
    )
  })

  it('returns error when auth unban fails', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.updateUserById).mockResolvedValue({
      data: {},
      error: { message: 'unban fail' },
    } as ReturnType<typeof admin.auth.admin.updateUserById>)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as ReturnType<typeof adminModule.createAdminClient>
    )

    const result = await reactivateUser('user-1')
    expect(result.error).toBe('Erro ao reativar usuário')
  })
})

describe('createUser', () => {
  it('returns email duplicate error', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.createUser).mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    } as ReturnType<typeof admin.auth.admin.createUser>)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as ReturnType<typeof adminModule.createAdminClient>
    )

    const { createUser } = await import('@/services/users')
    const result = await createUser({
      email: 'dup@test.com',
      full_name: 'Dup',
      role: 'CLINIC_ADMIN',
      password: 'Pass1234!',
      clinic_id: '11111111-1111-4111-a111-111111111111',
    } as Parameters<typeof createUser>[0])
    expect(result.error).toBe('Email já cadastrado')
  })

  it('creates CLINIC_ADMIN and assigns membership_role', async () => {
    const admin = mockSupabaseAdmin()
    vi.mocked(admin.auth.admin.createUser).mockResolvedValue({
      data: { user: { id: 'new-user' } },
      error: null,
    } as ReturnType<typeof admin.auth.admin.createUser>)
    const qb = makeQueryBuilder({ id: 'new-user' }, null)
    qb.single = vi.fn().mockResolvedValue({ data: { id: 'new-user' }, error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...admin,
      from: vi.fn().mockReturnValue(qb),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { createUser } = await import('@/services/users')
    const result = await createUser({
      email: 'clinic@test.com',
      full_name: 'Clinic Admin',
      role: 'CLINIC_ADMIN',
      clinic_id: '11111111-1111-4111-a111-111111111111',
    } as Parameters<typeof createUser>[0])
    expect(result.error).toBeUndefined()
    expect(result.id).toBe('new-user')
  })

  it('returns Sem permissão when FORBIDDEN', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValue(new Error('FORBIDDEN'))

    const { createUser } = await import('@/services/users')
    const result = await createUser({
      email: 'x@test.com',
      full_name: 'X',
      role: 'CLINIC_ADMIN',
    } as Parameters<typeof createUser>[0])
    expect(result.error).toBe('Sem permissão')
  })
})

describe('assignUserRole', () => {
  it('upserts new role for user', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: upsertMock,
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignUserRole('user-1', 'PLATFORM_ADMIN')
    expect(result.error).toBeUndefined()
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: 'user-1', role: 'PLATFORM_ADMIN' },
      { onConflict: 'user_id' }
    )
  })

  it('returns error when upsert fails', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: { message: 'constraint' } }),
      }),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const result = await assignUserRole('user-1', 'PLATFORM_ADMIN')
    expect(result.error).toBe('Erro ao atribuir papel')
  })
})
