import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { safeEqualString, safeEqualHex, verifyHmacSha256 } from '@/lib/security/hmac'

describe('safeEqualString', () => {
  it('returns true on matching strings', () => {
    expect(safeEqualString('secret-token', 'secret-token')).toBe(true)
  })

  it('returns false on mismatched strings of equal length', () => {
    expect(safeEqualString('secret-token', 'secret-zoken')).toBe(false)
  })

  it('returns false on mismatched lengths', () => {
    expect(safeEqualString('secret', 'secret-token')).toBe(false)
  })

  it('returns false for null / undefined / non-string', () => {
    expect(safeEqualString(null, 'foo')).toBe(false)
    expect(safeEqualString(undefined, 'foo')).toBe(false)
    // @ts-expect-error runtime check
    expect(safeEqualString(42, 'foo')).toBe(false)
  })

  it('returns false on empty strings (prevents treating unset secret as match)', () => {
    expect(safeEqualString('', '')).toBe(false)
    expect(safeEqualString('', 'foo')).toBe(false)
  })

  it('handles unicode safely', () => {
    expect(safeEqualString('caf\u00e9', 'caf\u00e9')).toBe(true)
    expect(safeEqualString('caf\u00e9', 'cafe\u0301')).toBe(false) // different code units
  })
})

describe('safeEqualHex', () => {
  it('matches two equal hex strings', () => {
    expect(safeEqualHex('deadbeef', 'deadbeef')).toBe(true)
    expect(safeEqualHex('DEADBEEF', 'deadbeef')).toBe(true)
  })

  it('rejects non-hex input', () => {
    expect(safeEqualHex('notvalid!', 'deadbeef')).toBe(false)
    expect(safeEqualHex('deadbeef', 'notvalid!')).toBe(false)
  })

  it('rejects mismatched lengths', () => {
    expect(safeEqualHex('dead', 'deadbeef')).toBe(false)
  })

  it('rejects null / empty', () => {
    expect(safeEqualHex(null, 'deadbeef')).toBe(false)
    expect(safeEqualHex('', '')).toBe(false)
  })
})

describe('verifyHmacSha256', () => {
  const secret = 'super-secret'
  const payload = '{"event":"sign","document":{"key":"abc"}}'
  const validHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

  it('accepts the correct signature with sha256= prefix', () => {
    expect(verifyHmacSha256(payload, `sha256=${validHex}`, secret)).toBe(true)
  })

  it('accepts the correct signature without prefix', () => {
    expect(verifyHmacSha256(payload, validHex, secret)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const wrong = '0'.repeat(validHex.length)
    expect(verifyHmacSha256(payload, wrong, secret)).toBe(false)
  })

  it('rejects a signature computed for a different payload', () => {
    const otherSig = createHmac('sha256', secret).update('different', 'utf8').digest('hex')
    expect(verifyHmacSha256(payload, otherSig, secret)).toBe(false)
  })

  it('rejects when the secret is missing', () => {
    expect(verifyHmacSha256(payload, validHex, null)).toBe(false)
    expect(verifyHmacSha256(payload, validHex, '')).toBe(false)
  })

  it('rejects when signature is missing / malformed', () => {
    expect(verifyHmacSha256(payload, null, secret)).toBe(false)
    expect(verifyHmacSha256(payload, '', secret)).toBe(false)
    expect(verifyHmacSha256(payload, 'sha256=', secret)).toBe(false)
    expect(verifyHmacSha256(payload, 'sha256=not-hex!', secret)).toBe(false)
  })
})
