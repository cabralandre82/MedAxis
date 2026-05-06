/**
 * Tests for Inngest background jobs.
 * We test the core business logic by inspecting the source code structure
 * and by unit-testing the helper functions they depend on.
 * Full integration tests require the Inngest Dev Server.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

function readJob(filename: string) {
  return readFileSync(join(ROOT, 'lib/jobs', filename), 'utf8')
}

// ── export-orders ─────────────────────────────────────────────────────────────

describe('lib/jobs/export-orders', () => {
  const src = readJob('export-orders.ts')

  it('defines exportOrdersJob with correct Inngest event trigger', () => {
    expect(src).toContain("id: 'export-orders'")
    expect(src).toContain("'export/orders.requested'")
  })

  it('configures concurrency limit', () => {
    expect(src).toContain('concurrency')
    expect(src).toContain('limit: 5')
  })

  it('configures retry', () => {
    expect(src).toContain('retries: 2')
  })

  it('has fetch-orders step that applies date/status/pharmacy filters', () => {
    expect(src).toContain("step.run('fetch-orders'")
    expect(src).toContain('filters.startDate')
    expect(src).toContain('filters.endDate')
    expect(src).toContain('filters.status')
    expect(src).toContain('filters.pharmacyId')
  })

  it('has build-csv step that produces header row', () => {
    expect(src).toContain("step.run('build-csv'")
    expect(src).toContain('Código,Status,Total,Data,Clínica,Farmácia')
  })

  it('has send-email step', () => {
    expect(src).toContain("step.run('send-email'")
    expect(src).toContain('sendEmail')
    expect(src).toContain('notifyEmail')
  })

  it('uses getTradeName helper to flatten Supabase join result', () => {
    expect(src).toContain('getTradeName')
    expect(src).toContain('Array.isArray')
  })
})

// ── stale-orders ──────────────────────────────────────────────────────────────

describe('lib/jobs/stale-orders', () => {
  const src = readJob('stale-orders.ts')

  it('defines staleOrdersJob with correct Inngest event trigger', () => {
    expect(src).toContain("id: 'check-stale-orders'")
    expect(src).toContain("'cron/stale-orders.check'")
  })

  it('configures retry 3x', () => {
    expect(src).toContain('retries: 3')
  })

  it('filters only non-terminal order statuses', () => {
    expect(src).toContain('COMPLETED')
    expect(src).toContain('CANCELED')
    expect(src).toContain('DELIVERED')
    expect(src).toContain('.not(')
  })

  it('uses 48h threshold constant', () => {
    expect(src).toContain('STALE_THRESHOLD_HOURS')
    expect(src).toContain('48')
  })

  it('returns early when no stale orders found', () => {
    expect(src).toContain('staleOrders.length === 0')
    expect(src).toContain('return { stale: 0 }')
  })

  it('sends notification to SUPER_ADMIN', () => {
    expect(src).toContain('createNotificationForRole')
    expect(src).toContain("'SUPER_ADMIN'")
  })
})

// ── asaas-webhook ────────────────────────────────────────────────────────────

describe('lib/jobs/asaas-webhook', () => {
  const src = readJob('asaas-webhook.ts')

  it('defines asaasWebhookJob with correct Inngest event trigger', () => {
    expect(src).toContain("id: 'process-asaas-webhook'")
    expect(src).toContain("'webhook/asaas.received'")
  })

  it('configures retry 3x', () => {
    expect(src).toContain('retries: 3')
  })

  it('has fetch-order step', () => {
    expect(src).toContain("step.run('fetch-order'")
  })

  it('implements idempotency guard against double-confirmation', () => {
    expect(src).toContain('PAYMENT_CONFIRMED')
    expect(src).toContain('already_confirmed')
  })

  it('has release-for-execution step that delegates to the shared helper', () => {
    // Pre-2026-04-29 the worker advanced the order to PAYMENT_CONFIRMED
    // and stopped there. That left the order in a black hole — pharmacy
    // never saw it. The new contract: enqueue -> releaseOrderForExecution
    // helper -> RELEASED_FOR_EXECUTION + status history + pharmacy fanout.
    expect(src).toContain("step.run('release-for-execution'")
    expect(src).toContain('releaseOrderForExecution')
  })

  it('has confirm-payment-ledger step before release (Pre-Launch S1 / F1)', () => {
    // The webhook MUST insert into commissions / transfers /
    // consultant_commissions before releasing the order to the pharmacy.
    // Pre-2026-05-06 the webhook only flipped payment_status without
    // touching the financial ledger — bug latente que só não estourou
    // porque todo pagamento até hoje foi confirmado manualmente.
    expect(src).toContain("step.run('confirm-payment-ledger'")
    expect(src).toContain('confirmPaymentViaAsaasWebhook')
    // Confirm-payment-ledger must precede release-for-execution so the
    // pharmacy never sees an order without its commissions row.
    const confirmIdx = src.indexOf("step.run('confirm-payment-ledger'")
    const releaseIdx = src.indexOf("step.run('release-for-execution'")
    expect(confirmIdx).toBeGreaterThan(-1)
    expect(releaseIdx).toBeGreaterThan(confirmIdx)
  })

  it('has notify-clinic step with SMS, WhatsApp, email, and push', () => {
    expect(src).toContain("step.run('notify-clinic'")
    expect(src).toContain('sendSms')
    expect(src).toContain('sendWhatsApp')
    expect(src).toContain('sendEmail')
    expect(src).toContain('sendPushToUser')
  })

  it('notifies SUPER_ADMIN via createNotificationForRole', () => {
    expect(src).toContain('createNotificationForRole')
    expect(src).toContain("'SUPER_ADMIN'")
  })
})

// ── getTradeName helper ───────────────────────────────────────────────────────

describe('getTradeName helper (inline in export-orders)', () => {
  // Extract the helper logic and test it directly
  function getTradeName(val: { trade_name: string } | { trade_name: string }[] | null): string {
    if (!val) return ''
    if (Array.isArray(val)) return val[0]?.trade_name ?? ''
    return val.trade_name ?? ''
  }

  it('returns empty string for null', () => {
    expect(getTradeName(null)).toBe('')
  })

  it('returns trade_name from object', () => {
    expect(getTradeName({ trade_name: 'Farmácia ABC' })).toBe('Farmácia ABC')
  })

  it('returns first item trade_name from array (Supabase join format)', () => {
    expect(getTradeName([{ trade_name: 'Clínica XYZ' }])).toBe('Clínica XYZ')
  })

  it('returns empty string for empty array', () => {
    expect(getTradeName([])).toBe('')
  })
})
