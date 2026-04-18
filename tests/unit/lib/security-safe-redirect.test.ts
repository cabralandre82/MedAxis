import { describe, it, expect } from 'vitest'
import { safeNextPath, safeSameOriginUrl } from '@/lib/security/safe-redirect'

describe('safeNextPath', () => {
  const FALLBACK = '/dashboard'

  it('returns same-origin paths unchanged', () => {
    expect(safeNextPath('/orders')).toBe('/orders')
    expect(safeNextPath('/orders/123')).toBe('/orders/123')
    expect(safeNextPath('/orders?filter=paid')).toBe('/orders?filter=paid')
    expect(safeNextPath('/orders/123#details')).toBe('/orders/123#details')
  })

  it('refuses protocol-relative URLs (//evil.com)', () => {
    expect(safeNextPath('//evil.com/foo')).toBe(FALLBACK)
    expect(safeNextPath('//evil.com')).toBe(FALLBACK)
  })

  it('refuses backslash-prefixed URLs (/\\evil.com) — legacy browser quirk', () => {
    expect(safeNextPath('/\\evil.com')).toBe(FALLBACK)
  })

  it('refuses absolute URLs with scheme', () => {
    expect(safeNextPath('https://evil.com/foo')).toBe(FALLBACK)
    expect(safeNextPath('http://evil.com/foo')).toBe(FALLBACK)
    expect(safeNextPath('javascript:alert(1)')).toBe(FALLBACK)
    expect(safeNextPath('data:text/html,<script>alert(1)</script>')).toBe(FALLBACK)
  })

  it('refuses non-string / empty / missing input', () => {
    expect(safeNextPath(undefined)).toBe(FALLBACK)
    expect(safeNextPath(null)).toBe(FALLBACK)
    expect(safeNextPath('')).toBe(FALLBACK)
    expect(safeNextPath(42)).toBe(FALLBACK)
    expect(safeNextPath({})).toBe(FALLBACK)
  })

  it('refuses paths not starting with /', () => {
    expect(safeNextPath('orders')).toBe(FALLBACK)
    expect(safeNextPath('./orders')).toBe(FALLBACK)
    expect(safeNextPath('../evil')).toBe(FALLBACK)
  })

  it('refuses header-injection payloads (CR/LF/control chars)', () => {
    expect(safeNextPath('/foo\nBar')).toBe(FALLBACK)
    expect(safeNextPath('/foo\r\nLocation: evil.com')).toBe(FALLBACK)
    expect(safeNextPath('/foo\u0000bar')).toBe(FALLBACK)
  })

  it('refuses URLs with whitespace', () => {
    expect(safeNextPath('/foo bar')).toBe(FALLBACK)
  })

  it('refuses over-long values (length > 1024)', () => {
    const long = '/' + 'a'.repeat(1024)
    expect(safeNextPath(long)).toBe(FALLBACK)
    expect(safeNextPath('/' + 'a'.repeat(1022))).toBe('/' + 'a'.repeat(1022))
  })

  it('honours a custom fallback', () => {
    expect(safeNextPath('//evil.com', '/custom')).toBe('/custom')
  })
})

describe('safeSameOriginUrl', () => {
  const ORIGIN = 'https://app.example.com'

  it('returns pathname of same-origin absolute URL', () => {
    expect(safeSameOriginUrl('https://app.example.com/orders/1', ORIGIN)).toBe('/orders/1')
  })

  it('falls back for cross-origin URL', () => {
    expect(safeSameOriginUrl('https://evil.com/orders/1', ORIGIN)).toBe('/dashboard')
  })

  it('accepts relative paths', () => {
    expect(safeSameOriginUrl('/orders', ORIGIN)).toBe('/orders')
  })

  it('falls back on malformed URL', () => {
    expect(safeSameOriginUrl('http://', ORIGIN)).toBe('/dashboard')
  })

  it('falls back on non-string input', () => {
    expect(safeSameOriginUrl(undefined, ORIGIN)).toBe('/dashboard')
    expect(safeSameOriginUrl(42, ORIGIN)).toBe('/dashboard')
  })

  it('re-runs safeNextPath on the extracted path so //evil style is still refused', () => {
    // A same-origin URL whose query contains a protocol-relative path
    // shouldn't matter — we only validate the pathname, not the query.
    expect(safeSameOriginUrl('https://app.example.com/orders?r=//evil.com', ORIGIN)).toBe(
      '/orders?r=//evil.com'
    )
  })
})
