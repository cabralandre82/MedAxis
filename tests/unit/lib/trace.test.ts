import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseTraceparent,
  formatTraceparent,
  newTraceId,
  newSpanId,
  currentTraceParent,
  updateTraceFromHeaders,
  fetchWithTrace,
} from '@/lib/trace'
import { runWithRequestContext, makeRequestContext } from '@/lib/logger/context'
import { __resetMetricsForTests, snapshotMetrics } from '@/lib/metrics'

describe('parseTraceparent', () => {
  it('parses a well-formed traceparent', () => {
    const raw = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const parsed = parseTraceparent(raw)
    expect(parsed).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    })
  })

  it('lower-cases mixed-case input', () => {
    const parsed = parseTraceparent('00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-00')
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(parsed?.spanId).toBe('00f067aa0ba902b7')
    expect(parsed?.sampled).toBe(false)
  })

  it('rejects null, empty, or malformed headers', () => {
    expect(parseTraceparent(null)).toBeNull()
    expect(parseTraceparent(undefined)).toBeNull()
    expect(parseTraceparent('')).toBeNull()
    expect(parseTraceparent('garbage')).toBeNull()
    expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull()
  })

  it('rejects reserved all-zero trace or span ids', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull()
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull()
  })
})

describe('formatTraceparent / newTraceId / newSpanId', () => {
  it('round-trips through parse', () => {
    const tp = {
      traceId: newTraceId(),
      spanId: newSpanId(),
      sampled: true,
    }
    expect(parseTraceparent(formatTraceparent(tp))).toEqual(tp)
  })

  it('emits 32-char hex trace ids and 16-char hex span ids', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces sampled=00 flag when sampled:false', () => {
    const formatted = formatTraceparent({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      sampled: false,
    })
    expect(formatted.endsWith('-00')).toBe(true)
  })
})

describe('currentTraceParent', () => {
  it('mints fresh ids outside a request context', () => {
    const tp = currentTraceParent()
    expect(tp.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(tp.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(tp.sampled).toBe(true)
  })

  it('reuses the trace id from the active request context', async () => {
    const ctx = makeRequestContext({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    })
    await runWithRequestContext(ctx, async () => {
      const tp = currentTraceParent()
      expect(tp.traceId).toBe('a'.repeat(32))
      // The span id is kept — callers derive children explicitly.
      expect(tp.spanId).toBe('b'.repeat(16))
    })
  })
})

describe('updateTraceFromHeaders', () => {
  it('stamps trace ids onto the active context from headers', async () => {
    await runWithRequestContext(makeRequestContext({}), async () => {
      const headers = new Headers({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      })
      const tp = updateTraceFromHeaders(headers)
      expect(tp.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      const after = currentTraceParent()
      expect(after.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(after.spanId).toBe('00f067aa0ba902b7')
    })
  })

  it('mints fresh ids when no traceparent header is present', async () => {
    await runWithRequestContext(makeRequestContext({}), async () => {
      const tp = updateTraceFromHeaders(new Headers())
      expect(tp.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(tp.spanId).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  it('accepts a plain object as well as a Headers instance', async () => {
    await runWithRequestContext(makeRequestContext({}), async () => {
      const tp = updateTraceFromHeaders({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-aaaaaaaaaaaaaaaa-01',
      })
      expect(tp.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(tp.spanId).toBe('aaaaaaaaaaaaaaaa')
    })
  })
})

describe('fetchWithTrace', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    __resetMetricsForTests()
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it('injects traceparent and x-request-id when present', async () => {
    const captured: Headers[] = []
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Headers(init?.headers))
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const ctx = makeRequestContext({
      requestId: 'req-123',
      traceId: 'c'.repeat(32),
      spanId: 'd'.repeat(16),
    })
    await runWithRequestContext(ctx, async () => {
      await fetchWithTrace('https://asaas.test/v3/ping', { serviceName: 'asaas' })
    })

    expect(captured).toHaveLength(1)
    const hdr = captured[0]
    expect(hdr.get('x-request-id')).toBe('req-123')
    const tp = parseTraceparent(hdr.get('traceparent'))
    expect(tp?.traceId).toBe('c'.repeat(32))
    // Child span id must be fresh — not reuse the parent's.
    expect(tp?.spanId).not.toBe('d'.repeat(16))
    expect(tp?.spanId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('records ok counter + duration histogram on success', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch

    await fetchWithTrace('https://asaas.test/ping', { method: 'GET', serviceName: 'asaas' })

    const snap = snapshotMetrics()
    const okCounter = snap.counters.find(
      (c) =>
        c.name === 'http_outbound_total' &&
        c.labels.service === 'asaas' &&
        c.labels.method === 'GET' &&
        c.labels.outcome === 'ok'
    )
    expect(okCounter?.value).toBe(1)
    const hist = snap.histograms.find(
      (h) =>
        h.name === 'http_outbound_duration_ms' &&
        h.labels.service === 'asaas' &&
        h.labels.status === '200'
    )
    expect(hist?.count).toBe(1)
  })

  it('buckets 4xx/5xx into error_4xx / error_5xx outcomes', async () => {
    const statuses = [404, 500]
    let call = 0
    global.fetch = vi.fn(
      async () => new Response(null, { status: statuses[call++] })
    ) as unknown as typeof fetch

    await fetchWithTrace('https://x.test/a', { serviceName: 'x', logFailures: false })
    await fetchWithTrace('https://x.test/b', { serviceName: 'x', logFailures: false })

    const snap = snapshotMetrics()
    const outcomes = snap.counters
      .filter((c) => c.name === 'http_outbound_total')
      .map((c) => c.labels.outcome)
    expect(outcomes).toContain('error_4xx')
    expect(outcomes).toContain('error_5xx')
  })

  it('classifies fetch abort as error_timeout', async () => {
    global.fetch = vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch

    await expect(
      fetchWithTrace('https://slow.test/', {
        serviceName: 'slow',
        timeoutMs: 1,
        logFailures: false,
      })
    ).rejects.toThrow()
    const snap = snapshotMetrics()
    const timeoutCounter = snap.counters.find(
      (c) => c.name === 'http_outbound_total' && c.labels.outcome === 'error_timeout'
    )
    expect(timeoutCounter?.value).toBe(1)
  })

  it('does not overwrite caller-supplied traceparent / x-request-id headers', async () => {
    let capturedHeaders: Headers | undefined
    global.fetch = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers)
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await fetchWithTrace('https://x.test/', {
      serviceName: 'x',
      headers: {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        'x-request-id': 'explicit-id',
      },
    })
    expect(capturedHeaders?.get('traceparent')).toBe(
      '00-11111111111111111111111111111111-2222222222222222-01'
    )
    expect(capturedHeaders?.get('x-request-id')).toBe('explicit-id')
  })
})
