// @vitest-environment node
/**
 * Unit tests for `lib/legal-hold.ts` (Wave 13).
 *
 * We exercise the four public surfaces:
 *
 *   - applyHoldSchema / releaseHoldSchema  — input validation.
 *   - applyLegalHold / releaseLegalHold    — RPC wiring + metrics.
 *   - isUnderLegalHold                     — fail-safe semantics +
 *                                            per-call cache.
 *   - expireStaleHolds                     — RPC envelope unwrap +
 *                                            metric emission.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const fromFn = vi.fn()
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: (table: string) => fromFn(table),
  }),
}))

const incCounter = vi.fn()
const setGauge = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...a: unknown[]) => incCounter(...a),
    setGauge: (...a: unknown[]) => setGauge(...a),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyHoldSchema', () => {
  it('accepts a well-formed ANPD payload', async () => {
    const { applyHoldSchema } = await import('@/lib/legal-hold')
    const p = applyHoldSchema.parse({
      subject_type: 'user',
      subject_id: '11111111-1111-4111-8111-111111111111',
      reason_code: 'ANPD_INVESTIGATION',
      reason: 'Processo SEI-ANPD-00123456/2026 inquérito preliminar',
      expires_at: null,
      document_refs: [{ ref: 'SEI-123' }],
      requestor: { org: 'ANPD' },
    })
    expect(p.reason_code).toBe('ANPD_INVESTIGATION')
  })

  it('rejects reason shorter than 10 chars', async () => {
    const { applyHoldSchema } = await import('@/lib/legal-hold')
    expect(() =>
      applyHoldSchema.parse({
        subject_type: 'user',
        subject_id: '11111111-1111-4111-8111-111111111111',
        reason_code: 'OTHER',
        reason: 'short',
      })
    ).toThrow()
  })

  it('rejects unknown reason_code', async () => {
    const { applyHoldSchema } = await import('@/lib/legal-hold')
    expect(() =>
      applyHoldSchema.parse({
        subject_type: 'user',
        subject_id: '11111111-1111-4111-8111-111111111111',
        reason_code: 'UNKNOWN_REASON',
        reason: 'valid reason text here',
      })
    ).toThrow()
  })

  it('rejects non-uuid subject_id', async () => {
    const { applyHoldSchema } = await import('@/lib/legal-hold')
    expect(() =>
      applyHoldSchema.parse({
        subject_type: 'user',
        subject_id: 'not-a-uuid',
        reason_code: 'OTHER',
        reason: 'valid reason text here',
      })
    ).toThrow()
  })
})

describe('releaseHoldSchema', () => {
  it('requires release_reason ≥ 10 chars', async () => {
    const { releaseHoldSchema } = await import('@/lib/legal-hold')
    expect(() =>
      releaseHoldSchema.parse({
        hold_id: '11111111-1111-4111-8111-111111111111',
        release_reason: 'short',
      })
    ).toThrow()
  })
})

describe('applyLegalHold', () => {
  it('passes all required RPC args and emits OK counter', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'hold-uuid',
        subject_type: 'user',
        subject_id: 'sub-uuid',
        reason_code: 'ANPD_INVESTIGATION',
        placed_by: 'dpo-uuid',
        status: 'active',
      },
      error: null,
    })
    const { applyLegalHold } = await import('@/lib/legal-hold')
    const row = await applyLegalHold(
      {
        subject_type: 'user',
        subject_id: '11111111-1111-4111-8111-111111111111',
        reason_code: 'ANPD_INVESTIGATION',
        reason: 'Processo SEI-ANPD-00123456',
        expires_at: null,
      },
      'dpo-uuid'
    )
    expect(rpc).toHaveBeenCalledWith(
      'legal_hold_apply',
      expect.objectContaining({
        p_subject_type: 'user',
        p_reason_code: 'ANPD_INVESTIGATION',
        p_placed_by: 'dpo-uuid',
      })
    )
    expect(row.id).toBe('hold-uuid')
    expect(incCounter).toHaveBeenCalledWith(
      'legal_hold_apply_total',
      expect.objectContaining({ reason_code: 'ANPD_INVESTIGATION', outcome: 'ok' })
    )
  })

  it('propagates RPC error and emits error counter', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'pg down' } })
    const { applyLegalHold } = await import('@/lib/legal-hold')
    await expect(
      applyLegalHold(
        {
          subject_type: 'user',
          subject_id: '11111111-1111-4111-8111-111111111111',
          reason_code: 'OTHER',
          reason: 'valid reason text',
        },
        'dpo-uuid'
      )
    ).rejects.toThrow(/legal_hold_apply failed/)
    expect(incCounter).toHaveBeenCalledWith(
      'legal_hold_apply_total',
      expect.objectContaining({ outcome: 'error' })
    )
  })
})

describe('releaseLegalHold', () => {
  it('sends release_reason + released_by and emits OK counter', async () => {
    rpc.mockResolvedValue({
      data: {
        id: 'hold-uuid',
        status: 'released',
        released_by: 'dpo-uuid',
        release_reason: 'Processo arquivado em 2026-10-15',
      },
      error: null,
    })
    const { releaseLegalHold } = await import('@/lib/legal-hold')
    const row = await releaseLegalHold(
      {
        hold_id: '11111111-1111-4111-8111-111111111111',
        release_reason: 'Processo arquivado em 2026-10-15',
      },
      'dpo-uuid'
    )
    expect(row.status).toBe('released')
    expect(incCounter).toHaveBeenCalledWith(
      'legal_hold_release_total',
      expect.objectContaining({ outcome: 'ok' })
    )
  })
})

describe('isUnderLegalHold', () => {
  it('returns true when RPC says active', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const { isUnderLegalHold } = await import('@/lib/legal-hold')
    const held = await isUnderLegalHold('user', 'sub-uuid')
    expect(held).toBe(true)
  })

  it('returns false when RPC says false', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const { isUnderLegalHold } = await import('@/lib/legal-hold')
    const held = await isUnderLegalHold('user', 'sub-uuid')
    expect(held).toBe(false)
  })

  it('fails-safe to TRUE when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'pg down' } })
    const { isUnderLegalHold } = await import('@/lib/legal-hold')
    const held = await isUnderLegalHold('user', 'sub-uuid')
    expect(held).toBe(true)
  })

  it('uses the supplied cache to avoid re-querying', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const { isUnderLegalHold } = await import('@/lib/legal-hold')
    const cache = new Map<string, boolean>()
    await isUnderLegalHold('user', 'sub-uuid', cache)
    await isUnderLegalHold('user', 'sub-uuid', cache)
    await isUnderLegalHold('user', 'sub-uuid', cache)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(cache.get('user:sub-uuid')).toBe(true)
  })
})

describe('expireStaleHolds', () => {
  it('unwraps TABLE envelope and emits counter when > 0', async () => {
    rpc.mockResolvedValue({ data: [{ expired_count: 3 }], error: null })
    const { expireStaleHolds } = await import('@/lib/legal-hold')
    const { expired } = await expireStaleHolds()
    expect(expired).toBe(3)
    expect(incCounter).toHaveBeenCalledWith('legal_hold_expired_total', {}, 3)
  })

  it('accepts scalar return shape', async () => {
    rpc.mockResolvedValue({ data: { expired_count: 0 }, error: null })
    const { expireStaleHolds } = await import('@/lib/legal-hold')
    const { expired } = await expireStaleHolds()
    expect(expired).toBe(0)
    expect(incCounter).not.toHaveBeenCalledWith(
      'legal_hold_expired_total',
      expect.anything(),
      expect.anything()
    )
  })

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { expireStaleHolds } = await import('@/lib/legal-hold')
    await expect(expireStaleHolds()).rejects.toThrow(/legal_hold_expire_stale failed/)
  })
})

describe('recordPurgeBlocked', () => {
  it('skips emission when count = 0', async () => {
    const { recordPurgeBlocked } = await import('@/lib/legal-hold')
    recordPurgeBlocked('enforce-retention', 0)
    expect(incCounter).not.toHaveBeenCalledWith(
      'legal_hold_blocked_purge_total',
      expect.anything(),
      expect.anything()
    )
  })

  it('emits with job label when count > 0', async () => {
    const { recordPurgeBlocked } = await import('@/lib/legal-hold')
    recordPurgeBlocked('enforce-retention', 7)
    expect(incCounter).toHaveBeenCalledWith(
      'legal_hold_blocked_purge_total',
      { job: 'enforce-retention' },
      7
    )
  })
})
