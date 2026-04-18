/**
 * Unit tests for lib/webhooks/dedup — Wave 2.
 *
 * Covers:
 *   - first delivery: insert succeeds → `{ status: 'claimed' }` with eventId
 *   - replay: unique-violation (23505) → `{ status: 'duplicate' }` with firstSeenAt
 *   - DB unreachable / RPC error: fail-open with `{ status: 'degraded' }`
 *   - completeWebhookEvent updates fields and swallows errors silently
 *   - asaasIdempotencyKey / clicksignIdempotencyKey determinism
 *   - argument validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

// ── Supabase admin client double ────────────────────────────────────────────
const singleMock = vi.fn()
const maybeSingleMock = vi.fn()
const updateMock = vi.fn()
const selectMock = vi.fn()
const insertMock = vi.fn()
const eqMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ from: fromMock }),
}))

function buildChain() {
  fromMock.mockImplementation(() => ({
    insert: insertMock,
    select: selectMock,
    update: updateMock,
    eq: eqMock,
  }))
  insertMock.mockImplementation(() => ({
    select: () => ({ single: singleMock }),
  }))
  selectMock.mockImplementation(() => ({
    eq: () => ({
      eq: () => ({ maybeSingle: maybeSingleMock }),
    }),
  }))
  updateMock.mockImplementation(() => ({ eq: eqMock }))
  eqMock.mockResolvedValue({ error: null })
}

import {
  asaasIdempotencyKey,
  claimWebhookEvent,
  clicksignIdempotencyKey,
  completeWebhookEvent,
} from '@/lib/webhooks/dedup'

beforeEach(() => {
  vi.clearAllMocks()
  buildChain()
})

describe('asaasIdempotencyKey', () => {
  it('combines payment.id with event name', () => {
    expect(asaasIdempotencyKey({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_123' } })).toBe(
      'pay_123:PAYMENT_CONFIRMED'
    )
  })

  it('is stable across invocations with the same input', () => {
    const body = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_abc' } }
    expect(asaasIdempotencyKey(body)).toBe(asaasIdempotencyKey(body))
  })

  it('falls back to placeholders when fields are missing', () => {
    expect(asaasIdempotencyKey({})).toBe('no-payment:unknown')
    expect(asaasIdempotencyKey({ event: 'X', payment: {} })).toBe('no-payment:X')
  })
})

describe('clicksignIdempotencyKey', () => {
  it('combines document.key + event.name + occurred_at', () => {
    const k = clicksignIdempotencyKey({
      document: { key: 'doc-abc' },
      event: { name: 'sign', occurred_at: '2026-04-17T12:00:00Z' },
    })
    expect(k).toBe('doc-abc:sign:2026-04-17T12:00:00Z')
  })

  it('falls back to sentinels on missing fields', () => {
    expect(clicksignIdempotencyKey({})).toBe('no-doc:unknown:no-time')
  })
})

describe('claimWebhookEvent - first delivery', () => {
  it('returns { status: "claimed", eventId } when insert succeeds', async () => {
    singleMock.mockResolvedValueOnce({ data: { id: 42 }, error: null })

    const result = await claimWebhookEvent({
      source: 'asaas',
      idempotencyKey: 'pay_1:PAYMENT_CONFIRMED',
      payload: '{"foo":"bar"}',
    })

    expect(result).toEqual({ status: 'claimed', eventId: 42 })
    expect(fromMock).toHaveBeenCalledWith('webhook_events')
    expect(insertMock).toHaveBeenCalledTimes(1)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.source).toBe('asaas')
    expect(inserted.idempotency_key).toBe('pay_1:PAYMENT_CONFIRMED')
    expect(inserted.status).toBe('received')
    // payload_hash is a sha256 of the stringified body
    const expectedHash = createHash('sha256').update('{"foo":"bar"}').digest()
    expect(Buffer.compare(inserted.payload_hash, expectedHash)).toBe(0)
  })

  it('hashes object payloads via JSON.stringify', async () => {
    singleMock.mockResolvedValueOnce({ data: { id: 1 }, error: null })

    await claimWebhookEvent({
      source: 'clicksign',
      idempotencyKey: 'doc-1:sign:t0',
      payload: { a: 1, b: 2 },
    })

    const inserted = insertMock.mock.calls[0][0]
    const expected = createHash('sha256')
      .update(JSON.stringify({ a: 1, b: 2 }))
      .digest()
    expect(Buffer.compare(inserted.payload_hash, expected)).toBe(0)
  })

  it('accepts a missing payload (payload_hash becomes null)', async () => {
    singleMock.mockResolvedValueOnce({ data: { id: 7 }, error: null })

    await claimWebhookEvent({
      source: 'asaas',
      idempotencyKey: 'k',
    })

    expect(insertMock.mock.calls[0][0].payload_hash).toBeNull()
  })
})

describe('claimWebhookEvent - replay / duplicate', () => {
  it('returns { status: "duplicate" } on unique-violation (23505)', async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: 99,
        received_at: '2026-04-17T10:00:00Z',
        status: 'processed',
        attempts: 3,
      },
      error: null,
    })

    const result = await claimWebhookEvent({
      source: 'asaas',
      idempotencyKey: 'replayed',
    })

    expect(result).toEqual({
      status: 'duplicate',
      eventId: 99,
      firstSeenAt: '2026-04-17T10:00:00Z',
      previousStatus: 'processed',
    })
  })

  it('bumps attempts counter on the duplicate row', async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: 99, received_at: '2026-04-17', status: 'processed', attempts: 4 },
      error: null,
    })

    await claimWebhookEvent({ source: 'asaas', idempotencyKey: 'x' })

    expect(updateMock).toHaveBeenCalled()
    const patch = updateMock.mock.calls[0][0]
    expect(patch.attempts).toBe(5)
    expect(patch.status).toBe('duplicate')
  })

  it('returns degraded when duplicate-row lookup fails', async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { code: '23505' } })
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    const result = await claimWebhookEvent({ source: 'asaas', idempotencyKey: 'x' })
    expect(result).toEqual({ status: 'degraded', reason: 'lookup-after-conflict' })
  })
})

describe('claimWebhookEvent - degraded paths', () => {
  it('returns degraded on non-unique DB error', async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })

    const result = await claimWebhookEvent({ source: 'asaas', idempotencyKey: 'k' })
    expect(result).toEqual({ status: 'degraded', reason: '42501' })
  })

  it('returns degraded when insert throws', async () => {
    singleMock.mockRejectedValueOnce(new Error('network down'))

    const result = await claimWebhookEvent({ source: 'asaas', idempotencyKey: 'k' })
    expect(result.status).toBe('degraded')
    if (result.status === 'degraded') {
      expect(result.reason).toBe('network down')
    }
  })

  it('throws synchronously on invalid arguments', async () => {
    await expect(claimWebhookEvent({ source: '', idempotencyKey: 'k' } as never)).rejects.toThrow(
      /source and idempotencyKey/
    )
    await expect(
      claimWebhookEvent({ source: 'asaas', idempotencyKey: '' } as never)
    ).rejects.toThrow(/source and idempotencyKey/)
  })
})

describe('completeWebhookEvent', () => {
  it('updates status, processed_at, http_status and error fields', async () => {
    eqMock.mockResolvedValueOnce({ error: null })
    await completeWebhookEvent(42, { status: 'processed', httpStatus: 200 })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const patch = updateMock.mock.calls[0][0]
    expect(patch.status).toBe('processed')
    expect(patch.http_status).toBe(200)
    expect(typeof patch.processed_at).toBe('string')
  })

  it('records failure with error string', async () => {
    eqMock.mockResolvedValueOnce({ error: null })
    await completeWebhookEvent(7, { status: 'failed', httpStatus: 500, error: 'oops' })

    const patch = updateMock.mock.calls[0][0]
    expect(patch.status).toBe('failed')
    expect(patch.error).toBe('oops')
  })

  it('silently ignores invalid eventId', async () => {
    await completeWebhookEvent(0, { status: 'processed' })
    await completeWebhookEvent(Number.NaN, { status: 'processed' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does NOT throw when the update errors', async () => {
    eqMock.mockResolvedValueOnce({ error: { message: 'db down' } })
    await expect(completeWebhookEvent(1, { status: 'processed' })).resolves.toBeUndefined()
  })

  it('does NOT throw when the client blows up', async () => {
    eqMock.mockRejectedValueOnce(new Error('network'))
    await expect(completeWebhookEvent(1, { status: 'processed' })).resolves.toBeUndefined()
  })
})
