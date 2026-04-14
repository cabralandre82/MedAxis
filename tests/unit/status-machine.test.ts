import { describe, it, expect } from 'vitest'
import { isValidTransition, getAllowedTransitions } from '@/lib/orders/status-machine'

describe('isValidTransition — admin', () => {
  it('allows AWAITING_DOCUMENTS → READY_FOR_REVIEW', () => {
    expect(isValidTransition('AWAITING_DOCUMENTS', 'READY_FOR_REVIEW', 'admin')).toBe(true)
  })

  it('allows PAYMENT_CONFIRMED → COMMISSION_CALCULATED', () => {
    expect(isValidTransition('PAYMENT_CONFIRMED', 'COMMISSION_CALCULATED', 'admin')).toBe(true)
  })

  it('blocks COMPLETED → any status (terminal)', () => {
    expect(isValidTransition('COMPLETED', 'CANCELED', 'admin')).toBe(false)
    expect(isValidTransition('COMPLETED', 'DRAFT', 'admin')).toBe(false)
  })

  it('blocks CANCELED → any status (terminal)', () => {
    expect(isValidTransition('CANCELED', 'DRAFT', 'admin')).toBe(false)
  })

  it('blocks skipping steps (DRAFT → PAYMENT_CONFIRMED)', () => {
    expect(isValidTransition('DRAFT', 'PAYMENT_CONFIRMED', 'admin')).toBe(false)
  })

  it('allows admin to cancel from early stages', () => {
    expect(isValidTransition('AWAITING_DOCUMENTS', 'CANCELED', 'admin')).toBe(true)
    expect(isValidTransition('AWAITING_PAYMENT', 'CANCELED', 'admin')).toBe(true)
  })

  it('allows admin to cancel from execution stages (RECEIVED_BY_PHARMACY through DELIVERED)', () => {
    expect(isValidTransition('RECEIVED_BY_PHARMACY', 'CANCELED', 'admin')).toBe(true)
    expect(isValidTransition('IN_EXECUTION', 'CANCELED', 'admin')).toBe(true)
    expect(isValidTransition('READY', 'CANCELED', 'admin')).toBe(true)
    expect(isValidTransition('SHIPPED', 'CANCELED', 'admin')).toBe(true)
    expect(isValidTransition('DELIVERED', 'CANCELED', 'admin')).toBe(true)
  })

  it('blocks admin from canceling already terminal orders', () => {
    expect(isValidTransition('COMPLETED', 'CANCELED', 'admin')).toBe(false)
    expect(isValidTransition('CANCELED', 'CANCELED', 'admin')).toBe(false)
  })
})

describe('isValidTransition — pharmacy', () => {
  it('allows RELEASED_FOR_EXECUTION → RECEIVED_BY_PHARMACY', () => {
    expect(isValidTransition('RELEASED_FOR_EXECUTION', 'RECEIVED_BY_PHARMACY', 'pharmacy')).toBe(
      true
    )
  })

  it('allows IN_EXECUTION → READY', () => {
    expect(isValidTransition('IN_EXECUTION', 'READY', 'pharmacy')).toBe(true)
  })

  it('blocks pharmacy from advancing financial steps', () => {
    expect(isValidTransition('AWAITING_PAYMENT', 'PAYMENT_CONFIRMED', 'pharmacy')).toBe(false)
    expect(isValidTransition('PAYMENT_CONFIRMED', 'COMMISSION_CALCULATED', 'pharmacy')).toBe(false)
  })

  it('blocks pharmacy from canceling orders', () => {
    expect(isValidTransition('IN_EXECUTION', 'CANCELED', 'pharmacy')).toBe(false)
  })

  it('blocks pharmacy from early stages', () => {
    expect(isValidTransition('DRAFT', 'AWAITING_DOCUMENTS', 'pharmacy')).toBe(false)
    expect(isValidTransition('AWAITING_DOCUMENTS', 'READY_FOR_REVIEW', 'pharmacy')).toBe(false)
  })
})

describe('getAllowedTransitions', () => {
  it('returns empty array for terminal statuses', () => {
    expect(getAllowedTransitions('COMPLETED', 'admin')).toEqual([])
    expect(getAllowedTransitions('CANCELED', 'admin')).toEqual([])
  })

  it('returns correct transitions for IN_EXECUTION pharmacy', () => {
    const transitions = getAllowedTransitions('IN_EXECUTION', 'pharmacy')
    expect(transitions).toContain('READY')
    expect(transitions).toContain('WITH_ISSUE')
    expect(transitions).not.toContain('CANCELED')
  })
})
