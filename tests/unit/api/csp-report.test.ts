import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

describe('POST /api/csp-report — parser', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('parses a legacy report-uri payload', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.test/dashboard',
        'violated-directive': "script-src 'self'",
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/steal.js',
        'original-policy': "default-src 'self'",
        disposition: 'enforce',
        'status-code': 200,
      },
    })
    const reports = parseReports(body)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.directive).toBe('script-src')
    expect(reports[0]?.blockedHost).toBe('evil.example.com')
    expect(reports[0]?.format).toBe('legacy')
  })

  it('parses a Reporting API array payload', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    const body = JSON.stringify([
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://app.test/orders',
          effectiveDirective: 'script-src-elem',
          violatedDirective: "script-src-elem 'self'",
          blockedURL: 'inline',
          disposition: 'report',
          sourceFile: 'https://app.test/_next/static/chunks/app.js',
          lineNumber: 42,
          columnNumber: 10,
          sample: "alert('xss')",
        },
      },
    ])
    const reports = parseReports(body)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.directive).toBe('script-src-elem')
    expect(reports[0]?.blockedHost).toBe('inline')
    expect(reports[0]?.format).toBe('reporting-api')
    expect(reports[0]?.scriptSample).toBe("alert('xss')")
  })

  it('drops entries with the wrong type in a Reporting API array', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    const body = JSON.stringify([
      { type: 'network-error', body: {} },
      {
        type: 'csp-violation',
        body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example.com/x.png' },
      },
    ])
    const reports = parseReports(body)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.directive).toBe('img-src')
  })

  it('returns empty list and bumps invalid counter on JSON parse error', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    const { snapshotMetrics } = await import('@/lib/metrics')
    expect(parseReports('not-json')).toEqual([])
    const snap = snapshotMetrics()
    const invalid = snap.counters.find(
      (c) => c.name === 'csp_report_invalid_total' && c.labels.reason === 'json_parse'
    )
    expect(invalid?.value).toBeGreaterThanOrEqual(1)
  })

  it('returns empty list on unknown shape', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    expect(parseReports(JSON.stringify({ foo: 'bar' }))).toEqual([])
  })

  it('truncates oversize script-sample to 256 chars', async () => {
    const { parseReports } = await import('@/app/api/csp-report/route')
    const huge = 'x'.repeat(5000)
    const body = JSON.stringify({
      'csp-report': {
        'effective-directive': 'script-src',
        'blocked-uri': 'inline',
        'script-sample': huge,
        'document-uri': 'https://app.test',
      },
    })
    const [r] = parseReports(body)
    expect(r?.scriptSample?.length).toBe(256)
  })
})

describe('POST /api/csp-report — handler', () => {
  beforeEach(async () => {
    vi.resetModules()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function load() {
    return await import('@/app/api/csp-report/route')
  }

  it('returns 204 even on empty body', async () => {
    const { POST } = await load()
    const req = new NextRequest('https://app.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: '',
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
  })

  it('returns 204 and increments csp_violation_total on a valid report', async () => {
    const { POST } = await load()
    const { snapshotMetrics } = await import('@/lib/metrics')
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.test/x',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://attacker.example/x.js',
      },
    })
    const req = new NextRequest('https://app.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
    const snap = snapshotMetrics()
    const counter = snap.counters.find(
      (c) =>
        c.name === 'csp_violation_total' &&
        c.labels.directive === 'script-src' &&
        c.labels.blocked_host === 'attacker.example'
    )
    expect(counter?.value).toBeGreaterThanOrEqual(1)
  })

  it('returns 204 and bumps invalid counter when content-length exceeds cap', async () => {
    const { POST } = await load()
    const { snapshotMetrics } = await import('@/lib/metrics')
    const req = new NextRequest('https://app.test/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
        'content-length': String(1024 * 1024),
      },
      body: '',
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
    const snap = snapshotMetrics()
    const invalid = snap.counters.find(
      (c) => c.name === 'csp_report_invalid_total' && c.labels.reason === 'body_too_large'
    )
    expect(invalid?.value).toBeGreaterThanOrEqual(1)
  })

  it('responds 204 to OPTIONS preflight', async () => {
    const { OPTIONS } = await load()
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Allow')).toContain('POST')
  })
})
