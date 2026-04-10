/**
 * Tests for lib/monitoring.ts — the Sentry abstraction layer.
 *
 * We verify that:
 *   1. Functions don't throw when DSN is absent (no-op mode)
 *   2. Console.error is called as fallback when DSN is missing
 *   3. The interface contract is correct
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @sentry/nextjs before importing monitoring
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({ setUser: vi.fn(), setTag: vi.fn(), setExtra: vi.fn() })
  ),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  setUser: vi.fn(),
}))

describe('lib/monitoring — no-op mode (no DSN)', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
  })

  it('captureError does not throw when DSN is absent', async () => {
    const { captureError } = await import('@/lib/monitoring')
    expect(() => captureError(new Error('test'), { action: 'test' })).not.toThrow()
  })

  it('captureError falls back to console.error when no DSN', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { captureError } = await import('@/lib/monitoring')
    captureError(new Error('fallback error'), { userId: 'u1', action: 'test_action' })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[error]',
      expect.objectContaining({
        message: 'fallback error',
      })
    )
    consoleSpy.mockRestore()
  })

  it('recordMetric does not throw when DSN is absent', async () => {
    const { recordMetric } = await import('@/lib/monitoring')
    expect(() => recordMetric('test-metric', { value: 42 })).not.toThrow()
  })

  it('identifyUser does not throw when DSN is absent', async () => {
    const { identifyUser } = await import('@/lib/monitoring')
    expect(() => identifyUser('user-123', 'SUPER_ADMIN')).not.toThrow()
  })

  it('captureError handles non-Error objects gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { captureError } = await import('@/lib/monitoring')
    captureError('string error')
    captureError({ code: 'SOME_ERROR' })
    captureError(null)
    expect(consoleSpy).toHaveBeenCalledTimes(3)
    consoleSpy.mockRestore()
  })
})

describe('lib/monitoring — active mode (with DSN)', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://test@mock.ingest.sentry.io/123'
    vi.clearAllMocks()
    vi.resetModules() // force re-import to pick up new env
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    vi.resetModules()
  })

  it('captureError calls Sentry.captureException when DSN is set', async () => {
    const Sentry = await import('@sentry/nextjs')
    const { captureError } = await import('@/lib/monitoring')
    captureError(new Error('sentry error'), { userId: 'u2' })
    expect(Sentry.withScope).toHaveBeenCalled()
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error))
  })

  it('recordMetric calls Sentry.addBreadcrumb when DSN is set', async () => {
    const Sentry = await import('@sentry/nextjs')
    const { recordMetric } = await import('@/lib/monitoring')
    recordMetric('slow-query', { table: 'orders', ms: 300 })
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'slow-query', level: 'info' })
    )
  })
})
