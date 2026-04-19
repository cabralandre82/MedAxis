import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
}))

describe('GET /api/chaos/state', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  async function load() {
    return await import('@/app/api/chaos/state/route')
  }

  it('returns 401 when unauthenticated', async () => {
    const { getCurrentUser } = await import('@/lib/auth/session')
    ;(getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const { GET } = await load()
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 when user lacks SUPER_ADMIN/PLATFORM_ADMIN', async () => {
    const { getCurrentUser } = await import('@/lib/auth/session')
    ;(getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      roles: ['CLINIC_ADMIN'],
    })
    const { GET } = await load()
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns the parsed config snapshot for a SUPER_ADMIN', async () => {
    const { getCurrentUser } = await import('@/lib/auth/session')
    ;(getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      roles: ['SUPER_ADMIN'],
    })
    vi.stubEnv('CHAOS_ENABLED', 'true')
    vi.stubEnv('CHAOS_TARGETS', 'outbound:asaas')
    const { GET } = await load()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { config: Record<string, unknown> }
    expect(body.config.enabled).toBe(true)
    expect((body.config.targets as Record<string, string[]>).outbound).toContain('asaas')
  })

  it('hides the seed even when set in env', async () => {
    const { getCurrentUser } = await import('@/lib/auth/session')
    ;(getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      roles: ['PLATFORM_ADMIN'],
    })
    vi.stubEnv('CHAOS_ENABLED', 'true')
    vi.stubEnv('CHAOS_SEED', '42')
    const { GET } = await load()
    const res = await GET()
    const body = (await res.json()) as { config: Record<string, unknown> }
    expect('seed' in body.config).toBe(false)
  })

  it('signals blocked_by_prod when prod env without ALLOW_PROD', async () => {
    const { getCurrentUser } = await import('@/lib/auth/session')
    ;(getCurrentUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'u1',
      roles: ['SUPER_ADMIN'],
    })
    vi.stubEnv('CHAOS_ENABLED', 'true')
    vi.stubEnv('NODE_ENV', 'production')
    const { GET } = await load()
    const res = await GET()
    const body = (await res.json()) as { config: Record<string, unknown> }
    expect(body.config.enabled).toBe(false)
    expect(body.config.blocked_by_prod).toBe(true)
  })
})
