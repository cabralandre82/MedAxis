/**
 * @fileoverview Forbid the "manual underscore-stripping" pattern that
 *               rendered enum statuses raw and in English on the clinic
 *               dashboard (regression-audit-2026-04-28 item #12).
 *
 * Pattern caught
 * --------------
 *
 *     {order.order_status.replace(/_/g, ' ')}              // ❌
 *     {payment.payment_status.replace(/_/g, '-')}          // ❌
 *     {someStatus.replace(/_/g, ' ').toLowerCase()}        // ❌ (chained)
 *
 *     {statusLabel(order.order_status)}                    // ✅
 *     {STATUS_LABELS[order.order_status]}                  // ✅
 *
 * Why
 * ---
 * `*.replace(/_/g, ' ')` is the smoking gun: it almost always means
 * "I have an enum value like `AWAITING_DOCUMENTS` and I'm rendering it
 * raw, just turning underscores into spaces". This:
 *
 *   1. ships English to a Portuguese product (was the visible bug);
 *   2. discards the canonical Tailwind colour mapping kept in
 *      `lib/orders/status-machine.ts` (was the cosmetic bug);
 *   3. drifts as soon as the enum gains a new member.
 *
 * Use `statusLabel(...)` / `paymentStatusLabel(...)` from the relevant
 * status-machine module, OR look the value up in `STATUS_LABELS`.
 *
 * Rule type: 'problem' (real bug, not just style).
 * Auto-fix: NO — the fix requires choosing the right label module
 *           (`@/lib/orders/status-machine` vs payments etc.) and an
 *           import addition; we want the developer to see the message.
 */

'use strict'

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow rendering `*.<…>_status.replace(/_/g, …)` — use statusLabel(...) from lib/orders/status-machine instead.',
      recommended: true,
    },
    schema: [],
    messages: {
      raw:
        "Don't render `{{name}}` raw via `.replace(/_/g, …)`. " +
        'Use `statusLabel(value)` from `@/lib/orders/status-machine` ' +
        '(or the equivalent helper) so the UI stays in pt-BR and uses ' +
        'the canonical colour palette.',
    },
  },

  create(context) {
    /**
     * Returns the dotted name of a MemberExpression chain, or null if
     * the chain isn't pure dotted access. We use this both to identify
     * a status-shaped receiver (e.g. `order.order_status`) and to keep
     * the lint message readable.
     */
    function getDottedName(node) {
      if (!node) return null
      if (node.type === 'Identifier') return node.name
      if (node.type === 'ThisExpression') return 'this'
      if (node.type === 'MemberExpression' && !node.computed) {
        const obj = getDottedName(node.object)
        const prop = node.property && node.property.name
        if (obj && prop) return `${obj}.${prop}`
      }
      return null
    }

    /**
     * Heuristic: a name is "status-shaped" if it ends in `_status`,
     * `Status`, equals `status`, or matches well-known order fields.
     * Deliberately broad — we'd rather over-report on payment_status,
     * order_status, transferStatus, etc. (each one previously caused
     * the same bug class somewhere) than miss them.
     */
    function isStatusName(name) {
      if (!name) return false
      const tail = name.split('.').pop() || name
      return (
        tail === 'status' ||
        /_status$/.test(tail) ||
        /Status$/.test(tail)
      )
    }

    /**
     * Detects the offending regex pattern. We accept:
     *   - RegExp literal `/_/g`
     *   - new RegExp('_', 'g') — same shape, rarely used but handle it.
     */
    function isUnderscoreRegexArg(arg) {
      if (!arg) return false
      if (arg.type === 'Literal' && arg.value instanceof RegExp) {
        const re = arg.value
        return re.source === '_' && re.flags.includes('g')
      }
      if (arg.type === 'NewExpression' && arg.callee && arg.callee.name === 'RegExp') {
        const [pattern, flags] = arg.arguments || []
        return (
          pattern &&
          pattern.type === 'Literal' &&
          pattern.value === '_' &&
          flags &&
          flags.type === 'Literal' &&
          typeof flags.value === 'string' &&
          flags.value.includes('g')
        )
      }
      return false
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          !callee ||
          callee.type !== 'MemberExpression' ||
          callee.property?.name !== 'replace'
        ) {
          return
        }
        if (!isUnderscoreRegexArg(node.arguments[0])) return

        const dotted = getDottedName(callee.object)
        if (!isStatusName(dotted)) return

        context.report({
          node,
          messageId: 'raw',
          data: { name: dotted ?? '<status>' },
        })
      },
    }
  },
}
