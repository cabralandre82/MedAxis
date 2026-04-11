import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logger', () => {
  it('logs JSON with level, message and timestamp', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('test message')

    expect(console.log).toHaveBeenCalledOnce()
    const arg = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('test message')
    expect(parsed.timestamp).toBeTruthy()
    expect(parsed.env).toBeTruthy()
  })

  it('logger.warn uses console.warn', async () => {
    const { logger } = await import('@/lib/logger')
    logger.warn('something might be wrong')
    expect(console.warn).toHaveBeenCalledOnce()
    const arg = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(JSON.parse(arg).level).toBe('warn')
  })

  it('logger.error uses console.error and serializes Error objects', async () => {
    const { logger } = await import('@/lib/logger')
    const err = new Error('test error')
    logger.error('something failed', { error: err })

    expect(console.error).toHaveBeenCalledOnce()
    const arg = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('error')
    expect(parsed.errorMessage).toBe('test error')
    expect(parsed.errorName).toBe('Error')
    expect(parsed.errorStack).toContain('Error: test error')
  })

  it('logger.error handles non-Error objects', async () => {
    const { logger } = await import('@/lib/logger')
    logger.error('db failed', { error: { code: '23505', message: 'unique constraint' } })

    const arg = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('error')
    // Non-Error objects are spread into errorRaw
    expect(parsed.errorRaw ?? parsed.errorMessage).toBeTruthy()
  })

  it('includes extra context fields in the log entry', async () => {
    const { logger } = await import('@/lib/logger')
    logger.info('order created', {
      requestId: 'req-123',
      userId: 'user-abc',
      action: 'CREATE_ORDER',
      durationMs: 450,
    })

    const arg = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const parsed = JSON.parse(arg)
    expect(parsed.requestId).toBe('req-123')
    expect(parsed.userId).toBe('user-abc')
    expect(parsed.action).toBe('CREATE_ORDER')
    expect(parsed.durationMs).toBe(450)
  })

  it('logger.debug does not call console.debug in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { logger } = await import('@/lib/logger')
    logger.debug('verbose detail')
    expect(console.debug).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  describe('logger.child', () => {
    it('returns a child logger with fixed context', async () => {
      const { logger } = await import('@/lib/logger')
      const child = logger.child({ requestId: 'fixed-req', userId: 'fixed-user' })
      child.info('child message', { action: 'TEST' })

      const arg = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(arg)
      expect(parsed.requestId).toBe('fixed-req')
      expect(parsed.userId).toBe('fixed-user')
      expect(parsed.action).toBe('TEST')
      expect(parsed.message).toBe('child message')
    })

    it('child context can be overridden per call', async () => {
      const { logger } = await import('@/lib/logger')
      const child = logger.child({ requestId: 'base-req' })
      child.info('override test', { requestId: 'override-req' })

      const arg = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(arg)
      expect(parsed.requestId).toBe('override-req')
    })

    it('child.error propagates error correctly', async () => {
      const { logger } = await import('@/lib/logger')
      const child = logger.child({ requestId: 'r1' })
      child.error('child error', { error: new Error('child fail') })

      expect(console.error).toHaveBeenCalledOnce()
      const arg = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      const parsed = JSON.parse(arg)
      expect(parsed.errorMessage).toBe('child fail')
      expect(parsed.requestId).toBe('r1')
    })
  })
})
