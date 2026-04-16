// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Supabase mocks ────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
vi.mock('@/lib/db/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

const mockUpsert = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      upsert: mockUpsert,
      delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: mockDelete })) })),
    })),
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object, method = 'POST') {
  return new NextRequest('http://localhost/api/push/subscribe', {
    method,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'test-agent' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/push/subscribe', () => {
  beforeEach(() => {
    mockGetUser.mockClear()
    mockUpsert.mockClear()
    mockDelete.mockClear()
  })

  it('TC-PUSH-01: returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/push/subscribe/route')
    const res = await POST(makeReq({ token: 'abc' }))
    expect(res.status).toBe(401)
  })

  it('TC-PUSH-02: returns 400 when token is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const { POST } = await import('@/app/api/push/subscribe/route')
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('TC-PUSH-03: upserts FCM token and returns 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockUpsert.mockResolvedValue({ error: null })
    const { POST } = await import('@/app/api/push/subscribe/route')
    const res = await POST(makeReq({ token: 'fcm-token-xyz' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fcm-token-xyz', user_id: 'user-1' }),
      expect.any(Object)
    )
  })

  it('TC-PUSH-04: returns 500 when upsert fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockUpsert.mockResolvedValue({ error: { message: 'db error' } })
    const { POST } = await import('@/app/api/push/subscribe/route')
    const res = await POST(makeReq({ token: 'fcm-token-xyz' }))
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/push/subscribe', () => {
  beforeEach(() => {
    mockGetUser.mockClear()
    mockDelete.mockClear()
  })

  it('TC-PUSH-05: returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { DELETE } = await import('@/app/api/push/subscribe/route')
    const req = new NextRequest('http://localhost/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc' }),
    })
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })

  it('TC-PUSH-06: deletes token and returns 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockDelete.mockResolvedValue({ error: null })
    const { DELETE } = await import('@/app/api/push/subscribe/route')
    const req = new NextRequest('http://localhost/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'fcm-token-xyz' }),
    })
    const res = await DELETE(req)
    expect(res.status).toBe(200)
  })
})

describe('lib/firebase/client — onForegroundMessage', () => {
  it('TC-PUSH-07: returns a no-op unsubscribe when window is undefined', async () => {
    // In Node.js environment, window is undefined — function should return () => {}
    const { onForegroundMessage } = await import('@/lib/firebase/client')
    const unsub = onForegroundMessage(() => {})
    expect(typeof unsub).toBe('function')
    expect(() => unsub()).not.toThrow()
  })

  it('TC-PUSH-08: requestPushPermission returns null in Node.js environment', async () => {
    const { requestPushPermission } = await import('@/lib/firebase/client')
    const token = await requestPushPermission()
    expect(token).toBeNull()
  })
})

describe('lib/zenvia — WhatsApp guard', () => {
  it('TC-WA-01: sendWhatsApp resolves without error when token is absent', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('+5511999999999', 'test')).resolves.toBeUndefined()
  })

  it('TC-WA-02: sendWhatsApp skips for empty phone', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('', 'test')).resolves.toBeUndefined()
  })

  it('TC-WA-03: sendWhatsApp skips for phone with fewer than 10 digits', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('123', 'test')).resolves.toBeUndefined()
  })
})

describe('lib/zenvia — SMS guard', () => {
  it('TC-SMS-01: sendSms resolves without error when token is absent', async () => {
    const { sendSms } = await import('@/lib/zenvia')
    await expect(sendSms('+5511999999999', 'test')).resolves.toBeUndefined()
  })

  it('TC-SMS-02: sendSms skips for empty phone', async () => {
    const { sendSms } = await import('@/lib/zenvia')
    await expect(sendSms('', 'test')).resolves.toBeUndefined()
  })
})
