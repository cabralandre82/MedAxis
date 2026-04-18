/**
 * HMAC verification primitives — Wave 5.
 *
 * Centralises constant-time comparison so vendor-specific webhook
 * routes don't each reinvent the wheel (and miss `timingSafeEqual`).
 * Clicksign already uses this pattern directly; Asaas uses a static
 * access token rather than a signature, which we harden here with
 * `safeEqualString`.
 *
 * @module lib/security/hmac
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time comparison of two UTF-8 strings. Returns `false` on
 * length mismatch (length itself is a side channel we accept as
 * unavoidable — the alternative is padding to fixed length which
 * requires more infrastructure).
 *
 * Use this whenever comparing a user-supplied secret (webhook access
 * token, API key) to the expected value.
 */
export function safeEqualString(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  if (a.length === 0) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Constant-time comparison of two hex-encoded digests (e.g. HMAC hex
 * output). Decodes both sides first so invalid hex is rejected deterministically.
 */
export function safeEqualHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  if (a.length === 0) return false

  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Verify an HMAC signature: compute expected = HMAC(secret, payload),
 * then constant-time-compare with the provided signature.
 *
 * Accepts both `sha256=<hex>` and raw `<hex>` inputs — the former is
 * the convention adopted by GitHub, Stripe, and Clicksign.
 */
export function verifyHmacSha256(
  payload: string,
  receivedSignature: string | null | undefined,
  secret: string | null | undefined
): boolean {
  if (!secret || !receivedSignature) return false
  const receivedHex = receivedSignature.replace(/^sha256=/, '').trim()
  if (!receivedHex) return false
  const expectedHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  return safeEqualHex(receivedHex, expectedHex)
}
