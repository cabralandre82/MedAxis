import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RETENTION_CATALOG,
  RETENTION_EXCLUDED_TABLES,
  summarizeCatalog,
  type RetentionPolicy,
} from '@/lib/retention/policies'

/**
 * Wave Hardening II #5 — Invariantes do catálogo de retenção.
 *
 * Estes testes garantem que:
 *   - O catálogo é internamente consistente (sem ids duplicados, sem prazos negativos);
 *   - Todo cron citado no catálogo realmente existe em vercel.json;
 *   - Toda política deve ter base legal e citação não-vazia;
 *   - Nenhuma tabela está duplicada entre catálogo e lista de exclusões;
 *   - O documento público (`docs/legal/retention-policy.md`) referencia todos os IDs.
 */

const ROOT = process.cwd()

describe('retention catalog — structural invariants', () => {
  it('has no duplicate ids', () => {
    const ids = RETENTION_CATALOG.map((p) => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('has at least 20 mapped categories (sanity floor)', () => {
    expect(RETENTION_CATALOG.length).toBeGreaterThanOrEqual(20)
  })

  it('every policy has a non-empty legal citation', () => {
    for (const p of RETENTION_CATALOG) {
      expect(p.legalCitation, `${p.id} (${p.table}) lacks legalCitation`).toBeTruthy()
      expect(p.legalCitation.length, `${p.id} legalCitation too short`).toBeGreaterThan(10)
    }
  })

  it('retentionDays is null OR a positive integer', () => {
    for (const p of RETENTION_CATALOG) {
      if (p.retentionDays !== null) {
        expect(p.retentionDays, `${p.id}: retentionDays must be > 0 or null`).toBeGreaterThan(0)
        expect(Number.isInteger(p.retentionDays)).toBe(true)
      }
    }
  })

  it("'never' enforcement is consistent with null/very-long retention", () => {
    for (const p of RETENTION_CATALOG) {
      if (p.enforcement.kind === 'never') {
        const longEnough = p.retentionDays === null || p.retentionDays >= 5 * 365
        expect(
          longEnough,
          `${p.id}: enforcement=never but retentionDays is short — looks inconsistent`
        ).toBe(true)
      }
    }
  })

  it("policies that 'honor legal hold' are never just internal logs that contain no PII", () => {
    // Logs operacionais (RP-12, RP-14, RP-15, RP-03) não devem honrar legal hold.
    const operationalLogs = ['RP-03', 'RP-12', 'RP-14', 'RP-15', 'RP-18']
    for (const id of operationalLogs) {
      const p = RETENTION_CATALOG.find((x) => x.id === id)
      expect(p, `${id} missing from catalog`).toBeDefined()
      expect(p?.honorsLegalHold, `${id} should NOT honor legal hold (operational log)`).toBe(false)
    }
  })

  it('table names do not collide between catalog and excluded list', () => {
    const inCatalog = new Set(RETENTION_CATALOG.map((p) => p.table.split(' ')[0]))
    for (const excluded of Object.keys(RETENTION_EXCLUDED_TABLES)) {
      expect(
        inCatalog.has(excluded),
        `Table "${excluded}" is in BOTH catalog and EXCLUDED list — pick one`
      ).toBe(false)
    }
  })
})

describe('retention catalog — cross-references with infra', () => {
  it('every cron mentioned in the catalog is registered in vercel.json', () => {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      crons: { path: string }[]
    }
    const registeredCrons = new Set(
      vercelJson.crons.map((c) => c.path.replace(/^\/api\/cron\//, ''))
    )
    const catalogCrons = new Set<string>()
    for (const p of RETENTION_CATALOG) {
      if (p.enforcement.kind === 'cron') catalogCrons.add(p.enforcement.cron)
    }
    for (const cron of catalogCrons) {
      expect(
        registeredCrons.has(cron),
        `Cron "${cron}" is referenced by catalog but missing from vercel.json`
      ).toBe(true)
    }
  })

  it('public legal document references every catalog id', () => {
    const md = readFileSync(join(ROOT, 'docs/legal/retention-policy.md'), 'utf8')
    for (const p of RETENTION_CATALOG) {
      expect(md.includes(p.id), `docs/legal/retention-policy.md missing reference to ${p.id}`).toBe(
        true
      )
    }
  })
})

describe('summarizeCatalog()', () => {
  it('returns counts that match the catalog length', () => {
    const s = summarizeCatalog()
    expect(s.total).toBe(RETENTION_CATALOG.length)

    const sumByClass = Object.values(s.byClass).reduce((a, b) => a + b, 0)
    expect(sumByClass).toBe(RETENTION_CATALOG.length)

    const sumByBasis = Object.values(s.byBasis).reduce((a, b) => a + b, 0)
    expect(sumByBasis).toBe(RETENTION_CATALOG.length)
  })

  it('automated count equals number of cron+ttl entries', () => {
    const s = summarizeCatalog()
    const expected = RETENTION_CATALOG.filter(
      (p: RetentionPolicy) => p.enforcement.kind === 'cron' || p.enforcement.kind === 'ttl'
    ).length
    expect(s.automated).toBe(expected)
  })
})
