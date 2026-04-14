import { describe, it, expect } from 'vitest'
import { resolveDoctorFieldState, parseCartParam } from '@/lib/orders/doctor-field-rules'

const doctor = { id: 'd1', full_name: 'Dr. Silva', crm: '12345', crm_state: 'SP' }

const noRx = { requires_prescription: false }
const withRx = { requires_prescription: true }

describe('resolveDoctorFieldState', () => {
  it('hides field and not blocked when clinic has no doctors and cart has no Rx products', () => {
    expect(resolveDoctorFieldState([], [])).toEqual({
      show: false,
      required: false,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx], [])).toEqual({
      show: false,
      required: false,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx, noRx], [])).toEqual({
      show: false,
      required: false,
      blocked: false,
    })
  })

  it('blocks order when clinic has no doctors but cart has a prescription product', () => {
    expect(resolveDoctorFieldState([withRx], [])).toEqual({
      show: false,
      required: false,
      blocked: true,
    })
    expect(resolveDoctorFieldState([noRx, withRx], [])).toEqual({
      show: false,
      required: false,
      blocked: true,
    })
  })

  it('shows field as optional when clinic has doctors but no prescription product', () => {
    expect(resolveDoctorFieldState([], [doctor])).toEqual({
      show: true,
      required: false,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx], [doctor])).toEqual({
      show: true,
      required: false,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx, noRx], [doctor])).toEqual({
      show: true,
      required: false,
      blocked: false,
    })
  })

  it('shows field as required when at least one product requires prescription', () => {
    expect(resolveDoctorFieldState([withRx], [doctor])).toEqual({
      show: true,
      required: true,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx, withRx], [doctor])).toEqual({
      show: true,
      required: true,
      blocked: false,
    })
    expect(resolveDoctorFieldState([withRx, withRx], [doctor])).toEqual({
      show: true,
      required: true,
      blocked: false,
    })
  })

  it('works with multiple linked doctors', () => {
    const doctors = [doctor, { ...doctor, id: 'd2' }]
    expect(resolveDoctorFieldState([withRx], doctors)).toEqual({
      show: true,
      required: true,
      blocked: false,
    })
    expect(resolveDoctorFieldState([noRx], doctors)).toEqual({
      show: true,
      required: false,
      blocked: false,
    })
  })
})

describe('parseCartParam', () => {
  it('returns empty array for undefined', () => {
    expect(parseCartParam(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseCartParam('')).toEqual([])
  })

  it('parses single product', () => {
    expect(parseCartParam('abc-123:2')).toEqual([{ productId: 'abc-123', quantity: 2 }])
  })

  it('parses multiple products', () => {
    expect(parseCartParam('id-1:1,id-2:3')).toEqual([
      { productId: 'id-1', quantity: 1 },
      { productId: 'id-2', quantity: 3 },
    ])
  })

  it('drops entries with zero or invalid quantity', () => {
    expect(parseCartParam('id-1:0,id-2:abc,id-3:2')).toEqual([{ productId: 'id-3', quantity: 2 }])
  })

  it('drops entry when quantity is missing (empty after colon)', () => {
    expect(parseCartParam('id-1:')).toEqual([])
  })

  it('drops entries with empty productId', () => {
    expect(parseCartParam(':2,id-1:1')).toEqual([{ productId: 'id-1', quantity: 1 }])
  })
})
