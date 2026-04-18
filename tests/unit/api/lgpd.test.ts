// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'
import * as serverModule from '@/lib/db/server'
import * as notifModule from '@/lib/notifications'
import * as auditModule from '@/lib/audit'
import * as tokenModule from '@/lib/token-revocation'
import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/logger', () => loggerMock())
vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/db/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  createNotificationForRole: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  logPiiView: vi.fn().mockResolvedValue(undefined),
  AuditAction: { CREATE: 'CREATE', DELETE: 'DELETE' },
  AuditEntity: { PROFILE: 'PROFILE', DSAR_REQUEST: 'DSAR_REQUEST' },
}))
vi.mock('@/lib/token-revocation', () => ({
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((v: string | null) => v) }))
vi.mock('@/lib/rbac', () => ({
  requireRole: vi.fn().mockResolvedValue({ id: 'admin-1', roles: ['SUPER_ADMIN'] }),
}))
vi.mock('@/lib/rate-limit', () => ({
  guard: vi.fn().mockResolvedValue(null),
  extractClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  lgpdFormLimiter: {
    windowMs: 3_600_000,
    limit: 3,
    check: vi.fn().mockResolvedValue({ ok: true }),
  },
  lgpdExportLimiter: {
    windowMs: 3_600_000,
    limit: 5,
    check: vi.fn().mockResolvedValue({ ok: true }),
  },
  Bucket: {
    LGPD_DELETION: 'lgpd.deletion_request',
    LGPD_EXPORT: 'lgpd.export',
  },
}))
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstile: vi.fn().mockResolvedValue({ ok: true, bypass: 'flag-off' }),
  extractTurnstileToken: vi.fn().mockResolvedValue(null),
}))
// Wave 13 — anonymize route now consults legal-hold + feature flag.
// Default mocks: subject is NOT under hold, and the enforce flag is
// OFF so existing happy-path tests keep passing. Individual tests
// can override per-case.
vi.mock('@/lib/legal-hold', () => ({
  isUnderLegalHold: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

function makeRequest(method = 'GET', body?: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/lgpd/export', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-req', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function makeAuthClient(user: { id: string } | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  }
}

function makeAdminWithData(overrides: Record<string, unknown> = {}) {
  const defaultChain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: overrides.profile ?? null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    not: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    // Wave 9 — createDsarRequest() does
    //   admin.from('dsar_requests').insert(...).select('*').single()
    // and lgpd/export reads ongoing dsar_requests via
    //   admin.from('dsar_requests').select(...).order(...)
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'dsar-test-1', sla_due_at: '2099-01-01T00:00:00Z' },
          error: null,
        }),
      }),
    }),
  }
  return {
    from: vi.fn().mockReturnValue(defaultChain),
    rpc: vi
      .fn()
      .mockResolvedValue({ data: { id: 'dsar-test-1', status: 'FULFILLED' }, error: null }),
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET /api/lgpd/export ─────────────────────────────────────────────────────

describe('GET /api/lgpd/export', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient(null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { GET } = await import('@/app/api/lgpd/export/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns JSON bundle for authenticated user', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient({ id: 'user-1' }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({
        profile: {
          id: 'user-1',
          full_name: 'André',
          email: 'a@a.com',
          phone: null,
          phone_encrypted: null,
          role: 'CLINIC_ADMIN',
          status: 'ACTIVE',
          created_at: '2024-01-01',
        },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { GET } = await import('@/app/api/lgpd/export/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    const body = await res.json()
    expect(body).toHaveProperty('user_id', 'user-1')
    expect(body).toHaveProperty('exported_at')
    expect(body).toHaveProperty('orders')
    expect(body).toHaveProperty('notifications')
  })

  it('includes X-Request-ID in response headers', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient(null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { GET } = await import('@/app/api/lgpd/export/route')
    const res = await GET(makeRequest())
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
})

// ── POST /api/lgpd/deletion-request ──────────────────────────────────────────

describe('POST /api/lgpd/deletion-request', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient(null) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/lgpd/deletion-request/route')
    const res = await POST(makeRequest('POST', { reason: 'Não quero mais' }))
    expect(res.status).toBe(401)
  })

  it('creates audit log and notifies SUPER_ADMIN', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient({ id: 'user-1' }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({
        profile: { full_name: 'André', email: 'a@a.com' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/lgpd/deletion-request/route')
    const res = await POST(makeRequest('POST', { reason: 'Quero ser esquecido' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message).toContain('15 dias úteis')
    expect(vi.mocked(auditModule.createAuditLog)).toHaveBeenCalled()
    expect(vi.mocked(notifModule.createNotificationForRole)).toHaveBeenCalledWith(
      'SUPER_ADMIN',
      expect.objectContaining({ title: expect.stringContaining('LGPD') })
    )
  })

  it('works without reason in body', async () => {
    vi.mocked(serverModule.createClient).mockResolvedValue(
      makeAuthClient({ id: 'user-2' }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData() as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/lgpd/deletion-request/route')
    const res = await POST(makeRequest('POST'))
    expect(res.status).toBe(200)
  })
})

// ── POST /api/admin/lgpd/anonymize/:userId ────────────────────────────────────

describe('POST /api/admin/lgpd/anonymize/:userId', () => {
  function makeAnonymizeRequest(userId = 'user-to-anon-0000-000000000001') {
    return new NextRequest(`http://localhost:3000/api/admin/lgpd/anonymize/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-req' },
    })
  }

  it('returns 400 for invalid userId', async () => {
    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const res = await POST(makeAnonymizeRequest('not-a-uuid'), {
      params: Promise.resolve({ userId: 'not-a-uuid' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({ profile: null }) as unknown as ReturnType<
        typeof adminModule.createAdminClient
      >
    )

    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const userId = '00000000-0000-0000-0000-000000000099'
    const res = await POST(makeAnonymizeRequest(userId), { params: Promise.resolve({ userId }) })
    expect(res.status).toBe(404)
  })

  it('anonymizes user and returns success with preserved list', async () => {
    const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { full_name: 'André', email: 'a@a.com', phone: '11999' },
          error: null,
        }),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
      }),
      auth: {
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ error: null }),
          signOut: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const userId = '00000000-0000-0000-0000-000000000001'
    const res = await POST(makeAnonymizeRequest(userId), { params: Promise.resolve({ userId }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.anonymized).toBe(userId)
    expect(body.preserved).toContain('payments')
    expect(vi.mocked(tokenModule.revokeAllUserTokens)).toHaveBeenCalledWith(userId)
    expect(vi.mocked(auditModule.createAuditLog)).toHaveBeenCalled()
  })

  it('returns 403 when caller lacks SUPER_ADMIN role', async () => {
    const { requireRole } = await import('@/lib/rbac')
    vi.mocked(requireRole).mockRejectedValueOnce(new Error('FORBIDDEN'))

    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const userId = '00000000-0000-0000-0000-000000000001'
    const res = await POST(makeAnonymizeRequest(userId), { params: Promise.resolve({ userId }) })
    expect(res.status).toBe(403)
  })

  // Wave 13 — legal-hold guard.
  it('returns 409 LEGAL_HOLD_ACTIVE when subject is held AND enforce flag is ON', async () => {
    const legalHoldMod = await import('@/lib/legal-hold')
    const featuresMod = await import('@/lib/features')
    vi.mocked(legalHoldMod.isUnderLegalHold).mockResolvedValueOnce(true)
    vi.mocked(featuresMod.isFeatureEnabled).mockImplementation(async (key: string) =>
      key === 'legal_hold.block_dsar_erasure' ? true : false
    )

    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminWithData({
        profile: { full_name: 'André', email: 'a@a.com', phone: '11999' },
      }) as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const userId = '00000000-0000-0000-0000-000000000002'
    const res = await POST(makeAnonymizeRequest(userId), { params: Promise.resolve({ userId }) })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('LEGAL_HOLD_ACTIVE')
    // Must NOT have actually anonymized
    expect(vi.mocked(tokenModule.revokeAllUserTokens)).not.toHaveBeenCalled()
  })

  it('ALLOWS anonymization when held but enforce flag is OFF (observe-only)', async () => {
    const legalHoldMod = await import('@/lib/legal-hold')
    const featuresMod = await import('@/lib/features')
    vi.mocked(legalHoldMod.isUnderLegalHold).mockResolvedValueOnce(true)
    vi.mocked(featuresMod.isFeatureEnabled).mockResolvedValue(false)

    const updateChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { full_name: 'André', email: 'a@a.com', phone: '11999' },
          error: null,
        }),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
      }),
      auth: {
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ error: null }),
          signOut: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/admin/lgpd/anonymize/[userId]/route')
    const userId = '00000000-0000-0000-0000-000000000003'
    const res = await POST(makeAnonymizeRequest(userId), { params: Promise.resolve({ userId }) })

    expect(res.status).toBe(200)
    expect(vi.mocked(tokenModule.revokeAllUserTokens)).toHaveBeenCalledWith(userId)
  })
})

// ── GET /api/cron/enforce-retention ──────────────────────────────────────────

describe('GET /api/cron/enforce-retention', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  })

  it('returns 401 without correct CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/enforce-retention/route')
    const req = new NextRequest('http://localhost/api/cron/enforce-retention', {
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns ok with retention summary on success', async () => {
    // The route is wrapped by withCronGuard, which also hits cron_runs + rpc;
    // overlay those onto the retention mock via attachCronGuard.
    const inner = makeAdminWithData()
    const stub = attachCronGuard({ from: (table) => inner.from(table) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      ...inner,
      ...stub.admin,
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)

    const { GET } = await import('@/app/api/cron/enforce-retention/route')
    const req = new NextRequest('http://localhost/api/cron/enforce-retention', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result).toHaveProperty('ran_at')
  })
})
