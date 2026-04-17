import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @opentelemetry/api before importing tracing
const mockSpanEnd = vi.fn()
const mockSetStatus = vi.fn()
const mockSetAttributes = vi.fn()
const mockRecordException = vi.fn()
const mockStartActiveSpan = vi.fn()

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn(() => ({
      startActiveSpan: mockStartActiveSpan,
    })),
  },
  SpanStatusCode: {
    OK: 'OK',
    ERROR: 'ERROR',
  },
}))

beforeEach(() => {
  vi.clearAllMocks()

  // Default: span completes synchronously calling the callback
  mockStartActiveSpan.mockImplementation((_name: string, fn: (span: unknown) => unknown) => {
    const span = {
      end: mockSpanEnd,
      setStatus: mockSetStatus,
      setAttributes: mockSetAttributes,
      recordException: mockRecordException,
    }
    return fn(span)
  })
})

describe('withSpan', () => {
  it('returns the result of the wrapped fn', async () => {
    const { withSpan } = await import('@/lib/tracing')
    const result = await withSpan('test.op', async () => 42)
    expect(result).toBe(42)
  })

  it('calls startActiveSpan with the provided name', async () => {
    const { withSpan } = await import('@/lib/tracing')
    await withSpan('order.create', async () => 'done')
    expect(mockStartActiveSpan).toHaveBeenCalledWith('order.create', expect.any(Function))
  })

  it('sets span status to OK on success', async () => {
    const { withSpan } = await import('@/lib/tracing')
    await withSpan('ok.op', async () => 'value')
    expect(mockSetStatus).toHaveBeenCalledWith({ code: 'OK' })
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('sets span attributes when provided', async () => {
    const { withSpan } = await import('@/lib/tracing')
    await withSpan('attr.op', async () => 'x', { 'db.table': 'orders', 'db.op': 'select' })
    expect(mockSetAttributes).toHaveBeenCalledWith({ 'db.table': 'orders', 'db.op': 'select' })
  })

  it('does not call setAttributes when attributes are omitted', async () => {
    const { withSpan } = await import('@/lib/tracing')
    await withSpan('no.attr', async () => null)
    expect(mockSetAttributes).not.toHaveBeenCalled()
  })

  it('sets ERROR status, records exception and re-throws on failure', async () => {
    const { withSpan } = await import('@/lib/tracing')
    const err = new Error('something broke')

    await expect(
      withSpan('fail.op', async () => {
        throw err
      })
    ).rejects.toThrow('something broke')

    expect(mockSetStatus).toHaveBeenCalledWith({
      code: 'ERROR',
      message: 'something broke',
    })
    expect(mockRecordException).toHaveBeenCalledWith(err)
    expect(mockSpanEnd).toHaveBeenCalled()
  })

  it('wraps non-Error thrown values as Error for recordException', async () => {
    const { withSpan } = await import('@/lib/tracing')

    await expect(
      withSpan('fail.string', async () => {
        throw 'string error'
      })
    ).rejects.toThrow()

    expect(mockRecordException).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('withDbSpan', () => {
  it('passes db-specific attributes to the span', async () => {
    const { withDbSpan } = await import('@/lib/tracing')
    await withDbSpan('orders', 'select', async () => ({ data: [], error: null }))

    expect(mockSetAttributes).toHaveBeenCalledWith({
      'db.system': 'postgresql',
      'db.name': 'supabase',
      'db.sql.table': 'orders',
      'db.operation': 'select',
    })
  })

  it('uses span name db.<table>.<operation>', async () => {
    const { withDbSpan } = await import('@/lib/tracing')
    await withDbSpan('profiles', 'insert', async () => ({ data: null, error: null }))
    expect(mockStartActiveSpan).toHaveBeenCalledWith('db.profiles.insert', expect.any(Function))
  })

  it('returns the fn result', async () => {
    const { withDbSpan } = await import('@/lib/tracing')
    const result = await withDbSpan('products', 'select', async () => ({
      data: [{ id: '1' }],
      error: null,
    }))
    expect(result).toEqual({ data: [{ id: '1' }], error: null })
  })
})

describe('withHttpSpan', () => {
  it('passes http-specific attributes', async () => {
    const { withHttpSpan } = await import('@/lib/tracing')
    await withHttpSpan('clicksign', 'upload', async () => 'doc-key')

    expect(mockSetAttributes).toHaveBeenCalledWith({
      'http.service': 'clicksign',
      'http.operation': 'upload',
    })
  })

  it('uses span name http.<service>.<operation>', async () => {
    const { withHttpSpan } = await import('@/lib/tracing')
    await withHttpSpan('asaas', 'charge', async () => null)
    expect(mockStartActiveSpan).toHaveBeenCalledWith('http.asaas.charge', expect.any(Function))
  })

  it('returns fn result', async () => {
    const { withHttpSpan } = await import('@/lib/tracing')
    const result = await withHttpSpan('openai', 'complete', async () => 'response')
    expect(result).toBe('response')
  })
})
