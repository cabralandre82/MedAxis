import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProfileWithRoles, UserRole } from '@/types'

vi.mock('@/lib/auth/session', () => ({
  requireAuth: vi.fn(),
  getCurrentUser: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function makeUser(roles: UserRole[], id = 'user-1'): ProfileWithRoles {
  return {
    id,
    full_name: 'Test User',
    email: `${id}@example.com`,
    is_active: true,
    registration_status: 'APPROVED',
    notification_preferences: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    roles,
  }
}

async function loadModule() {
  return await import('@/lib/rbac/permissions')
}

async function withFlag(enabled: boolean) {
  const { isFeatureEnabled } = await import('@/lib/features')
  vi.mocked(isFeatureEnabled).mockResolvedValue(enabled)
}

async function mockRpc(fn: (name: string, args: unknown) => unknown) {
  const adminMod = await import('@/lib/db/admin')
  vi.mocked(adminMod.createAdminClient).mockReturnValue({
    rpc: vi.fn(async (name: string, args: unknown) => fn(name, args)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('hasPermission — fallback (flag OFF)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('SUPER_ADMIN passes any permission via wildcard short-circuit', async () => {
    await withFlag(false)
    const { hasPermission, Permissions } = await loadModule()
    const user = makeUser(['SUPER_ADMIN'])
    expect(await hasPermission(user, Permissions.USERS_ANONYMIZE)).toBe(true)
    expect(await hasPermission(user, Permissions.PLATFORM_ADMIN)).toBe(true)
  })

  it('PLATFORM_ADMIN gets platform.admin but NOT users.anonymize (super-admin only)', async () => {
    await withFlag(false)
    const { hasPermission, Permissions } = await loadModule()
    const user = makeUser(['PLATFORM_ADMIN'])
    expect(await hasPermission(user, Permissions.PLATFORM_ADMIN)).toBe(true)
    expect(await hasPermission(user, Permissions.USERS_ANONYMIZE)).toBe(false)
  })

  it('PHARMACY_ADMIN manages own pharmacy but not platform-wide pharmacies', async () => {
    await withFlag(false)
    const { hasPermission, Permissions } = await loadModule()
    const user = makeUser(['PHARMACY_ADMIN'])
    expect(await hasPermission(user, Permissions.PHARMACIES_MANAGE_OWN)).toBe(true)
    expect(await hasPermission(user, Permissions.PHARMACIES_MANAGE)).toBe(false)
  })

  it('DOCTOR has only support + lgpd export', async () => {
    await withFlag(false)
    const { hasPermission, Permissions } = await loadModule()
    const user = makeUser(['DOCTOR'])
    expect(await hasPermission(user, Permissions.SUPPORT_CREATE_TICKET)).toBe(true)
    expect(await hasPermission(user, Permissions.LGPD_EXPORT_SELF)).toBe(true)
    expect(await hasPermission(user, Permissions.AUDIT_READ)).toBe(false)
  })
})

describe('hasPermission — granular (flag ON) delegates to has_permission RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when RPC returns true', async () => {
    await withFlag(true)
    const rpcSpy = vi.fn(async () => ({ data: true, error: null }))
    const adminMod = await import('@/lib/db/admin')
    vi.mocked(adminMod.createAdminClient).mockReturnValue({
      rpc: rpcSpy,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const { hasPermission, Permissions } = await loadModule()
    const user = makeUser(['PLATFORM_ADMIN'], 'user-granular')
    expect(await hasPermission(user, Permissions.AUDIT_READ)).toBe(true)
    expect(rpcSpy).toHaveBeenCalledWith('has_permission', {
      p_user_id: 'user-granular',
      p_permission: 'audit.read',
    })
  })

  it('returns false when RPC returns false', async () => {
    await withFlag(true)
    await mockRpc(() => ({ data: false, error: null }))
    const { hasPermission, Permissions } = await loadModule()
    expect(await hasPermission(makeUser(['DOCTOR']), Permissions.AUDIT_READ)).toBe(false)
  })

  it('fails closed (false) when RPC errors', async () => {
    await withFlag(true)
    await mockRpc(() => ({ data: null, error: { message: 'boom', code: 'P0001' } }))
    const { hasPermission, Permissions } = await loadModule()
    expect(await hasPermission(makeUser(['PLATFORM_ADMIN']), Permissions.AUDIT_READ)).toBe(false)

    const { logger } = await import('@/lib/logger')
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('has_permission RPC failed'),
      expect.objectContaining({ permission: 'audit.read' })
    )
  })

  it('fails closed when admin client throws', async () => {
    await withFlag(true)
    const adminMod = await import('@/lib/db/admin')
    vi.mocked(adminMod.createAdminClient).mockImplementationOnce(() => {
      throw new Error('missing env')
    })
    const { hasPermission, Permissions } = await loadModule()
    expect(await hasPermission(makeUser(['PLATFORM_ADMIN']), Permissions.AUDIT_READ)).toBe(false)
  })

  it('SUPER_ADMIN still short-circuits without hitting the RPC', async () => {
    await withFlag(true)
    const rpcSpy = vi.fn()
    const adminMod = await import('@/lib/db/admin')
    vi.mocked(adminMod.createAdminClient).mockReturnValue({
      rpc: rpcSpy,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const { hasPermission, Permissions } = await loadModule()
    expect(await hasPermission(makeUser(['SUPER_ADMIN']), Permissions.USERS_ANONYMIZE)).toBe(true)
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})

describe('hasAnyPermission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true as soon as one matches', async () => {
    await withFlag(false)
    const { hasAnyPermission, Permissions } = await loadModule()
    const user = makeUser(['PHARMACY_ADMIN'])
    expect(
      await hasAnyPermission(user, [Permissions.PLATFORM_ADMIN, Permissions.PHARMACIES_MANAGE_OWN])
    ).toBe(true)
  })

  it('returns false when none match', async () => {
    await withFlag(false)
    const { hasAnyPermission, Permissions } = await loadModule()
    const user = makeUser(['DOCTOR'])
    expect(await hasAnyPermission(user, [Permissions.PLATFORM_ADMIN, Permissions.AUDIT_READ])).toBe(
      false
    )
  })
})

describe('requirePermission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns user when permission is granted', async () => {
    await withFlag(false)
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['PLATFORM_ADMIN']))

    const { requirePermission, Permissions } = await loadModule()
    const user = await requirePermission(Permissions.AUDIT_READ)
    expect(user.roles).toContain('PLATFORM_ADMIN')
  })

  it('throws FORBIDDEN when not granted', async () => {
    await withFlag(false)
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['DOCTOR']))

    const { requirePermission, Permissions } = await loadModule()
    await expect(requirePermission(Permissions.AUDIT_READ)).rejects.toThrow('FORBIDDEN')
  })

  it('throws UNAUTHORIZED when no session', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockRejectedValueOnce(new Error('UNAUTHORIZED'))

    const { requirePermission, Permissions } = await loadModule()
    await expect(requirePermission(Permissions.AUDIT_READ)).rejects.toThrow('UNAUTHORIZED')
  })

  it('accepts array and matches if any permission passes', async () => {
    await withFlag(false)
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['PHARMACY_ADMIN']))

    const { requirePermission, Permissions } = await loadModule()
    const user = await requirePermission([
      Permissions.AUDIT_READ,
      Permissions.PHARMACIES_MANAGE_OWN,
    ])
    expect(user.roles).toContain('PHARMACY_ADMIN')
  })

  it('throws FORBIDDEN for an empty permission array', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.requireAuth).mockResolvedValueOnce(makeUser(['SUPER_ADMIN']))

    const { requirePermission } = await loadModule()
    await expect(requirePermission([])).rejects.toThrow('FORBIDDEN')
  })
})

describe('requirePermissionPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects to /login when no session', async () => {
    const session = await import('@/lib/auth/session')
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce(null)

    const { requirePermissionPage, Permissions } = await loadModule()
    await expect(requirePermissionPage(Permissions.SERVER_LOGS_READ)).rejects.toThrow(
      /REDIRECT:\/login/
    )
  })

  it('redirects to /unauthorized when permission missing', async () => {
    await withFlag(false)
    const session = await import('@/lib/auth/session')
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce(makeUser(['DOCTOR']))

    const { requirePermissionPage, Permissions } = await loadModule()
    await expect(requirePermissionPage(Permissions.SERVER_LOGS_READ)).rejects.toThrow(
      /REDIRECT:\/unauthorized/
    )
  })

  it('returns user when permission granted', async () => {
    await withFlag(false)
    const session = await import('@/lib/auth/session')
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce(makeUser(['PLATFORM_ADMIN']))

    const { requirePermissionPage, Permissions } = await loadModule()
    const user = await requirePermissionPage(Permissions.SERVER_LOGS_READ)
    expect(user.roles).toContain('PLATFORM_ADMIN')
  })
})

describe('ROLE_FALLBACK catalog invariants', () => {
  it('covers every permission defined in Permissions', async () => {
    const { _internal, Permissions } = await loadModule()
    for (const key of Object.values(Permissions)) {
      expect(_internal.ROLE_FALLBACK).toHaveProperty(key)
    }
  })

  it('reserves super-admin-only permissions with empty role map', async () => {
    const { _internal, Permissions } = await loadModule()
    expect(_internal.ROLE_FALLBACK[Permissions.USERS_ANONYMIZE]).toEqual([])
    expect(_internal.ROLE_FALLBACK[Permissions.CONSULTANTS_MANAGE]).toEqual([])
    expect(_internal.ROLE_FALLBACK[Permissions.REGISTRATIONS_APPROVE]).toEqual([])
  })
})
