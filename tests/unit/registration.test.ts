import { describe, it, expect } from 'vitest'
import {
  CLINIC_REQUIRED_DOCS,
  DOCTOR_REQUIRED_DOCS,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUS_COLORS,
  ALL_REQUESTABLE_DOCS,
} from '@/lib/registration-constants'

describe('CLINIC_REQUIRED_DOCS', () => {
  it('contains the 3 required clinic documents', () => {
    expect(CLINIC_REQUIRED_DOCS).toHaveLength(3)
    const types = CLINIC_REQUIRED_DOCS.map((d) => d.type)
    expect(types).toContain('CNPJ_CARD')
    expect(types).toContain('OPERATING_LICENSE')
    expect(types).toContain('RESPONSIBLE_ID')
  })

  it('every entry has type and label', () => {
    CLINIC_REQUIRED_DOCS.forEach((d) => {
      expect(d.type).toBeTruthy()
      expect(d.label).toBeTruthy()
    })
  })
})

describe('DOCTOR_REQUIRED_DOCS', () => {
  it('contains the 2 required doctor documents', () => {
    expect(DOCTOR_REQUIRED_DOCS).toHaveLength(2)
    const types = DOCTOR_REQUIRED_DOCS.map((d) => d.type)
    expect(types).toContain('CRM_CARD')
    expect(types).toContain('IDENTITY_DOC')
  })
})

describe('REGISTRATION_STATUS_LABELS', () => {
  const statuses = ['PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED']

  it('has a label for every status', () => {
    statuses.forEach((s) => {
      expect(REGISTRATION_STATUS_LABELS[s]).toBeTruthy()
    })
  })

  it('APPROVED label is defined', () => {
    expect(REGISTRATION_STATUS_LABELS['APPROVED']).toBe('Aprovado')
  })

  it('PENDING label is defined', () => {
    expect(REGISTRATION_STATUS_LABELS['PENDING']).toBe('Aguardando análise')
  })

  it('REJECTED label is defined', () => {
    expect(REGISTRATION_STATUS_LABELS['REJECTED']).toBe('Reprovado')
  })
})

describe('REGISTRATION_STATUS_COLORS', () => {
  const statuses = ['PENDING', 'PENDING_DOCS', 'APPROVED', 'REJECTED']

  it('has a color class for every status', () => {
    statuses.forEach((s) => {
      expect(REGISTRATION_STATUS_COLORS[s]).toBeTruthy()
    })
  })

  it('APPROVED uses green color', () => {
    expect(REGISTRATION_STATUS_COLORS['APPROVED']).toContain('green')
  })

  it('REJECTED uses red color', () => {
    expect(REGISTRATION_STATUS_COLORS['REJECTED']).toContain('red')
  })
})

describe('ALL_REQUESTABLE_DOCS', () => {
  it('contains at least all required docs from both entity types', () => {
    const types = ALL_REQUESTABLE_DOCS.map((d) => d.type)
    ;['CNPJ_CARD', 'OPERATING_LICENSE', 'RESPONSIBLE_ID', 'CRM_CARD', 'IDENTITY_DOC'].forEach((t) =>
      expect(types).toContain(t)
    )
  })

  it('includes an OTHER option', () => {
    expect(ALL_REQUESTABLE_DOCS.find((d) => d.type === 'OTHER')).toBeDefined()
  })

  it('has no duplicate types', () => {
    const types = ALL_REQUESTABLE_DOCS.map((d) => d.type)
    expect(types.length).toBe(new Set(types).size)
  })
})
