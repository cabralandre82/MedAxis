// @vitest-environment node
/**
 * Unit tests for `logPiiView()` helper (Wave 9).
 *
 * `logPiiView` is the audit-trail contract that every server-side
 * read of PII fields must emit. It's a thin wrapper over
 * `createAuditLog` with stable `action='VIEW_PII'`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'

// Override the global setup.ts mock of @/lib/audit so we exercise the
// real implementation here — this is the only test file that cares
// about the actual insert payload rather than whether the helper was
// called.
vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return actual
})

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function makeInsertSpy() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  return {
    insert,
    admin: { from: vi.fn().mockReturnValue({ insert }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logPiiView', () => {
  it('inserts VIEW_PII row with scope metadata', async () => {
    const spy = makeInsertSpy()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      spy.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { logPiiView } = await import('@/lib/audit')
    await logPiiView({
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      subjectUserId: 'user-2',
      scope: ['full_name', 'email', 'phone'],
      reason: 'support_ticket_triage',
    })

    expect(spy.insert).toHaveBeenCalledTimes(1)
    const row = spy.insert.mock.calls[0][0]
    expect(row.actor_user_id).toBe('admin-1')
    expect(row.actor_role).toBe('SUPER_ADMIN')
    expect(row.entity_type).toBe('PROFILE')
    expect(row.entity_id).toBe('user-2')
    expect(row.action).toBe('VIEW_PII')
    expect(row.metadata_json).toMatchObject({
      scope: ['full_name', 'email', 'phone'],
      reason: 'support_ticket_triage',
    })
  })

  it('skips when scope is empty (no PII actually read)', async () => {
    const spy = makeInsertSpy()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      spy.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { logPiiView } = await import('@/lib/audit')
    await logPiiView({
      actorUserId: 'admin-1',
      subjectUserId: 'user-2',
      scope: [],
    })
    expect(spy.insert).not.toHaveBeenCalled()
  })

  it('includes ip and user_agent when supplied', async () => {
    const spy = makeInsertSpy()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      spy.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { logPiiView } = await import('@/lib/audit')
    await logPiiView({
      actorUserId: 'admin-1',
      subjectUserId: 'user-2',
      scope: ['email'],
      ip: '203.0.113.5',
      userAgent: 'curl/8',
    })
    const row = spy.insert.mock.calls[0][0]
    expect(row.ip).toBe('203.0.113.5')
    expect(row.user_agent).toBe('curl/8')
  })

  it('swallows database errors (never throws)', async () => {
    const spy = {
      insert: vi.fn().mockRejectedValue(new Error('db down')),
    }
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(spy),
    } as unknown as ReturnType<typeof adminModule.createAdminClient>)
    const { logPiiView } = await import('@/lib/audit')
    await expect(
      logPiiView({
        actorUserId: 'a',
        subjectUserId: 'b',
        scope: ['phone'],
      })
    ).resolves.toBeUndefined()
  })

  it('null actorRole becomes undefined in insert (audit_logs nullable)', async () => {
    const spy = makeInsertSpy()
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      spy.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
    const { logPiiView } = await import('@/lib/audit')
    await logPiiView({
      actorUserId: 'admin-1',
      actorRole: null,
      subjectUserId: 'user-2',
      scope: ['phone'],
    })
    const row = spy.insert.mock.calls[0][0]
    expect(row.actor_role).toBeNull()
  })
})
