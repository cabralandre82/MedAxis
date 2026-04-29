import type { PaymentReminderKind } from '@/lib/email/templates'

export type ReminderKind = PaymentReminderKind

/**
 * Decide which reminder cadence (if any) applies to a payment whose
 * boleto/PIX falls due on `dueDate`, evaluated at `today`. Pure
 * function — no DB, no side effects — so it can be unit-tested with a
 * frozen clock.
 *
 * Cadence semantics
 * -----------------
 *   D-3      → 3 calendar days before due (friendly heads-up)
 *   D-1      → 1 calendar day before due  (warning, last chance for boleto)
 *   D-day    → due date itself             (urgent — boleto loses validity at midnight)
 *   OVERDUE  → strictly after due date     (every day, but the cron de-dupes via the ledger)
 *
 * Why one function and not four if/else in the cron
 * --------------------------------------------------
 * Two reasons:
 *   1. Off-by-one bugs around timezones are the #1 source of dunning
 *      errors in B2B payments. Centralising the math means the unit
 *      tests (tests/unit/lib/payments/reminder-cadence.test.ts) cover
 *      every edge — and the cron just consumes the verdict.
 *   2. The OVERDUE bucket has a soft "max age" rule: we don't want to
 *      keep paging a clinic 90 days later. The function returns
 *      `null` past `OVERDUE_MAX_AGE_DAYS` so the cron simply skips
 *      ancient rows without further checks.
 *
 * All comparisons use UTC midnight of each date — Asaas stores
 * `payment_due_date` as a naïve `YYYY-MM-DD` (no time component), so
 * normalising to UTC midnight keeps the math purely calendar-based
 * and avoids DST drift.
 */

const OVERDUE_MAX_AGE_DAYS = 30

export interface CadenceVerdict {
  kind: ReminderKind
  /** Negative for pre-due cadences, 0 on D-day, positive for OVERDUE. */
  daysFromDue: number
}

/**
 * Returns the cadence to apply, or `null` if today doesn't match any
 * reminder window for this due date.
 */
export function decideReminderCadence(todayIso: string, dueDateIso: string): CadenceVerdict | null {
  const today = atUtcMidnight(todayIso)
  const due = atUtcMidnight(dueDateIso)
  if (Number.isNaN(today.getTime()) || Number.isNaN(due.getTime())) return null

  const oneDayMs = 24 * 60 * 60 * 1000
  const daysFromDue = Math.round((today.getTime() - due.getTime()) / oneDayMs)

  if (daysFromDue === -3) return { kind: 'D_MINUS_3', daysFromDue }
  if (daysFromDue === -1) return { kind: 'D_MINUS_1', daysFromDue }
  if (daysFromDue === 0) return { kind: 'D_DAY', daysFromDue }
  if (daysFromDue >= 1 && daysFromDue <= OVERDUE_MAX_AGE_DAYS) {
    return { kind: 'OVERDUE', daysFromDue }
  }
  return null
}

function atUtcMidnight(iso: string): Date {
  // Tolerate either pure date (YYYY-MM-DD) or full ISO string. We slice
  // off any time component because the cron compares calendar days,
  // not instants — a payment due 2026-05-02 is "due today" for every
  // server instant on May 2nd UTC, regardless of when the cron fires.
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso
  return new Date(`${datePart}T00:00:00.000Z`)
}

export const __testing = { OVERDUE_MAX_AGE_DAYS }
