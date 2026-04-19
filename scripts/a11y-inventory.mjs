#!/usr/bin/env node
/**
 * A11y inventory script — runs axe-core against the production public pages
 * and dumps every violation with selector, html and target. Used during the
 * a11y hardening pass to know exactly what to fix.
 *
 * Usage:
 *   node scripts/a11y-inventory.mjs [BASE_URL]
 *   (default BASE_URL: https://clinipharma.com.br)
 */
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const BASE_URL = process.argv[2] ?? 'https://clinipharma.com.br'
const PAGES = ['/login', '/terms', '/privacy', '/dpo', '/trust', '/status']
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

const allViolations = new Map() // ruleId -> { impact, help, occurrences: [{path, selector, html}] }

for (const path of PAGES) {
  await page.goto(BASE_URL + path)
  await page.waitForLoadState('networkidle').catch(() => {})
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  for (const v of r.violations) {
    if (v.impact !== 'critical' && v.impact !== 'serious') continue
    if (!allViolations.has(v.id)) {
      allViolations.set(v.id, { impact: v.impact, help: v.help, helpUrl: v.helpUrl, occurrences: [] })
    }
    const slot = allViolations.get(v.id)
    for (const node of v.nodes) {
      slot.occurrences.push({
        path,
        selector: node.target.join(' '),
        html: node.html.substring(0, 200),
        failureSummary: node.failureSummary,
      })
    }
  }
}

await browser.close()

console.log('\n========== A11Y INVENTORY ==========')
console.log(`Base: ${BASE_URL}`)
console.log(`Pages scanned: ${PAGES.length}`)
console.log(`Unique rules violated: ${allViolations.size}\n`)

for (const [ruleId, data] of allViolations.entries()) {
  console.log(`━━━ [${data.impact.toUpperCase()}] ${ruleId} (${data.occurrences.length} occurrences)`)
  console.log(`    ${data.help}`)
  console.log(`    ${data.helpUrl}`)
  for (const occ of data.occurrences) {
    console.log(`\n    • ${occ.path}  ${occ.selector}`)
    console.log(`      html: ${occ.html.replace(/\s+/g, ' ').substring(0, 160)}`)
    if (occ.failureSummary) {
      console.log(`      why : ${occ.failureSummary.split('\n').filter(Boolean).join(' | ')}`)
    }
  }
  console.log()
}
