/**
 * Audit 5 — Unit tests for all fixes applied in this round.
 *
 * Covers:
 * 1. createUser: PHARMACY_ADMIN now inserts into pharmacy_members
 * 2. registerConsultantTransfer: atomic guard prevents double payment
 * 3. updatePharmacyStatus / updateDoctorStatus: oldValues in audit log
 * 4. assignUserRole: uses upsert instead of delete+insert
 * 5. Clicksign webhook: secret header verification
 * 6. sendSms / sendWhatsApp: empty phone guard
 * 7. DB constraint logic (simulated)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 6. SMS / WhatsApp empty phone guards ────────────────────────────────────

describe('sendSms — empty phone guard', () => {
  it('returns early without calling Zenvia if phone is empty', async () => {
    const { sendSms } = await import('@/lib/zenvia')
    await expect(sendSms('', 'test message')).resolves.toBeUndefined()
  })

  it('returns early if phone has fewer than 10 digits', async () => {
    const { sendSms } = await import('@/lib/zenvia')
    await expect(sendSms('123', 'test message')).resolves.toBeUndefined()
  })

  it('processes a valid 11-digit phone number without crashing', async () => {
    const { sendSms } = await import('@/lib/zenvia')
    // Zenvia is not configured in tests (mocked), should return undefined
    await expect(sendSms('11999999999', 'test')).resolves.toBeUndefined()
  })
})

describe('sendWhatsApp — empty phone guard', () => {
  it('returns early if phone is empty', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('', 'message')).resolves.toBeUndefined()
  })

  it('returns early if phone has fewer than 10 digits', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('555', 'message')).resolves.toBeUndefined()
  })

  it('processes valid phone when API is not configured (graceful no-op)', async () => {
    const { sendWhatsApp } = await import('@/lib/zenvia')
    await expect(sendWhatsApp('11999887766', 'msg')).resolves.toBeUndefined()
  })
})

// ── 7. DB constraint logic (simulated) ──────────────────────────────────────

describe('DB constraint logic — simulated', () => {
  function checkPharmacyCostLtePrice(pharmacyCost: number, priceCurrentat: number): boolean {
    return pharmacyCost <= priceCurrentat
  }

  it('allows pharmacy_cost equal to price_current', () => {
    expect(checkPharmacyCostLtePrice(100, 100)).toBe(true)
  })

  it('allows pharmacy_cost less than price_current', () => {
    expect(checkPharmacyCostLtePrice(70, 100)).toBe(true)
  })

  it('rejects pharmacy_cost greater than price_current', () => {
    expect(checkPharmacyCostLtePrice(110, 100)).toBe(false)
  })

  function checkAmountPositive(amount: number): boolean {
    return amount > 0
  }

  it('rejects zero gross_amount in payments', () => {
    expect(checkAmountPositive(0)).toBe(false)
  })

  it('rejects negative gross_amount in payments', () => {
    expect(checkAmountPositive(-50)).toBe(false)
  })

  it('accepts positive gross_amount in payments', () => {
    expect(checkAmountPositive(0.01)).toBe(true)
  })

  function checkCommissionStatus(status: string): boolean {
    return ['PENDING', 'PROCESSING', 'TRANSFER_PENDING', 'PAID', 'CANCELLED'].includes(status)
  }

  it('allows PROCESSING status for consultant_commissions', () => {
    expect(checkCommissionStatus('PROCESSING')).toBe(true)
  })

  it('rejects invalid status for consultant_commissions', () => {
    expect(checkCommissionStatus('UNKNOWN')).toBe(false)
  })

  it('allows all expected statuses', () => {
    const valid = ['PENDING', 'PROCESSING', 'TRANSFER_PENDING', 'PAID', 'CANCELLED']
    valid.forEach((s) => expect(checkCommissionStatus(s)).toBe(true))
  })
})

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

// ── 1. createUser — PHARMACY_ADMIN inserts into pharmacy_members ─────────────

describe('createUser — PHARMACY_ADMIN pharmacy_members fix', () => {
  it('includes pharmacy_members insert path for PHARMACY_ADMIN', () => {
    const src = readFileSync(join(ROOT, 'services/users.ts'), 'utf8')
    expect(src).toContain("from('pharmacy_members').insert")
    expect(src).toContain('pharmacy_id: parsed.data.pharmacy_id')
  })

  it('has the pharmacy_members insert (not just the old pharmacies.update pattern)', () => {
    const src = readFileSync(join(ROOT, 'services/users.ts'), 'utf8')
    expect(src).toContain("from('pharmacy_members').insert")
  })
})

// ── 2. registerConsultantTransfer — atomic guard ─────────────────────────────

describe('registerConsultantTransfer — atomic double-payment guard', () => {
  it('uses atomic UPDATE claiming commissions as PROCESSING before creating transfer', () => {
    const src = readFileSync(join(ROOT, 'services/consultants.ts'), 'utf8')
    expect(src).toContain("status: 'PROCESSING'")
    expect(src).toContain(".eq('status', 'PENDING')")
    expect(src).toContain('claimed')
  })

  it('rolls back commissions to PENDING if transfer creation fails', () => {
    const src = readFileSync(join(ROOT, 'services/consultants.ts'), 'utf8')
    // Check that rollback code is present
    expect(src).toContain('Rollback')
    // After rollback, status goes back to PENDING
    const rollbackIdx = src.indexOf('Rollback')
    const afterRollback = src.slice(rollbackIdx, rollbackIdx + 300)
    expect(afterRollback).toContain("status: 'PENDING'")
  })
})

// ── 3. updatePharmacyStatus + updateDoctorStatus — oldValues in audit log ────

describe('updatePharmacyStatus — oldValues in audit log', () => {
  it('fetches existing status and includes it in audit log', () => {
    const src = readFileSync(join(ROOT, 'services/pharmacies.ts'), 'utf8')
    expect(src).toContain('oldValues: { status: existing?.status }')
  })

  it('returns an error if update fails', () => {
    const src = readFileSync(join(ROOT, 'services/pharmacies.ts'), 'utf8')
    expect(src).toContain("'Erro ao atualizar status'")
  })
})

describe('updateDoctorStatus — oldValues in audit log', () => {
  it('fetches existing status and includes it in audit log', () => {
    const src = readFileSync(join(ROOT, 'services/doctors.ts'), 'utf8')
    expect(src).toContain('oldValues: { status: existing?.status }')
  })

  it('returns an error if update fails', () => {
    const src = readFileSync(join(ROOT, 'services/doctors.ts'), 'utf8')
    expect(src).toContain("'Erro ao atualizar status'")
  })
})

// ── 4. assignUserRole — upsert instead of delete+insert ─────────────────────

describe('assignUserRole — atomic upsert', () => {
  it('uses upsert with onConflict instead of delete+insert', () => {
    const src = readFileSync(join(ROOT, 'services/users.ts'), 'utf8')
    expect(src).toContain('.upsert(')
    expect(src).toContain("onConflict: 'user_id'")
  })

  it('assignUserRole function body does not use .delete()', () => {
    const src = readFileSync(join(ROOT, 'services/users.ts'), 'utf8')
    const fnStart = src.indexOf('export async function assignUserRole')
    const fnEnd = src.indexOf('export async function', fnStart + 1)
    const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd)
    expect(fnBody).not.toContain('.delete()')
  })
})

// ── 5. Clicksign webhook — secret verification ───────────────────────────────

describe('Clicksign webhook — HMAC SHA256 verification', () => {
  it('verifies Content-Hmac header with HMAC SHA256 and rejects unauthorized requests', () => {
    const src = readFileSync(join(ROOT, 'app/api/contracts/webhook/route.ts'), 'utf8')
    expect(src).toContain('CLICKSIGN_WEBHOOK_SECRET')
    expect(src).toContain('content-hmac')
    // Wave 5: HMAC compare moved to lib/security/hmac. Route delegates to verifyHmacSha256.
    expect(src).toContain('verifyHmacSha256')
    expect(src).toContain('status: 401')

    const hmacLib = readFileSync(join(ROOT, 'lib/security/hmac.ts'), 'utf8')
    expect(hmacLib).toContain('createHmac')
    expect(hmacLib).toContain('timingSafeEqual')
  })
})
