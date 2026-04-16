// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationForRole: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import * as adminModule from '@/lib/db/admin'
import * as notificationsModule from '@/lib/notifications'
import { POST } from '@/app/api/contracts/webhook/route'

const HMAC_SECRET = 'test-hmac-secret-123'

const CONTRACT = {
  id: 'contract-1',
  type: 'CLINIC',
  entity_type: 'clinic',
  entity_id: 'entity-1',
  user_id: 'user-1',
  status: 'PENDING',
}

function sign(body: string, secret = HMAC_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: object, hmacSecret = HMAC_SECRET): NextRequest {
  const rawBody = JSON.stringify(body)
  return new NextRequest('http://localhost/api/contracts/webhook', {
    method: 'POST',
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'Content-Hmac': sign(rawBody, hmacSecret),
    },
  })
}

function buildAdmin(contractData: unknown = CONTRACT) {
  const updateSpy = vi.fn()
  const eqSpy = vi.fn().mockResolvedValue({ error: null })
  const updateBuilder = { eq: eqSpy }

  let callCount = 0
  const from = vi.fn(() => {
    callCount++
    if (callCount === 1) {
      // First call: select to look up the contract
      const b = { eq: vi.fn().mockReturnThis() } as Record<string, unknown>
      b.select = vi.fn().mockReturnValue(b)
      b.single = vi.fn().mockResolvedValue({ data: contractData, error: null })
      return b
    }
    // Subsequent calls: update
    updateSpy.mockReturnValue(updateBuilder)
    return { update: updateSpy }
  })
  return { client: { from }, updateSpy, eqSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLICKSIGN_WEBHOOK_SECRET = HMAC_SECRET
})

// ── HMAC authentication ───────────────────────────────────────────────────────

describe('HMAC authentication', () => {
  it('rejects request with wrong HMAC secret', async () => {
    const req = makeRequest({ event: { name: 'sign' }, document: { key: 'doc-1' } }, 'wrong-secret')
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects request with missing Content-Hmac header', async () => {
    const rawBody = JSON.stringify({ event: { name: 'sign' }, document: { key: 'doc-1' } })
    const req = new NextRequest('http://localhost/api/contracts/webhook', {
      method: 'POST',
      body: rawBody,
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('accepts request with correct HMAC', async () => {
    const { client } = buildAdmin(null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'sign' }, document: { key: 'doc-1' } })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('skips check when CLICKSIGN_WEBHOOK_SECRET is not set', async () => {
    delete process.env.CLICKSIGN_WEBHOOK_SECRET
    const { client } = buildAdmin(null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    // No Content-Hmac header — should still succeed
    const rawBody = JSON.stringify({ event: { name: 'sign' }, document: { key: 'doc-1' } })
    const req = new NextRequest('http://localhost/api/contracts/webhook', {
      method: 'POST',
      body: rawBody,
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})

// ── Early-exit guards ─────────────────────────────────────────────────────────

describe('early-exit guards', () => {
  it('returns skipped=true when documentKey is absent', async () => {
    const { client } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'sign' } })
    const res = await POST(req)
    const json = await res.json()
    expect(json.skipped).toBe(true)
  })

  it('returns skipped when contract not found in DB', async () => {
    const { client } = buildAdmin(null)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'sign' }, document: { key: 'unknown-key' } })
    const res = await POST(req)
    const json = await res.json()
    expect(json.skipped).toBeTruthy()
  })
})

// ── sign event ────────────────────────────────────────────────────────────────

describe('sign event', () => {
  it('updates contract status to SIGNED and notifies user and admins', async () => {
    const { client, updateSpy } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    const req = makeRequest({
      event: { name: 'sign' },
      document: {
        key: 'doc-1',
        downloads: { signed_file_url: 'https://cdn.clicksign.com/signed.pdf' },
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SIGNED',
        document_url: 'https://cdn.clicksign.com/signed.pdf',
      })
    )
    expect(notificationsModule.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'Contrato assinado com sucesso' })
    )
    expect(notificationsModule.createNotificationForRole).toHaveBeenCalledWith(
      'SUPER_ADMIN',
      expect.objectContaining({ title: expect.stringContaining('assinado') })
    )
  })

  it('skips user notification when contract has no user_id', async () => {
    const { client } = buildAdmin({ ...CONTRACT, user_id: null })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'sign' }, document: { key: 'doc-1' } })
    await POST(req)
    expect(notificationsModule.createNotification).not.toHaveBeenCalled()
    expect(notificationsModule.createNotificationForRole).toHaveBeenCalledOnce()
  })
})

// ── auto_close event ──────────────────────────────────────────────────────────

describe('auto_close event', () => {
  it('also marks contract as SIGNED', async () => {
    const { client, updateSpy } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'auto_close' }, document: { key: 'doc-1' } })
    await POST(req)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'SIGNED' }))
  })
})

// ── deadline event ────────────────────────────────────────────────────────────

describe('deadline event', () => {
  it('marks contract as EXPIRED and notifies user', async () => {
    const { client, updateSpy } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'deadline' }, document: { key: 'doc-1' } })
    await POST(req)
    expect(updateSpy).toHaveBeenCalledWith({ status: 'EXPIRED' })
    expect(notificationsModule.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'Contrato expirado' })
    )
  })
})

// ── cancel event ──────────────────────────────────────────────────────────────

describe('cancel event', () => {
  it('marks contract as CANCELLED and notifies user', async () => {
    const { client, updateSpy } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'cancel' }, document: { key: 'doc-1' } })
    await POST(req)
    expect(updateSpy).toHaveBeenCalledWith({ status: 'CANCELLED' })
    expect(notificationsModule.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', title: 'Contrato cancelado' })
    )
  })
})

// ── unknown events ────────────────────────────────────────────────────────────

describe('unknown events', () => {
  it('returns ok without updating contract for unhandled events', async () => {
    const { client, updateSpy } = buildAdmin()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    const req = makeRequest({ event: { name: 'upload' }, document: { key: 'doc-1' } })
    const res = await POST(req)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.event).toBe('upload')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(notificationsModule.createNotification).not.toHaveBeenCalled()
  })
})
