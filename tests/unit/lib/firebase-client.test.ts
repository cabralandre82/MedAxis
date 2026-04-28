/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Sentry id `de5eecaa3dd94957b59161d64ad262ae` — `messaging/unsupported-browser`
 * fired as an unhandled promise rejection from `lib/firebase/client.ts` on iOS
 * Safari. The fix gates `getMessaging()` behind `await isSupported()` and
 * makes `onForegroundMessage` synchronously return a no-op unsubscribe so
 * callers in `useEffect` stay happy.
 *
 * These tests verify that:
 *   1. When `isSupported()` resolves false, `onForegroundMessage` returns a
 *      no-op without ever calling `getMessaging()` (would throw).
 *   2. `requestPushPermission` returns null cleanly (no throw, no console.error).
 *   3. The unsubscribe returned by `onForegroundMessage` is safe to call even
 *      if Firebase later resolves async.
 */

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
  getApps: vi.fn(() => [{ name: 'test-app' }]),
}))

const mockIsSupported = vi.fn()
const mockGetMessaging = vi.fn()
const mockOnMessage = vi.fn()
const mockGetToken = vi.fn()

vi.mock('firebase/messaging', () => ({
  isSupported: () => mockIsSupported(),
  getMessaging: (...args: unknown[]) => mockGetMessaging(...args),
  onMessage: (...args: unknown[]) => mockOnMessage(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  ;(globalThis as { Notification?: unknown }).Notification = undefined
})

describe('lib/firebase/client — onForegroundMessage', () => {
  it('returns a no-op unsubscribe without touching getMessaging when isSupported() is false', async () => {
    mockIsSupported.mockResolvedValue(false)
    const { onForegroundMessage } = await import('@/lib/firebase/client')

    const unsubscribe = onForegroundMessage(() => {})

    // Caller must always get a function back, never throw.
    expect(typeof unsubscribe).toBe('function')

    // Wait one microtask flush so the inner async resolves.
    await Promise.resolve()
    await Promise.resolve()

    expect(mockGetMessaging).not.toHaveBeenCalled()
    expect(mockOnMessage).not.toHaveBeenCalled()

    // Calling unsubscribe is safe.
    expect(() => unsubscribe()).not.toThrow()
  })

  it('does not throw when getMessaging itself throws synchronously', async () => {
    mockIsSupported.mockResolvedValue(true)
    mockGetMessaging.mockImplementation(() => {
      throw new Error('messaging/unsupported-browser')
    })
    const { onForegroundMessage } = await import('@/lib/firebase/client')

    const unsubscribe = onForegroundMessage(() => {})
    expect(typeof unsubscribe).toBe('function')

    await Promise.resolve()
    await Promise.resolve()

    expect(mockOnMessage).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it('subscribes when isSupported() resolves true', async () => {
    mockIsSupported.mockResolvedValue(true)
    mockGetMessaging.mockReturnValue({ kind: 'fake-messaging' })
    const onMessageUnsub = vi.fn()
    mockOnMessage.mockImplementation(() => onMessageUnsub)
    const { onForegroundMessage } = await import('@/lib/firebase/client')

    const unsubscribe = onForegroundMessage(() => {})

    // Drain enough microtasks to let the inner async resolve `isSupported()`
    // and call `getMessaging()` + `onMessage()`. The number is generous on
    // purpose — vitest module reset across tests can introduce extra ticks.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
    }

    expect(mockGetMessaging).toHaveBeenCalledTimes(1)
    expect(mockOnMessage).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(onMessageUnsub).toHaveBeenCalledTimes(1)
  })
})

describe('lib/firebase/client — requestPushPermission', () => {
  it('returns null cleanly when Notification API is missing (e.g. iOS Safari old)', async () => {
    const { requestPushPermission } = await import('@/lib/firebase/client')
    const result = await requestPushPermission()
    expect(result).toBeNull()
  })
})
