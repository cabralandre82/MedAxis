// @vitest-environment node
/**
 * Unit tests for the Wave 13 admin legal-hold endpoints:
 *   - POST /api/admin/legal-hold/apply
 *   - POST /api/admin/legal-hold/release
 *   - GET  /api/admin/legal-hold/list
 *
 * We mock the `lib/legal-hold` module so the tests isolate the
 * HTTP concerns (RBAC, payload validation, audit emission, idem-
 * potency signalling) from the RPC wiring already covered in
 * tests/unit/lib/legal-hold.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const applyLegalHold = vi.fn()
const releaseLegalHold = vi.fn()
const listActiveHolds = vi.fn()
const listAllHolds = vi.fn()

vi.mock('@/lib/legal-hold', async () => {
  const actual = await vi.importActual<typeof import('@/lib/legal-hold')>('@/lib/legal-hold')
  return {
    ...actual,
    applyLegalHold: (...a: unknown[]) => applyLegalHold(...a),
    releaseLegalHold: (...a: unknown[]) => releaseLegalHold(...a),
    listActiveHolds: (...a: unknown[]) => listActiveHolds(...a),
    listAllHolds: (...a: unknown[]) => listAllHolds(...a),
  }
})

const requireRole = vi.fn()
vi.mock('@/lib/rbac', () => ({
  requireRole: (...a: unknown[]) => requireRole(...a),
}))

const createAuditLog = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/audit', () => ({
  createAuditLog: (...a: unknown[]) => createAuditLog(...a),
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
  AuditEntity: { PROFILE: 'PROFILE' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function makeReq(
  method: string,
  body?: unknown,
  url = 'https://app.test/api/admin/legal-hold/apply'
) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-request-id': 't-req' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireRole.mockResolvedValue({ id: 'dpo-uuid', roles: ['SUPER_ADMIN'] })
})

describe('POST /api/admin/legal-hold/apply', () => {
  const validBody = {
    subject_type: 'user',
    subject_id: '11111111-1111-4111-8111-111111111111',
    reason_code: 'ANPD_INVESTIGATION',
    reason: 'Processo SEI-ANPD-00123456/2026',
  }

  it('rejects callers without SUPER_ADMIN (403)', async () => {
    requireRole.mockRejectedValueOnce(new Error('FORBIDDEN'))
    const { POST } = await import('@/app/api/admin/legal-hold/apply/route')
    const res = await POST(makeReq('POST', validBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import('@/app/api/admin/legal-hold/apply/route')
    const res = await POST(makeReq('POST', '{not json'))
    expect(res.status).toBe(400)
  })

  it('returns 422 on schema violation with field diagnostics', async () => {
    const { POST } = await import('@/app/api/admin/legal-hold/apply/route')
    const res = await POST(makeReq('POST', { ...validBody, reason_code: 'UNKNOWN' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Invalid payload')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })

  it('emits audit + returns 201 on fresh creation', async () => {
    applyLegalHold.mockResolvedValueOnce({
      id: 'hold-id',
      subject_type: 'user',
      subject_id: validBody.subject_id,
      reason_code: 'ANPD_INVESTIGATION',
      placed_by: 'dpo-uuid',
      status: 'active',
      expires_at: null,
    })
    const { POST } = await import('@/app/api/admin/legal-hold/apply/route')
    const res = await POST(makeReq('POST', validBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.idempotent).toBe(false)
    expect(body.hold.id).toBe('hold-id')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PROFILE',
        entityId: 'hold-id',
        action: 'CREATE',
      })
    )
  })

  it('returns 200 + idempotent:true when DB returns an existing row', async () => {
    applyLegalHold.mockResolvedValueOnce({
      id: 'hold-id',
      subject_type: 'user',
      subject_id: validBody.subject_id,
      reason_code: 'ANPD_INVESTIGATION',
      placed_by: 'someone-else-uuid',
      status: 'active',
      expires_at: null,
    })
    const { POST } = await import('@/app/api/admin/legal-hold/apply/route')
    const res = await POST(makeReq('POST', validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent).toBe(true)
  })
})

describe('POST /api/admin/legal-hold/release', () => {
  it('rejects unauthenticated callers', async () => {
    requireRole.mockRejectedValueOnce(new Error('FORBIDDEN'))
    const { POST } = await import('@/app/api/admin/legal-hold/release/route')
    const res = await POST(
      makeReq(
        'POST',
        { hold_id: '11111111-1111-4111-8111-111111111111', release_reason: 'valid reason here' },
        'https://app.test/api/admin/legal-hold/release'
      )
    )
    expect(res.status).toBe(403)
  })

  it('rejects short release_reason (422)', async () => {
    const { POST } = await import('@/app/api/admin/legal-hold/release/route')
    const res = await POST(
      makeReq(
        'POST',
        { hold_id: '11111111-1111-4111-8111-111111111111', release_reason: 'short' },
        'https://app.test/api/admin/legal-hold/release'
      )
    )
    expect(res.status).toBe(422)
  })

  it('returns 200 + audit row on success', async () => {
    releaseLegalHold.mockResolvedValueOnce({
      id: 'hold-id',
      status: 'released',
      released_at: '2026-04-17T00:00:00Z',
      released_by: 'dpo-uuid',
      release_reason: 'Processo arquivado — smoke',
    })
    const { POST } = await import('@/app/api/admin/legal-hold/release/route')
    const res = await POST(
      makeReq(
        'POST',
        {
          hold_id: '11111111-1111-4111-8111-111111111111',
          release_reason: 'Processo arquivado — smoke',
        },
        'https://app.test/api/admin/legal-hold/release'
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.hold.status).toBe('released')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'PROFILE' })
    )
  })
})

describe('GET /api/admin/legal-hold/list', () => {
  it('defaults to active scope', async () => {
    listActiveHolds.mockResolvedValueOnce([{ id: 'h1', status: 'active' }])
    const { GET } = await import('@/app/api/admin/legal-hold/list/route')
    const res = await GET(makeReq('GET', undefined, 'https://app.test/api/admin/legal-hold/list'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('active')
    expect(listActiveHolds).toHaveBeenCalledTimes(1)
    expect(listAllHolds).not.toHaveBeenCalled()
  })

  it('respects scope=all', async () => {
    listAllHolds.mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }])
    const { GET } = await import('@/app/api/admin/legal-hold/list/route')
    const res = await GET(
      makeReq('GET', undefined, 'https://app.test/api/admin/legal-hold/list?scope=all')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('all')
    expect(listAllHolds).toHaveBeenCalledTimes(1)
    expect(body.count).toBe(2)
  })

  it('returns 403 for non-admin callers', async () => {
    requireRole.mockRejectedValueOnce(new Error('FORBIDDEN'))
    const { GET } = await import('@/app/api/admin/legal-hold/list/route')
    const res = await GET(makeReq('GET', undefined, 'https://app.test/api/admin/legal-hold/list'))
    expect(res.status).toBe(403)
  })
})
