import { describe, it, expect } from 'vitest'
import {
  buildCsp,
  buildReportToHeader,
  cspHeaderName,
  generateNonce,
  NONCE_HEADER,
} from '@/lib/security/csp'

describe('lib/security/csp — buildCsp', () => {
  const validNonce = 'a'.repeat(22)

  it('throws on missing or short nonce', () => {
    // @ts-expect-error -- exercising runtime guard
    expect(() => buildCsp({})).toThrow(/nonce is required/)
    expect(() => buildCsp({ nonce: '' })).toThrow(/nonce is required/)
    expect(() => buildCsp({ nonce: 'short' })).toThrow(/invalid characters/)
  })

  it('embeds the nonce in script-src and style-src-elem', () => {
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).toContain(`'nonce-${validNonce}'`)
    // Both script and style-src-elem should reference it.
    const scriptDir = csp.split(';').find((d) => d.trim().startsWith('script-src '))!
    const styleElem = csp.split(';').find((d) => d.trim().startsWith('style-src-elem '))!
    expect(scriptDir).toContain(`'nonce-${validNonce}'`)
    expect(styleElem).toContain(`'nonce-${validNonce}'`)
  })

  it('includes strict-dynamic and the https/http fallback for script-src', () => {
    const csp = buildCsp({ nonce: validNonce })
    const scriptDir = csp.split(';').find((d) => d.trim().startsWith('script-src '))!
    expect(scriptDir).toContain("'strict-dynamic'")
    expect(scriptDir).toContain('https:')
    expect(scriptDir).toContain('http:')
  })

  it('does NOT include unsafe-inline in script-src', () => {
    const csp = buildCsp({ nonce: validNonce })
    const scriptDir = csp.split(';').find((d) => d.trim().startsWith('script-src '))!
    expect(scriptDir).not.toContain("'unsafe-inline'")
  })

  it('does NOT include unsafe-eval in script-src by default', () => {
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('includes unsafe-eval only when allowEval is true', () => {
    const csp = buildCsp({ nonce: validNonce, allowEval: true })
    const scriptDir = csp.split(';').find((d) => d.trim().startsWith('script-src '))!
    expect(scriptDir).toContain("'unsafe-eval'")
  })

  it('keeps unsafe-inline only on style-src-attr (React style attribute)', () => {
    const csp = buildCsp({ nonce: validNonce })
    const styleAttr = csp.split(';').find((d) => d.trim().startsWith('style-src-attr '))!
    expect(styleAttr).toContain("'unsafe-inline'")
    // script-src-attr must be 'none' — no inline event handlers allowed.
    expect(csp).toContain("script-src-attr 'none'")
  })

  it('declares both report-uri and report-to', () => {
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).toContain('report-uri /api/csp-report')
    expect(csp).toContain('report-to csp-endpoint')
  })

  it('honours a custom report endpoint', () => {
    const csp = buildCsp({ nonce: validNonce, reportEndpoint: '/api/v2/csp' })
    expect(csp).toContain('report-uri /api/v2/csp')
  })

  it('appends extraConnectSrc origins to connect-src', () => {
    const csp = buildCsp({
      nonce: validNonce,
      extraConnectSrc: ['https://oncall.example.com'],
    })
    const conn = csp.split(';').find((d) => d.trim().startsWith('connect-src '))!
    expect(conn).toContain('https://oncall.example.com')
    expect(conn).toContain('https://*.supabase.co')
  })

  it('locks down framing, base-uri, form-action, object-src', () => {
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('preserves img-src, font-src, worker-src and manifest-src minimums', () => {
    const csp = buildCsp({ nonce: validNonce })
    expect(csp).toMatch(/img-src 'self' data: blob:/)
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain("worker-src 'self' blob:")
    expect(csp).toContain("manifest-src 'self'")
  })

  it('every directive is separated by "; " and has no empty segments', () => {
    const csp = buildCsp({ nonce: validNonce })
    const parts = csp.split(';').map((p) => p.trim())
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0)
    }
  })
})

describe('lib/security/csp — cspHeaderName', () => {
  it('returns enforce header by default', () => {
    expect(cspHeaderName(false)).toBe('Content-Security-Policy')
  })

  it('returns report-only header when requested', () => {
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only')
  })
})

describe('lib/security/csp — buildReportToHeader', () => {
  it('produces a JSON object with the expected group and endpoint', () => {
    const raw = buildReportToHeader()
    const parsed = JSON.parse(raw)
    expect(parsed.group).toBe('csp-endpoint')
    expect(Array.isArray(parsed.endpoints)).toBe(true)
    expect(parsed.endpoints[0].url).toBe('/api/csp-report')
    expect(parsed.max_age).toBeGreaterThan(0)
  })

  it('honours a custom endpoint', () => {
    const parsed = JSON.parse(buildReportToHeader('/api/v2/csp'))
    expect(parsed.endpoints[0].url).toBe('/api/v2/csp')
  })
})

describe('lib/security/csp — generateNonce', () => {
  it('produces a non-empty string of base64url chars, length ≥ 16', () => {
    const n = generateNonce()
    expect(n.length).toBeGreaterThanOrEqual(16)
    expect(n).toMatch(/^[A-Za-z0-9+/_=-]+$/)
  })

  it('returns a fresh value on every call', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(generateNonce())
    // 200 random nonces should never collide; fail if even one duplicate.
    expect(seen.size).toBe(200)
  })

  it('returned values are valid as buildCsp inputs', () => {
    for (let i = 0; i < 10; i++) {
      const n = generateNonce()
      expect(() => buildCsp({ nonce: n })).not.toThrow()
    }
  })
})

describe('lib/security/csp — NONCE_HEADER constant', () => {
  it('is the lowercase x-nonce header expected by Next.js', () => {
    expect(NONCE_HEADER).toBe('x-nonce')
  })
})
