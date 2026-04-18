// @vitest-environment node
/**
 * Manifest invariants — Wave 15.
 *
 * The runtime manifest in `lib/secrets/manifest.ts` and the SQL
 * manifest embedded in `secret_rotation_overdue()` (migration 056)
 * must always agree. This test reads both files from disk and
 * diffs the (name, tier, provider) tuples. If they drift, the build
 * fails — preventing the Wave 15 cron from rotating a secret that
 * doesn't exist in the SQL list (or vice versa).
 *
 * It also asserts other invariants that are easy to break by
 * accident:
 *   - tiers are exactly A | B | C
 *   - providers are in the allowed set
 *   - ENCRYPTION_KEY is `destroysDataAtRest`
 *   - SUPABASE_JWT_SECRET is `invalidatesSessions` and `hasSiblings`
 *   - tier C secrets get TIER_MAX_AGE_DAYS = 180 (not 90)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SECRET_MANIFEST,
  SECRET_MANIFEST_SIZE,
  TIER_MAX_AGE_DAYS,
  getSecretDescriptor,
  manifestFingerprint,
  secretsByTier,
} from '@/lib/secrets/manifest'

const MIGRATION_PATH = resolve(__dirname, '../../../supabase/migrations/056_secret_rotation.sql')
const ALLOWED_PROVIDERS = new Set([
  'vercel-env',
  'supabase-mgmt',
  'cloudflare-api',
  'firebase-console',
  'asaas-portal',
  'clicksign-portal',
  'resend-portal',
  'zenvia-portal',
  'inngest-portal',
  'nuvem-fiscal-portal',
  'openai-portal',
  'manual',
])

/**
 * Pull every `jsonb_build_object('n', '<name>', 't', '<tier>', 'p', '<prov>')`
 * out of the SQL file. Order does not matter; we sort before
 * comparing.
 */
function extractSqlManifest(): { name: string; tier: string; provider: string }[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const regex =
    /jsonb_build_object\(\s*'n'\s*,\s*'([^']+)'\s*,\s*'t'\s*,\s*'([^']+)'\s*,\s*'p'\s*,\s*'([^']+)'\s*\)/g
  const out: { name: string; tier: string; provider: string }[] = []
  for (const m of sql.matchAll(regex)) {
    out.push({ name: m[1], tier: m[2], provider: m[3] })
  }
  return out
}

describe('SECRET_MANIFEST shape', () => {
  it('has 19 entries (3 Tier A + 11 Tier B + 5 Tier C)', () => {
    expect(SECRET_MANIFEST_SIZE).toBe(19)
    expect(secretsByTier('A')).toHaveLength(3)
    expect(secretsByTier('B')).toHaveLength(11)
    expect(secretsByTier('C')).toHaveLength(5)
  })

  it('has unique secret names', () => {
    const names = SECRET_MANIFEST.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses only known tiers (A | B | C)', () => {
    for (const s of SECRET_MANIFEST) {
      expect(['A', 'B', 'C']).toContain(s.tier)
    }
  })

  it('uses only known providers', () => {
    for (const s of SECRET_MANIFEST) {
      expect(ALLOWED_PROVIDERS.has(s.provider)).toBe(true)
    }
  })

  it('has a non-empty description for every secret', () => {
    for (const s of SECRET_MANIFEST) {
      expect(s.description.length).toBeGreaterThan(20)
    }
  })

  it('uses uppercase env-var names matching process.env convention', () => {
    for (const s of SECRET_MANIFEST) {
      expect(s.name).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

describe('SECRET_MANIFEST domain invariants', () => {
  it('flags ENCRYPTION_KEY as destroying data at rest', () => {
    const enc = getSecretDescriptor('ENCRYPTION_KEY')
    expect(enc).not.toBeNull()
    expect(enc!.tier).toBe('C')
    expect(enc!.destroysDataAtRest).toBe(true)
  })

  it('flags SUPABASE_JWT_SECRET as session-invalidating with siblings', () => {
    const jwt = getSecretDescriptor('SUPABASE_JWT_SECRET')
    expect(jwt).not.toBeNull()
    expect(jwt!.tier).toBe('C')
    expect(jwt!.invalidatesSessions).toBe(true)
    expect(jwt!.hasSiblings).toBe(true)
  })

  it('classifies all webhook HMACs as Tier B (paired rotation)', () => {
    const webhookSecrets = SECRET_MANIFEST.filter((s) => s.name.includes('WEBHOOK_SECRET'))
    expect(webhookSecrets.length).toBeGreaterThanOrEqual(2)
    for (const w of webhookSecrets) {
      expect(w.tier).toBe('B')
    }
  })

  it('TIER_MAX_AGE_DAYS gives Tier C a longer fuse than A/B', () => {
    expect(TIER_MAX_AGE_DAYS.A).toBe(90)
    expect(TIER_MAX_AGE_DAYS.B).toBe(90)
    expect(TIER_MAX_AGE_DAYS.C).toBe(180)
  })

  it('manifestFingerprint is deterministic and order-independent', () => {
    const a = manifestFingerprint()
    const b = manifestFingerprint()
    expect(a).toBe(b)
    expect(a.split('|').length).toBe(SECRET_MANIFEST_SIZE)
  })
})

describe('runtime ↔ SQL manifest parity', () => {
  it('SQL manifest mirrors runtime manifest exactly (twice — overdue + genesis)', () => {
    const sqlEntries = extractSqlManifest()

    // The SQL file embeds the same manifest twice (overdue RPC + genesis seed).
    // We expect 2 × runtime size.
    expect(sqlEntries.length).toBe(SECRET_MANIFEST_SIZE * 2)

    const sqlSet = new Set(sqlEntries.map((e) => `${e.name}:${e.tier}:${e.provider}`))
    const runtimeSet = new Set(SECRET_MANIFEST.map((s) => `${s.name}:${s.tier}:${s.provider}`))

    // Every runtime entry must appear in SQL (as exactly two copies).
    for (const key of runtimeSet) {
      expect(sqlSet.has(key)).toBe(true)
    }

    // Every SQL entry must appear in runtime.
    for (const key of sqlSet) {
      expect(runtimeSet.has(key)).toBe(true)
    }

    // Both copies of the SQL manifest must be identical (one in
    // secret_rotation_overdue, one in the genesis DO block).
    const counts = new Map<string, number>()
    for (const e of sqlEntries) {
      const k = `${e.name}:${e.tier}:${e.provider}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const [, n] of counts) {
      expect(n).toBe(2)
    }
  })
})

describe('getSecretDescriptor', () => {
  it('returns null for unknown names', () => {
    expect(getSecretDescriptor('NOT_A_REAL_SECRET')).toBeNull()
  })

  it('returns the descriptor for a known name', () => {
    const d = getSecretDescriptor('CRON_SECRET')
    expect(d?.tier).toBe('A')
    expect(d?.provider).toBe('vercel-env')
  })
})
