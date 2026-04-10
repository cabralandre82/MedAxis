import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  generateOrderCode,
  formatCNPJ,
  slugify,
  getInitials,
  truncate,
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
