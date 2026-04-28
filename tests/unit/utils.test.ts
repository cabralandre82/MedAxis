import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  generateOrderCode,
  formatCNPJ,
  slugify,
  getInitials,
  truncate,
  formatDate,
  formatDateTime,
} from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats BRL correctly', () => {
    const result = formatCurrency(1000)
    expect(result).toContain('1.000')
    expect(result).toContain('R$')
  })

  it('formats zero', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
  })

  it('formats decimal values', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1.234')
    expect(result).toContain('56')
  })
})

describe('generateOrderCode', () => {
  it('generates correct CP- format', () => {
    const code = generateOrderCode(2026, 1)
    expect(code).toBe('CP-2026-000001')
  })

  it('pads sequence with zeros', () => {
    const code = generateOrderCode(2026, 42)
    expect(code).toBe('CP-2026-000042')
  })

  it('handles large sequences', () => {
    const code = generateOrderCode(2026, 999999)
    expect(code).toBe('CP-2026-999999')
  })
})

describe('formatCNPJ', () => {
  it('formats 14-digit CNPJ', () => {
    const result = formatCNPJ('12345678000101')
    expect(result).toBe('12.345.678/0001-01')
  })

  it('passes through already-formatted CNPJ', () => {
    const result = formatCNPJ('12.345.678/0001-01')
    expect(result).toBe('12.345.678/0001-01')
  })
})

describe('slugify', () => {
  it('converts to lowercase slug', () => {
    expect(slugify('Testosterona Cipionato')).toBe('testosterona-cipionato')
  })

  it('removes accents', () => {
    expect(slugify('Hormônios & Saúde')).toBe('hormonios-saude')
  })

  it('handles multiple spaces', () => {
    expect(slugify('Produto   Teste')).toBe('produto-teste')
  })
})

describe('getInitials', () => {
  it('gets initials from full name', () => {
    expect(getInitials('Carlos Silva')).toBe('CS')
  })

  it('handles single name', () => {
    expect(getInitials('Carlos')).toBe('C')
  })

  it('only uses first 2 parts', () => {
    expect(getInitials('Carlos Eduardo Silva')).toBe('CE')
  })
})

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long strings', () => {
    const result = truncate('hello world', 5)
    expect(result).toBe('hello...')
  })
})

/**
 * SSR / hydration regression guard.
 *
 * Prior to 2026-04-28 these used `date-fns/format` which reads
 * `Date.prototype.getHours` — environment-local. Server-side (Vercel
 * runs UTC) and client (BRT/UTC-3) produced different strings,
 * triggering React hydration mismatches on `/orders/[id]`. Sentry id:
 * 2bd8f447e9274b5bbbd9676e00efeea4.
 *
 * The replacement uses `Intl.DateTimeFormat` with an explicit
 * `timeZone: 'America/Sao_Paulo'` so the rendered value is fully
 * deterministic regardless of where the code runs.
 *
 * If a future PR reverts to date-fns or drops the timezone, this test
 * will fail in any non-BRT runtime (CI in UTC qualifies).
 */
describe('formatDate / formatDateTime — timezone-pinned (BR)', () => {
  // 13:30 UTC === 10:30 BRT-3 — the gap that broke hydration.
  const ISO = '2026-04-28T13:30:00.000Z'

  it('formatDate: dd/MM/yyyy in São Paulo TZ', () => {
    expect(formatDate(ISO)).toBe('28/04/2026')
  })

  it('formatDateTime: dd/MM/yyyy às HH:mm in São Paulo TZ', () => {
    // 13:30 UTC -> 10:30 in São Paulo (UTC-3, no DST since 2019)
    expect(formatDateTime(ISO)).toBe('28/04/2026 às 10:30')
  })

  it('is deterministic across late-evening boundary', () => {
    // 23:30 UTC on Apr 28 -> 20:30 BRT on the SAME day.
    expect(formatDate('2026-04-28T23:30:00.000Z')).toBe('28/04/2026')
    // 02:30 UTC on Apr 29 -> 23:30 BRT on Apr 28 (still previous day).
    expect(formatDate('2026-04-29T02:30:00.000Z')).toBe('28/04/2026')
    expect(formatDateTime('2026-04-29T02:30:00.000Z')).toBe('28/04/2026 às 23:30')
  })
})
