import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

describe('GET /api/metrics', () => {
  beforeEach(async () => {
    vi.resetModules()
    // Reset using the same module instance the route will load.
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function loadRoute() {
    return (await import('@/app/api/metrics/route')).GET
  }
  async function bumpCounter(name: string, labels?: Record<string, string>) {
    const { incCounter } = await import('@/lib/metrics')
    incCounter(name, labels)
  }

  it('returns 500 when METRICS_SECRET is missing in production-like env', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', '')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics')
    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('metrics_not_configured')
  })

  it('returns 401 when secret is configured but token is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'super-secret-token')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 on token mismatch even if lengths match', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'aaaaaaaaaaaa')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics', {
      headers: { authorization: 'Bearer bbbbbbbbbbbb' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('accepts Bearer token and returns Prometheus text', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'super-secret-token')
    await bumpCounter('test_metric_total')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics', {
      headers: { authorization: 'Bearer super-secret-token' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()
    expect(body).toContain('test_metric_total 1')
  })

  it('accepts ?token query parameter', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'super-secret-token')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics?token=super-secret-token')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('returns JSON when ?format=json', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'super-secret-token')
    await bumpCounter('test_metric_total', { label: 'a' })
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics?format=json&token=super-secret-token')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { counters: unknown[] }
    expect(Array.isArray(body.counters)).toBe(true)
  })

  it('is open in development when METRICS_SECRET is unset', async () => {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('METRICS_SECRET', '')
    const GET = await loadRoute()
    const req = new NextRequest('https://app.test/api/metrics')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('counts unauthorized attempts into metrics_scrape_total', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('METRICS_SECRET', 'abc')
    const GET = await loadRoute()
    await GET(new NextRequest('https://app.test/api/metrics'))
    // Second request is authorized so we can scrape JSON and inspect
    const res = await GET(new NextRequest('https://app.test/api/metrics?format=json&token=abc'))
    const body = (await res.json()) as {
      counters: Array<{ name: string; labels: Record<string, string>; value: number }>
    }
    const unauthorized = body.counters.find(
      (c) => c.name === 'metrics_scrape_total' && c.labels.outcome === 'unauthorized'
    )
    expect(unauthorized?.value).toBe(1)
  })
})
