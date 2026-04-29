import { describe, it, expect } from 'vitest'
import { SILENCEABLE_TYPES, CRITICAL_TYPES, type NotificationType } from '@/lib/notification-types'

// ── SILENCEABLE_TYPES ────────────────────────────────────────────────────────

describe('SILENCEABLE_TYPES', () => {
  it('contains exactly the expected silenceable types', () => {
    const expected: NotificationType[] = [
      'TRANSFER_REGISTERED',
      'CONSULTANT_TRANSFER',
      'PRODUCT_INTEREST',
      'REGISTRATION_REQUEST',
      'STALE_ORDER',
      'PRODUCT_AWAITING_PRICE',
    ]
    expect(SILENCEABLE_TYPES).toEqual(expect.arrayContaining(expected))
    expect(SILENCEABLE_TYPES.length).toBe(expected.length)
  })

  it('does not contain critical types', () => {
    for (const type of CRITICAL_TYPES) {
      expect(SILENCEABLE_TYPES).not.toContain(type)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(SILENCEABLE_TYPES).size).toBe(SILENCEABLE_TYPES.length)
  })
})

// ── CRITICAL_TYPES ───────────────────────────────────────────────────────────

describe('CRITICAL_TYPES', () => {
  it('contains the core order, payment and support types', () => {
    const expected: NotificationType[] = [
      'ORDER_CREATED',
      'ORDER_STATUS',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REMINDER',
      'DOCUMENT_UPLOADED',
      'SUPPORT_REPLY',
      'SUPPORT_RESOLVED',
    ]
    expect(CRITICAL_TYPES).toEqual(expect.arrayContaining(expected))
    expect(CRITICAL_TYPES.length).toBe(expected.length)
  })

  it('does not contain silenceable types', () => {
    for (const type of SILENCEABLE_TYPES) {
      expect(CRITICAL_TYPES).not.toContain(type)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(CRITICAL_TYPES).size).toBe(CRITICAL_TYPES.length)
  })
})

// ── Disjoint sets ────────────────────────────────────────────────────────────

describe('CRITICAL_TYPES and SILENCEABLE_TYPES are disjoint', () => {
  it('no type appears in both lists', () => {
    const criticalSet = new Set(CRITICAL_TYPES)
    const overlap = SILENCEABLE_TYPES.filter((t) => criticalSet.has(t))
    expect(overlap).toHaveLength(0)
  })

  it('STALE_ORDER is silenceable (not critical)', () => {
    expect(SILENCEABLE_TYPES).toContain('STALE_ORDER')
    expect(CRITICAL_TYPES).not.toContain('STALE_ORDER')
  })

  it('ORDER_CREATED is critical (not silenceable)', () => {
    expect(CRITICAL_TYPES).toContain('ORDER_CREATED')
    expect(SILENCEABLE_TYPES).not.toContain('ORDER_CREATED')
  })

  it('PAYMENT_CONFIRMED is critical (not silenceable)', () => {
    expect(CRITICAL_TYPES).toContain('PAYMENT_CONFIRMED')
    expect(SILENCEABLE_TYPES).not.toContain('PAYMENT_CONFIRMED')
  })
})

// ── Preference logic (unit-level, no DB) ─────────────────────────────────────

describe('Notification preference semantics', () => {
  function isEnabledByPrefs(type: NotificationType, prefs: Record<string, boolean>): boolean {
    if (CRITICAL_TYPES.includes(type)) return true
    if (!SILENCEABLE_TYPES.includes(type)) return true
    return prefs[type] !== false
  }

  it('critical type is always enabled regardless of prefs', () => {
    const prefs: Record<string, boolean> = { ORDER_CREATED: false }
    expect(isEnabledByPrefs('ORDER_CREATED', prefs)).toBe(true)
  })

  it('silenceable type is enabled when pref is missing', () => {
    expect(isEnabledByPrefs('STALE_ORDER', {})).toBe(true)
  })

  it('silenceable type is enabled when pref is true', () => {
    expect(isEnabledByPrefs('STALE_ORDER', { STALE_ORDER: true })).toBe(true)
  })

  it('silenceable type is disabled when pref is false', () => {
    expect(isEnabledByPrefs('STALE_ORDER', { STALE_ORDER: false })).toBe(false)
  })

  it('PRODUCT_INTEREST can be silenced', () => {
    expect(isEnabledByPrefs('PRODUCT_INTEREST', { PRODUCT_INTEREST: false })).toBe(false)
  })

  it('REGISTRATION_REQUEST can be silenced', () => {
    expect(isEnabledByPrefs('REGISTRATION_REQUEST', { REGISTRATION_REQUEST: false })).toBe(false)
  })

  it('GENERIC type is always enabled (not in either list)', () => {
    expect(isEnabledByPrefs('GENERIC', { GENERIC: false })).toBe(true)
  })

  it('ORDER_STATUS cannot be silenced', () => {
    expect(isEnabledByPrefs('ORDER_STATUS', { ORDER_STATUS: false })).toBe(true)
  })

  it('DOCUMENT_UPLOADED cannot be silenced', () => {
    expect(isEnabledByPrefs('DOCUMENT_UPLOADED', { DOCUMENT_UPLOADED: false })).toBe(true)
  })
})
