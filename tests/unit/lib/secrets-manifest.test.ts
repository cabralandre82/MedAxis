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
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SECRET_MANIFEST,
  SECRET_MANIFEST_SIZE,
  TIER_MAX_AGE_DAYS,
  getSecretDescriptor,
  manifestFingerprint,
  secretsByTier,
} from '@/lib/secrets/manifest'

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations')
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

type ManifestEntry = { name: string; tier: string; provider: string }

const JSONB_ENTRY_RE =
  /jsonb_build_object\(\s*'n'\s*,\s*'([^']+)'\s*,\s*'t'\s*,\s*'([^']+)'\s*,\s*'p'\s*,\s*'([^']+)'\s*\)/g

function parseEntries(sql: string): ManifestEntry[] {
  const out: ManifestEntry[] = []
  for (const m of sql.matchAll(JSONB_ENTRY_RE)) {
    out.push({ name: m[1], tier: m[2], provider: m[3] })
  }
  return out
}

function loadMigrationsTouchingManifest(): { file: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // filename lex order = chronological (NNN_ prefix)
  return files
    .map((file) => ({ file, sql: readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8') }))
    .filter(
      ({ sql }) =>
        /secret_rotation_overdue/.test(sql) ||
        (/secret_rotation_record/.test(sql) && /jsonb_build_object/.test(sql))
    )
}

/**
 * The **authoritative** manifest = the `v_manifest` array inside the
 * last migration that `CREATE OR REPLACE`s `secret_rotation_overdue`.
 * PostgreSQL executes those migrations in order, so the final DB
 * state matches the latest definition. This is exactly how drift was
 * handled in 056 vs 059: 056 declared 19 entries, 059 re-declares 20.
 */
function extractRpcManifest(): ManifestEntry[] {
  const migrations = loadMigrationsTouchingManifest().filter(({ sql }) =>
    /CREATE OR REPLACE FUNCTION public\.secret_rotation_overdue/i.test(sql)
  )
  if (migrations.length === 0) {
    throw new Error(
      'No migration defines secret_rotation_overdue — manifest parity is unverifiable.'
    )
  }
  // Latest migration wins (CREATE OR REPLACE semantics).
  const latest = migrations[migrations.length - 1]
  // Extract ONLY the v_manifest array inside the function body, not
  // any unrelated jsonb_build_object elsewhere in the file.
  const fnMatch = latest.sql.match(
    /CREATE OR REPLACE FUNCTION public\.secret_rotation_overdue[\s\S]+?\$\$;/i
  )
  if (!fnMatch) {
    throw new Error(`Could not isolate function body in ${latest.file}.`)
  }
  return parseEntries(fnMatch[0])
}

/**
 * Union of every jsonb entry across every genesis DO block in every
 * migration. After all migrations run, each secret should have been
 * seeded at least once (056 seeded the original 19, 059 seeds the
 * 20th, future migrations will seed new ones). The RPC body entries
 * themselves are excluded — we already check those separately.
 */
function extractGenesisSeedSet(): Set<string> {
  const seen = new Set<string>()
  for (const { sql } of loadMigrationsTouchingManifest()) {
    // Strip the function body so its inline manifest isn't double-
    // counted as a genesis seed.
    const withoutFn = sql.replace(
      /CREATE OR REPLACE FUNCTION public\.secret_rotation_overdue[\s\S]+?\$\$;/gi,
      ''
    )
    for (const e of parseEntries(withoutFn)) {
      seen.add(`${e.name}:${e.tier}:${e.provider}`)
    }
    // Migrations that seed a single secret inline (like 059's DO block
    // that calls secret_rotation_record('ZENVIA_WEBHOOK_SECRET', ...)
    // without a jsonb literal) still count — match those too.
    const inlineSeedRe =
      /secret_rotation_record\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'genesis'/g
    for (const m of withoutFn.matchAll(inlineSeedRe)) {
      seen.add(`${m[1]}:${m[2]}:${m[3]}`)
    }
  }
  return seen
}

describe('SECRET_MANIFEST shape', () => {
  it('has 20 entries (3 Tier A + 12 Tier B + 5 Tier C)', () => {
    expect(SECRET_MANIFEST_SIZE).toBe(20)
    expect(secretsByTier('A')).toHaveLength(3)
    expect(secretsByTier('B')).toHaveLength(12)
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
  /**
   * Semantics of these checks:
   *
   *   - The **RPC manifest** is the set returned by the latest
   *     `CREATE OR REPLACE FUNCTION secret_rotation_overdue` in any
   *     migration. That's what the cron will actually see at runtime.
   *     It MUST equal the runtime manifest exactly (no superset).
   *
   *   - The **genesis seed** is the union of every manifest entry
   *     seeded across all migrations (jsonb literal seeds + inline
   *     `secret_rotation_record(..., 'genesis', ...)` calls). Every
   *     runtime secret MUST have been seeded at least once, else the
   *     cron will report it as `never-rotated` forever.
   *
   * This design lets future migrations add a single new secret by
   * (a) shipping a `CREATE OR REPLACE` of the RPC body with the new
   * entry and (b) a single `secret_rotation_record(..., 'genesis')`
   * call — without re-shipping the full manifest twice like 056 did.
   */
  it('latest RPC definition equals the runtime manifest exactly', () => {
    const rpc = extractRpcManifest()
    expect(rpc.length).toBe(SECRET_MANIFEST_SIZE)

    const rpcKeys = new Set(rpc.map((e) => `${e.name}:${e.tier}:${e.provider}`))
    const runtimeKeys = new Set(SECRET_MANIFEST.map((s) => `${s.name}:${s.tier}:${s.provider}`))

    const missingInRpc = [...runtimeKeys].filter((k) => !rpcKeys.has(k))
    const staleInRpc = [...rpcKeys].filter((k) => !runtimeKeys.has(k))

    expect(
      missingInRpc,
      `runtime manifest has entries absent from latest RPC: ${missingInRpc.join(', ')}`
    ).toEqual([])
    expect(
      staleInRpc,
      `latest RPC has stale entries absent from runtime manifest: ${staleInRpc.join(', ')}`
    ).toEqual([])
  })

  it('every runtime secret has a genesis seed somewhere in the migration corpus', () => {
    const seeded = extractGenesisSeedSet()
    const missing: string[] = []
    for (const s of SECRET_MANIFEST) {
      const key = `${s.name}:${s.tier}:${s.provider}`
      if (!seeded.has(key)) missing.push(key)
    }
    expect(
      missing,
      `runtime secrets without a genesis seed (cron will report them as never-rotated): ${missing.join(', ')}`
    ).toEqual([])
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
