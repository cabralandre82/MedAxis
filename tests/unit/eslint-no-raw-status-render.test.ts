/**
 * Unit tests for the local ESLint rule `no-raw-status-render`.
 *
 * The rule guards against the smoking gun of regression-audit-2026-04-28
 * item #12 — `.replace(/_/g, ' ')` on a status enum, which shipped
 * "AWAITING DOCUMENTS" to the clinic dashboard untranslated.
 *
 * We use ESLint's official `RuleTester` so this test is the
 * **executable specification** of the rule: change the rule, fix the
 * tests; change the tests, fix the rule.
 */

import { describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import rule from '../../eslint-rules/no-raw-status-render.js'

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

describe('no-raw-status-render', () => {
  it('runs the suite', () => {
    ruleTester.run('no-raw-status-render', rule as never, {
      valid: [
        // Canonical helper — the rule is OK with this.
        { code: 'statusLabel(order.order_status)' },
        // Indexed lookup is also OK.
        { code: 'STATUS_LABELS[order.order_status]' },
        // Unrelated `.replace` calls are not affected.
        { code: "name.replace(/_/g, ' ')" },
        // The rule only flags the underscore-to-space pattern; replacing a
        // status with a different regex is out of scope (rare and usually
        // a real transformation, not a render-time cosmetic).
        { code: "order.order_status.replace(/x/g, ' ')" },
        // Single underscore replacement (no /g) is also a different shape.
        { code: "order.order_status.replace('_', ' ')" },
        // Calls on non-status receivers do not trigger.
        { code: "order.code.replace(/_/g, ' ')" },
      ],
      invalid: [
        {
          // The exact regression bug from clinic-dashboard.tsx pre-fix.
          code: "order.order_status.replace(/_/g, ' ')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // Same shape with different separator.
          code: "order.order_status.replace(/_/g, '-')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // payment_status — same risk, same rule.
          code: "payment.payment_status.replace(/_/g, ' ')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // Receiver is the bare identifier `status`.
          code: "const out = status.replace(/_/g, ' ')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // Camel-case status field.
          code: "transferStatus.replace(/_/g, ' ')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // `new RegExp('_', 'g')` form.
          code: "order.order_status.replace(new RegExp('_', 'g'), ' ')",
          errors: [{ messageId: 'raw' }],
        },
        {
          // Chained — still flagged once because the offending call is
          // the inner `.replace`.
          code: "order.order_status.replace(/_/g, ' ').toLowerCase()",
          errors: [{ messageId: 'raw' }],
        },
      ],
    })
  })
})
