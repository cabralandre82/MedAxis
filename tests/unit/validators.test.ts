import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  clinicSchema,
  orderSchema,
  priceUpdateSchema,
  doctorSchema,
  productSchema,
  productInterestSchema,
} from '@/lib/validators'

const UUID = '550e8400-e29b-41d4-a716-446655440001'
const UUID2 = '550e8400-e29b-41d4-a716-446655440002'
const UUID3 = '550e8400-e29b-41d4-a716-446655440003'

// ── loginSchema ──────────────────────────────────────────────────────────────
describe('loginSchema', () => {
  it('accepts valid email and password', () => {
    expect(loginSchema.safeParse({ email: 'user@test.com', password: '123456' }).success).toBe(true)
  })

  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: '123456' }).success).toBe(false)
  })

  it('rejects short password', () => {
    expect(loginSchema.safeParse({ email: 'user@test.com', password: '123' }).success).toBe(false)
  })
})

// ── priceUpdateSchema ─────────────────────────────────────────────────────────
describe('priceUpdateSchema', () => {
  it('accepts valid price update', () => {
    expect(
      priceUpdateSchema.safeParse({ new_price: 500, reason: 'Atualização de outubro' }).success
    ).toBe(true)
  })

  it('rejects negative price', () => {
    expect(priceUpdateSchema.safeParse({ new_price: -10, reason: 'Motivo' }).success).toBe(false)
  })

  it('rejects reason shorter than 10 chars', () => {
    expect(priceUpdateSchema.safeParse({ new_price: 500, reason: 'curto' }).success).toBe(false)
  })
})

// ── orderSchema — uses items array ────────────────────────────────────────────
describe('orderSchema', () => {
  const validItem = { product_id: UUID, quantity: 2 }

  it('accepts valid order with items array', () => {
    expect(
      orderSchema.safeParse({ clinic_id: UUID2, doctor_id: UUID3, items: [validItem] }).success
    ).toBe(true)
  })

  it('rejects order with empty items array', () => {
    expect(orderSchema.safeParse({ clinic_id: UUID2, doctor_id: UUID3, items: [] }).success).toBe(
      false
    )
  })

  it('rejects item with zero quantity', () => {
    expect(
      orderSchema.safeParse({
        clinic_id: UUID2,
        doctor_id: UUID3,
        items: [{ product_id: UUID, quantity: 0 }],
      }).success
    ).toBe(false)
  })

  it('rejects item with invalid UUID for product_id', () => {
    expect(
      orderSchema.safeParse({
        clinic_id: UUID2,
        doctor_id: UUID3,
        items: [{ product_id: 'not-a-uuid', quantity: 1 }],
      }).success
    ).toBe(false)
  })

  it('rejects invalid clinic_id', () => {
    expect(
      orderSchema.safeParse({ clinic_id: 'bad', doctor_id: UUID3, items: [validItem] }).success
    ).toBe(false)
  })

  it('accepts multiple items', () => {
    expect(
      orderSchema.safeParse({
        clinic_id: UUID2,
        doctor_id: UUID3,
        items: [validItem, { product_id: UUID2, quantity: 1 }],
      }).success
    ).toBe(true)
  })
})

// ── doctorSchema ──────────────────────────────────────────────────────────────
describe('doctorSchema', () => {
  it('accepts valid doctor', () => {
    expect(
      doctorSchema.safeParse({
        full_name: 'Dr. Carlos Silva',
        crm: '123456',
        crm_state: 'SP',
        email: 'dr@test.com',
      }).success
    ).toBe(true)
  })

  it('rejects CRM state longer than 2 chars', () => {
    expect(
      doctorSchema.safeParse({
        full_name: 'Dr. Carlos',
        crm: '123456',
        crm_state: 'SPA',
        email: 'dr@test.com',
      }).success
    ).toBe(false)
  })

  it('rejects CRM state shorter than 2 chars', () => {
    expect(
      doctorSchema.safeParse({
        full_name: 'Dr. Carlos',
        crm: '123456',
        crm_state: 'S',
        email: 'dr@test.com',
      }).success
    ).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(
      doctorSchema.safeParse({
        full_name: 'Dr. Carlos',
        crm: '123456',
        crm_state: 'SP',
        email: 'not-an-email',
      }).success
    ).toBe(false)
  })
})

// ── clinicSchema — requires corporate_name + zip_code ─────────────────────────
describe('clinicSchema', () => {
  const valid = {
    corporate_name: 'Clínica Saúde Ltda',
    trade_name: 'Clínica Saúde',
    cnpj: '12345678000101',
    email: 'clinica@test.com',
    address_line_1: 'Rua Teste, 123',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01310-100',
  }

  it('accepts valid clinic', () => {
    expect(clinicSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing trade_name', () => {
    expect(clinicSchema.safeParse({ ...valid, trade_name: '' }).success).toBe(false)
  })

  it('rejects state longer than 2 chars', () => {
    expect(clinicSchema.safeParse({ ...valid, state: 'SPX' }).success).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(clinicSchema.safeParse({ ...valid, email: 'bad-email' }).success).toBe(false)
  })

  it('rejects invalid CNPJ (too short)', () => {
    expect(clinicSchema.safeParse({ ...valid, cnpj: '123' }).success).toBe(false)
  })

  it('rejects invalid zip_code format', () => {
    expect(clinicSchema.safeParse({ ...valid, zip_code: '123' }).success).toBe(false)
  })
})

// ── productSchema ─────────────────────────────────────────────────────────────
describe('productSchema', () => {
  const valid = {
    category_id: UUID,
    pharmacy_id: UUID2,
    sku: 'TEST-001',
    name: 'Testosterona Cipionato',
    slug: 'testosterona-cipionato',
    concentration: '200mg/mL',
    presentation: 'Ampola 10mL',
    short_description: 'Descrição com pelo menos dez caracteres',
    price_current: 500,
    pharmacy_cost: 350,
    estimated_deadline_days: 7,
  }

  it('accepts valid product', () => {
    expect(productSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts product with status active', () => {
    expect(productSchema.safeParse({ ...valid, status: 'active' }).success).toBe(true)
  })

  it('accepts product with status unavailable', () => {
    expect(productSchema.safeParse({ ...valid, status: 'unavailable' }).success).toBe(true)
  })

  it('accepts product with status inactive', () => {
    expect(productSchema.safeParse({ ...valid, status: 'inactive' }).success).toBe(true)
  })

  it('rejects invalid status value', () => {
    expect(productSchema.safeParse({ ...valid, status: 'deleted' }).success).toBe(false)
  })

  it('rejects non-positive price', () => {
    expect(productSchema.safeParse({ ...valid, price_current: 0 }).success).toBe(false)
  })

  it('rejects negative pharmacy_cost', () => {
    expect(productSchema.safeParse({ ...valid, pharmacy_cost: -1 }).success).toBe(false)
  })

  it('rejects short_description shorter than 10 chars', () => {
    expect(productSchema.safeParse({ ...valid, short_description: 'curta' }).success).toBe(false)
  })
})

// ── productInterestSchema ─────────────────────────────────────────────────────
describe('productInterestSchema', () => {
  it('accepts valid interest', () => {
    expect(
      productInterestSchema.safeParse({
        product_id: UUID,
        name: 'João da Silva',
        whatsapp: '11999999999',
      }).success
    ).toBe(true)
  })

  it('rejects invalid product_id (not UUID)', () => {
    expect(
      productInterestSchema.safeParse({
        product_id: 'not-uuid',
        name: 'João',
        whatsapp: '11999999999',
      }).success
    ).toBe(false)
  })

  it('rejects name shorter than 2 chars', () => {
    expect(
      productInterestSchema.safeParse({ product_id: UUID, name: 'J', whatsapp: '11999999999' })
        .success
    ).toBe(false)
  })

  it('rejects whatsapp shorter than 8 chars', () => {
    expect(
      productInterestSchema.safeParse({ product_id: UUID, name: 'João', whatsapp: '1199' }).success
    ).toBe(false)
  })
})
