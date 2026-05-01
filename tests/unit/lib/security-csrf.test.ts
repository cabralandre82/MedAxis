import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import {
  checkCsrf,
  verifyDoubleSubmit,
  issueCsrfToken,
  ensureCsrfCookie,
  CSRF_COOKIE,
  CSRF_COOKIE_DEV,
  CSRF_HEADER,
} from '@/lib/security/csrf'

function makeReq(
  url: string,
  init: {
    method?: string
    origin?: string | null
    referer?: string | null
    cookies?: Record<string, string>
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const headers = new Headers(init.headers ?? {})
  if (init.origin !== undefined && init.origin !== null) headers.set('origin', init.origin)
  if (init.referer !== undefined && init.referer !== null) headers.set('referer', init.referer)
  const cookiePairs = Object.entries(init.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookiePairs) headers.set('cookie', cookiePairs)
  return new NextRequest(url, { method: init.method ?? 'POST', headers })
}

describe('checkCsrf — safe methods', () => {
  it('allows GET / HEAD / OPTIONS unconditionally', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const req = makeReq('https://app.example.com/api/orders', { method })
      expect(checkCsrf(req).ok).toBe(true)
    }
  })
})

describe('checkCsrf — exempt paths', () => {
  const cases = [
    '/api/payments/asaas/webhook',
    '/api/contracts/webhook',
    '/api/notifications/zenvia',
    '/api/inngest/foo',
    '/api/cron/scheduler',
    '/api/tracking',
    '/api/health',
    '/api/csp-report',
    // Wave 12: backup ledger ingest. Server-to-server from GitHub
    // Actions runners — no shared cookie origin, auth via Bearer.
    '/api/backups/record',
  ]
  it.each(cases)('allows POST to %s without Origin', (p) => {
    const req = makeReq(`https://app.example.com${p}`, { method: 'POST' })
    expect(checkCsrf(req).ok).toBe(true)
  })
})

describe('checkCsrf — non-API paths', () => {
  it('allows non-/api POSTs (Server Actions handled by Next itself)', () => {
    const req = makeReq('https://app.example.com/orders', { method: 'POST' })
    expect(checkCsrf(req).ok).toBe(true)
  })
})

describe('checkCsrf — Origin check', () => {
  it('allows when Origin matches the request origin', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://app.example.com',
    })
    expect(checkCsrf(req).ok).toBe(true)
  })

  it('allows when only Referer present and it matches', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      referer: 'https://app.example.com/orders',
    })
    expect(checkCsrf(req).ok).toBe(true)
  })

  it('denies when Origin mismatches', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://evil.com',
    })
    const d = checkCsrf(req)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('origin_mismatch')
  })

  it('denies when Origin and Referer are both missing', () => {
    const req = makeReq('https://app.example.com/api/orders', { method: 'POST' })
    const d = checkCsrf(req)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('origin_missing')
  })

  it('honours ALLOWED_ORIGINS extras', () => {
    const prev = process.env.ALLOWED_ORIGINS
    process.env.ALLOWED_ORIGINS = 'https://preview.example.com, https://trusted.example.com'
    try {
      const req = makeReq('https://app.example.com/api/orders', {
        method: 'POST',
        origin: 'https://trusted.example.com',
      })
      expect(checkCsrf(req).ok).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGINS
      else process.env.ALLOWED_ORIGINS = prev
    }
  })
})

describe('checkCsrf — double-submit enforcement', () => {
  it('requires token on top of origin when enforceDoubleSubmit=true', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://app.example.com',
    })
    const d = checkCsrf(req, { enforceDoubleSubmit: true })
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('token_missing')
  })

  it('passes when cookie == header', () => {
    const token = 'a'.repeat(64)
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://app.example.com',
      cookies: { [CSRF_COOKIE]: token },
      headers: { [CSRF_HEADER]: token },
    })
    const d = checkCsrf(req, { enforceDoubleSubmit: true })
    expect(d.ok).toBe(true)
  })

  it('rejects when cookie != header', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://app.example.com',
      cookies: { [CSRF_COOKIE]: 'a'.repeat(64) },
      headers: { [CSRF_HEADER]: 'b'.repeat(64) },
    })
    const d = checkCsrf(req, { enforceDoubleSubmit: true })
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('token_mismatch')
  })

  it('rejects on length mismatch (constant-time impossible)', () => {
    const req = makeReq('https://app.example.com/api/orders', {
      method: 'POST',
      origin: 'https://app.example.com',
      cookies: { [CSRF_COOKIE]: 'a'.repeat(32) },
      headers: { [CSRF_HEADER]: 'a'.repeat(64) },
    })
    const d = checkCsrf(req, { enforceDoubleSubmit: true })
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('token_mismatch')
  })

  it('falls back to the dev cookie name when running on http://', () => {
    const token = 'c'.repeat(64)
    const req = makeReq('http://localhost:3000/api/orders', {
      method: 'POST',
      origin: 'http://localhost:3000',
      cookies: { [CSRF_COOKIE_DEV]: token },
      headers: { [CSRF_HEADER]: token },
    })
    expect(verifyDoubleSubmit(req).ok).toBe(true)
  })
})

describe('issueCsrfToken', () => {
  it('returns 64 hex chars (256 bits)', () => {
    const t = issueCsrfToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces distinct values across calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(issueCsrfToken())
    expect(seen.size).toBe(50)
  })
})

describe('ensureCsrfCookie', () => {
  it('keeps an existing valid cookie', () => {
    const existing = '9'.repeat(64)
    const req = makeReq('https://app.example.com/', {
      method: 'GET',
      cookies: { [CSRF_COOKIE]: existing },
    })
    // minimal response stub
    const res = {
      cookies: {
        _set: null as unknown,
        set(name: string, value: string, options: Record<string, unknown>) {
          this._set = { name, value, options }
        },
      },
    }
    const out = ensureCsrfCookie(req, res as never)
    expect(out).toBe(existing)
    // @ts-expect-error stub
    expect(res.cookies._set).toBeNull()
  })

  it('mints a new cookie when none exists', () => {
    const req = makeReq('https://app.example.com/', { method: 'GET' })
    const captured: { name?: string; value?: string; options?: Record<string, unknown> } = {}
    const res = {
      cookies: {
        set(name: string, value: string, options: Record<string, unknown>) {
          captured.name = name
          captured.value = value
          captured.options = options
        },
      },
    }
    const out = ensureCsrfCookie(req, res as never)
    expect(out).toMatch(/^[0-9a-f]{64}$/)
    expect(captured.name).toBe(CSRF_COOKIE)
    expect(captured.options?.secure).toBe(true)
    expect(captured.options?.sameSite).toBe('strict')
    expect(captured.options?.httpOnly).toBe(false)
    expect(captured.options?.path).toBe('/')
  })

  it('uses the dev cookie name (and Secure=false) on http:// origins', () => {
    const req = makeReq('http://localhost:3000/', { method: 'GET' })
    const captured: { name?: string; options?: Record<string, unknown> } = {}
    const res = {
      cookies: {
        set(name: string, _value: string, options: Record<string, unknown>) {
          captured.name = name
          captured.options = options
        },
      },
    }
    ensureCsrfCookie(req, res as never)
    expect(captured.name).toBe(CSRF_COOKIE_DEV)
    expect(captured.options?.secure).toBe(false)
  })
})
