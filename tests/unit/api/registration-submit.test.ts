import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as adminModule from '@/lib/db/admin'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  registrationLimiter: {
    check: vi.fn().mockResolvedValue({ ok: true, resetAt: 0 }),
  },
}))
vi.mock('resend', () => {
  function MockResend() {
    return { emails: { send: vi.fn().mockResolvedValue({ data: {}, error: null }) } }
  }
  return { Resend: MockResend }
})

function makeFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('type', overrides.type ?? 'CLINIC')
  fd.append(
    'form_data',
    JSON.stringify({
      email: overrides.email ?? 'test@clinic.com',
      password: overrides.password ?? 'Senha@1234',
      full_name: overrides.full_name ?? 'Clínica Teste',
      trade_name: 'Clínica Teste',
      cnpj: '11.222.333/0001-81',
    })
  )
  return fd
}

function makeRequest(fd: FormData) {
  return new NextRequest('http://localhost:3000/api/registration/submit', {
    method: 'POST',
    body: fd,
  })
}

function makeAdminClient({
  createUserError = null,
  profileUpsertError = null,
  roleInsertError = null,
  registrationRequestError = null,
}: {
  createUserError?: unknown
  profileUpsertError?: unknown
  roleInsertError?: unknown
  registrationRequestError?: unknown
} = {}) {
  const userId = 'user-new-1'
  let upsertCallCount = 0

  return {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: createUserError ? null : { id: userId } },
          error: createUserError ?? null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        upsertCallCount++
        return {
          upsert: vi.fn().mockResolvedValue({ error: profileUpsertError ?? null }),
        }
      }
      if (table === 'user_roles') {
        return {
          insert: vi.fn().mockResolvedValue({ error: roleInsertError ?? null }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      if (table === 'registration_requests') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: registrationRequestError ? null : { id: 'req-1' },
            error: registrationRequestError ?? null,
          }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'http://test.com/doc' } }),
      }),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/registration/submit', () => {
  it('returns 400 when type or form_data is missing', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const fd = new FormData()
    fd.append('type', 'CLINIC')
    const res = await POST(makeRequest(fd))
    expect(res.status).toBe(400)
  })

  it('returns 500 when profile upsert fails (rolls back auth user)', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ profileUpsertError: { message: 'upsert failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erro ao criar perfil')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })

  it('returns 500 when user_roles insert fails (rolls back auth user)', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ roleInsertError: { message: 'role failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erro ao atribuir papel')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })

  it('returns 500 when registration_requests insert fails (rolls back auth user)', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient({ registrationRequestError: { message: 'req failed' } })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Erro ao registrar solicitação')
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith('user-new-1')
  })

  it('returns 201 on successful registration', async () => {
    const { POST } = await import('@/app/api/registration/submit/route')
    const admin = makeAdminClient()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )

    const res = await POST(makeRequest(makeFormData()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.request_id).toBe('req-1')
  })
})
