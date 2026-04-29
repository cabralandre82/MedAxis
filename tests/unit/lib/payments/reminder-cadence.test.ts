import { describe, it, expect } from 'vitest'
import { decideReminderCadence, __testing } from '@/lib/payments/reminder-cadence'

/**
 * The cron that sends boleto/PIX reminders is gated on this single
 * function. Off-by-one bugs around due dates would either spam the
 * customer twice or skip an entire cadence — both are dunning
 * malpractice in B2B payments. Cover every boundary explicitly.
 */
describe('decideReminderCadence', () => {
  describe('pre-due cadences (negative daysFromDue)', () => {
    it('returns D_MINUS_3 exactly 3 days before due', () => {
      expect(decideReminderCadence('2026-04-29', '2026-05-02')).toEqual({
        kind: 'D_MINUS_3',
        daysFromDue: -3,
      })
    })

    it('returns D_MINUS_1 exactly 1 day before due', () => {
      expect(decideReminderCadence('2026-05-01', '2026-05-02')).toEqual({
        kind: 'D_MINUS_1',
        daysFromDue: -1,
      })
    })

    it('returns null at D-2 (intentional gap between heads-up and warning)', () => {
      expect(decideReminderCadence('2026-04-30', '2026-05-02')).toBeNull()
    })

    it('returns null at D-4 or earlier (too early)', () => {
      expect(decideReminderCadence('2026-04-28', '2026-05-02')).toBeNull()
      expect(decideReminderCadence('2026-04-01', '2026-05-02')).toBeNull()
    })
  })

  describe('D-day (urgent)', () => {
    it('fires on the due date itself', () => {
      expect(decideReminderCadence('2026-05-02', '2026-05-02')).toEqual({
        kind: 'D_DAY',
        daysFromDue: 0,
      })
    })
  })

  describe('OVERDUE bucket', () => {
    it('fires on D+1 with daysFromDue=1', () => {
      expect(decideReminderCadence('2026-05-03', '2026-05-02')).toEqual({
        kind: 'OVERDUE',
        daysFromDue: 1,
      })
    })

    it('fires every day inside the overdue window', () => {
      for (let d = 1; d <= __testing.OVERDUE_MAX_AGE_DAYS; d++) {
        const today = new Date('2026-05-02T00:00:00Z')
        today.setUTCDate(today.getUTCDate() + d)
        const result = decideReminderCadence(today.toISOString().slice(0, 10), '2026-05-02')
        expect(result).toEqual({ kind: 'OVERDUE', daysFromDue: d })
      }
    })

    it('stops firing past OVERDUE_MAX_AGE_DAYS', () => {
      const tooLate = new Date('2026-05-02T00:00:00Z')
      tooLate.setUTCDate(tooLate.getUTCDate() + __testing.OVERDUE_MAX_AGE_DAYS + 1)
      expect(decideReminderCadence(tooLate.toISOString().slice(0, 10), '2026-05-02')).toBeNull()
    })
  })

  describe('input tolerance', () => {
    it('accepts ISO strings with time component (truncates to date)', () => {
      expect(decideReminderCadence('2026-05-02T14:23:45.000Z', '2026-05-02T08:00:00.000Z')).toEqual(
        { kind: 'D_DAY', daysFromDue: 0 }
      )
    })

    it('returns null for malformed inputs instead of throwing', () => {
      expect(decideReminderCadence('not a date', '2026-05-02')).toBeNull()
      expect(decideReminderCadence('2026-05-02', 'also bad')).toBeNull()
    })
  })

  describe('month/year rollovers', () => {
    it('handles end-of-month transitions correctly', () => {
      // Feb 2026 has 28 days. D-3 from Mar 2 is Feb 27.
      expect(decideReminderCadence('2026-02-27', '2026-03-02')).toEqual({
        kind: 'D_MINUS_3',
        daysFromDue: -3,
      })
    })

    it('handles year-end rollover correctly', () => {
      expect(decideReminderCadence('2026-12-30', '2027-01-02')).toEqual({
        kind: 'D_MINUS_3',
        daysFromDue: -3,
      })
    })

    it('handles leap-year boundary (2028 is a leap year — Feb 29 exists)', () => {
      // Mar 1 minus 3 days, in a year where Feb has 29 days, is Feb 27.
      // (Mar 1 → Feb 29 → Feb 28 → Feb 27.)
      expect(decideReminderCadence('2028-02-27', '2028-03-01')).toEqual({
        kind: 'D_MINUS_3',
        daysFromDue: -3,
      })
      // And D-1 lands on Feb 29 itself, which only exists in leap years.
      expect(decideReminderCadence('2028-02-29', '2028-03-01')).toEqual({
        kind: 'D_MINUS_1',
        daysFromDue: -1,
      })
    })
  })

  describe('timezone immunity', () => {
    it('treats due date as a calendar day regardless of fire time', () => {
      // Same calendar day in UTC, different times — must yield D_DAY.
      const earlyMorning = decideReminderCadence('2026-05-02T00:30:00.000Z', '2026-05-02')
      const lateNight = decideReminderCadence('2026-05-02T23:45:00.000Z', '2026-05-02')
      expect(earlyMorning).toEqual({ kind: 'D_DAY', daysFromDue: 0 })
      expect(lateNight).toEqual({ kind: 'D_DAY', daysFromDue: 0 })
    })
  })
})
