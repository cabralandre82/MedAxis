// @vitest-environment node
/**
 * Unit tests for `lib/backup.ts` (Wave 12).
 *
 * Covers the three public surfaces:
 *
 *   - recordBackupRun()  — payload shape, RPC wiring, metric
 *                          emission per outcome.
 *   - getBackupFreshness() — computes age_seconds correctly and
 *                          propagates upstream errors.
 *   - verifyBackupChain() — unwraps the TABLE(...) RPC envelope.
 *
 * We also prove `recordRunSchema` rejects obvious poisons, since
 * the public ingest endpoint relies on it for trust.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const selectFn = vi.fn()
const fromFn = vi.fn()
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: (table: string) => fromFn(table),
  }),
}))

const incCounter = vi.fn()
const setGauge = vi.fn()
const observeHistogram = vi.fn()
vi.mock('@/lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metrics')>('@/lib/metrics')
  return {
    ...actual,
    incCounter: (...a: unknown[]) => incCounter(...a),
    setGauge: (...a: unknown[]) => setGauge(...a),
    observeHistogram: (...a: unknown[]) => observeHistogram(...a),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  fromFn.mockImplementation(() => ({ select: selectFn }))
})

describe('recordRunSchema', () => {
  it('accepts a well-formed BACKUP payload', async () => {
    const { recordRunSchema } = await import('@/lib/backup')
    const parsed = recordRunSchema.parse({
      kind: 'BACKUP',
      label: 'weekly',
      r2_prefix: 'weekly/20260417T070000Z',
      files_sha256: 'aa:db.dump\nbb:storage.tgz',
      size_bytes: 123456,
      outcome: 'ok',
      source_url: 'https://github.com/owner/repo/actions/runs/42',
      metadata: { commit: 'abc123' },
    })
    expect(parsed.kind).toBe('BACKUP')
    expect(parsed.size_bytes).toBe(123456)
  })

  it('rejects unknown kind', async () => {
    const { recordRunSchema } = await import('@/lib/backup')
    expect(() =>
      recordRunSchema.parse({
        kind: 'DESTROY',
        label: 'weekly',
        outcome: 'ok',
      })
    ).toThrow()
  })

  it('rejects empty label', async () => {
    const { recordRunSchema } = await import('@/lib/backup')
    expect(() => recordRunSchema.parse({ kind: 'BACKUP', label: '', outcome: 'ok' })).toThrow()
  })

  it('rejects negative size_bytes', async () => {
    const { recordRunSchema } = await import('@/lib/backup')
    expect(() =>
      recordRunSchema.parse({
        kind: 'BACKUP',
        label: 'weekly',
        size_bytes: -1,
        outcome: 'ok',
      })
    ).toThrow()
  })

  it('rejects malformed source_url', async () => {
    const { recordRunSchema } = await import('@/lib/backup')
    expect(() =>
      recordRunSchema.parse({
        kind: 'BACKUP',
        label: 'weekly',
        outcome: 'ok',
        source_url: 'not-a-url',
      })
    ).toThrow()
  })
})

describe('recordBackupRun', () => {
  it('invokes the RPC with the mapped arguments and emits ok metric', async () => {
    const row = {
      id: 'row-1',
      kind: 'BACKUP',
      label: 'weekly',
      r2_prefix: 'weekly/stamp',
      files_sha256: 'aa',
      size_bytes: 500,
      outcome: 'ok',
      source_url: 'https://x',
      metadata_json: {},
      recorded_at: '2026-04-17T10:00:00.000Z',
      prev_hash: null,
      row_hash: 'ff',
    }
    rpc.mockResolvedValueOnce({ data: row, error: null })

    const { recordBackupRun } = await import('@/lib/backup')
    const result = await recordBackupRun({
      kind: 'BACKUP',
      label: 'weekly',
      r2_prefix: 'weekly/stamp',
      files_sha256: 'aa',
      size_bytes: 500,
      outcome: 'ok',
      source_url: 'https://x',
      metadata: {},
    })

    expect(result).toEqual(row)
    expect(rpc).toHaveBeenCalledWith('backup_record_run', {
      p_kind: 'BACKUP',
      p_label: 'weekly',
      p_r2_prefix: 'weekly/stamp',
      p_files_sha256: 'aa',
      p_size_bytes: 500,
      p_outcome: 'ok',
      p_metadata: {},
      p_source_url: 'https://x',
    })

    // ok metric + gauges for BACKUP/ok path.
    expect(incCounter).toHaveBeenCalledWith(
      'backup_record_total',
      expect.objectContaining({ kind: 'BACKUP', outcome: 'ok', result: 'ok' })
    )
    expect(setGauge).toHaveBeenCalledWith(
      'backup_last_success_ts',
      expect.any(Number),
      expect.objectContaining({ label: 'weekly' })
    )
    expect(setGauge).toHaveBeenCalledWith(
      'backup_last_size_bytes',
      500,
      expect.objectContaining({ label: 'weekly' })
    )
  })

  it('records an error metric and rethrows when the RPC fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'violates check constraint' } })
    const { recordBackupRun } = await import('@/lib/backup')
    await expect(
      recordBackupRun({ kind: 'BACKUP', label: 'weekly', outcome: 'ok' })
    ).rejects.toThrow(/backup_record_run failed/)
    expect(incCounter).toHaveBeenCalledWith(
      'backup_record_total',
      expect.objectContaining({ result: 'error' })
    )
    // No success gauges on failure.
    expect(setGauge).not.toHaveBeenCalled()
  })

  it('only sets BACKUP gauges for BACKUP+ok, not for RESTORE_DRILL', async () => {
    const row = {
      id: 'row-2',
      kind: 'RESTORE_DRILL',
      label: 'monthly',
      r2_prefix: 'weekly/x',
      files_sha256: null,
      size_bytes: null,
      outcome: 'ok',
      source_url: null,
      metadata_json: {},
      recorded_at: '2026-04-17T10:00:00.000Z',
      prev_hash: null,
      row_hash: 'aa',
    }
    rpc.mockResolvedValueOnce({ data: row, error: null })
    const { recordBackupRun } = await import('@/lib/backup')
    await recordBackupRun({ kind: 'RESTORE_DRILL', label: 'monthly', outcome: 'ok' })
    // Only the restore-drill gauge should fire.
    expect(setGauge).toHaveBeenCalledWith(
      'restore_drill_last_success_ts',
      expect.any(Number),
      expect.objectContaining({ label: 'monthly' })
    )
    expect(setGauge).not.toHaveBeenCalledWith(
      'backup_last_success_ts',
      expect.any(Number),
      expect.anything()
    )
  })

  it('does NOT emit success gauges when outcome=fail', async () => {
    const row = {
      id: 'row-3',
      kind: 'BACKUP',
      label: 'weekly',
      r2_prefix: null,
      files_sha256: null,
      size_bytes: null,
      outcome: 'fail',
      source_url: null,
      metadata_json: {},
      recorded_at: '2026-04-17T10:00:00.000Z',
      prev_hash: null,
      row_hash: 'bb',
    }
    rpc.mockResolvedValueOnce({ data: row, error: null })
    const { recordBackupRun } = await import('@/lib/backup')
    await recordBackupRun({ kind: 'BACKUP', label: 'weekly', outcome: 'fail' })
    expect(setGauge).not.toHaveBeenCalled()
    expect(incCounter).toHaveBeenCalledWith(
      'backup_record_total',
      expect.objectContaining({ outcome: 'fail', result: 'ok' })
    )
  })
})

describe('getBackupFreshness', () => {
  it('annotates rows with age_seconds and preserves ordering', async () => {
    const now = Date.now()
    selectFn.mockResolvedValueOnce({
      data: [
        {
          kind: 'BACKUP',
          label: 'weekly',
          outcome: 'ok',
          r2_prefix: 'weekly/1',
          size_bytes: 1000,
          recorded_at: new Date(now - 3600 * 1000).toISOString(),
          source_url: 'https://x',
          metadata_json: {},
        },
        {
          kind: 'RESTORE_DRILL',
          label: 'monthly',
          outcome: 'ok',
          r2_prefix: 'weekly/2',
          size_bytes: null,
          recorded_at: new Date(now - 10 * 86400 * 1000).toISOString(),
          source_url: null,
          metadata_json: {},
        },
      ],
      error: null,
    })
    const { getBackupFreshness } = await import('@/lib/backup')
    const rows = await getBackupFreshness()
    expect(rows).toHaveLength(2)
    expect(rows[0].age_seconds).toBeGreaterThanOrEqual(3600 - 5)
    expect(rows[0].age_seconds).toBeLessThanOrEqual(3600 + 5)
    expect(rows[1].age_seconds).toBeGreaterThan(9 * 86400)
  })

  it('propagates SELECT errors', async () => {
    selectFn.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    const { getBackupFreshness } = await import('@/lib/backup')
    await expect(getBackupFreshness()).rejects.toThrow(/permission denied/)
  })

  it('returns an empty list when the view is empty', async () => {
    selectFn.mockResolvedValueOnce({ data: [], error: null })
    const { getBackupFreshness } = await import('@/lib/backup')
    await expect(getBackupFreshness()).resolves.toEqual([])
  })
})

describe('verifyBackupChain', () => {
  it('unwraps the TABLE(...) envelope returned by PostgREST', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ first_break_id: null, checked_rows: 5 }],
      error: null,
    })
    const { verifyBackupChain } = await import('@/lib/backup')
    const out = await verifyBackupChain('BACKUP')
    expect(out).toEqual({ first_break_id: null, checked_rows: 5 })
    expect(rpc).toHaveBeenCalledWith('backup_verify_chain', { p_kind: 'BACKUP' })
  })

  it('passes NULL kind when no filter is given', async () => {
    rpc.mockResolvedValueOnce({ data: { first_break_id: 'abc', checked_rows: 7 }, error: null })
    const { verifyBackupChain } = await import('@/lib/backup')
    const out = await verifyBackupChain()
    expect(out.first_break_id).toBe('abc')
    expect(rpc).toHaveBeenCalledWith('backup_verify_chain', { p_kind: null })
  })

  it('throws on RPC error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    const { verifyBackupChain } = await import('@/lib/backup')
    await expect(verifyBackupChain()).rejects.toThrow(/boom/)
  })
})
