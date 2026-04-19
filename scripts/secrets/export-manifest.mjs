#!/usr/bin/env node
/**
 * Generate the audit-friendly JSON manifest of every tracked secret.
 *
 *   node scripts/secrets/export-manifest.mjs
 *
 * Reads `lib/secrets/manifest.ts` as plain text (no TS toolchain
 * required at runtime) and writes `docs/security/secrets-manifest.json`,
 * a metadata-only snapshot suitable for SOC 2 / ISO 27001 evidence
 * collection and for publication in the Trust Center.
 *
 * NEVER includes secret values. NEVER includes runtime rotation
 * timestamps (those live in the database — query the
 * `public.secret_inventory` view instead).
 *
 * The companion test `tests/unit/lib/secrets-manifest-json.test.ts`
 * asserts that the JSON on disk matches the current TS manifest;
 * regenerate via this script and commit when the manifest changes.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const SOURCE = resolve(REPO_ROOT, 'lib/secrets/manifest.ts')
const TARGET = resolve(REPO_ROOT, 'docs/security/secrets-manifest.json')

/**
 * Extract all `{ name: '...', tier: 'X', provider: '...', description: '...' }`
 * blocks from the SECRET_MANIFEST literal. We rely on the project's
 * formatting (one descriptor per multi-line object literal); this is
 * enforced by the prettier step in CI.
 */
function parseManifest(src) {
  const start = src.indexOf('export const SECRET_MANIFEST')
  if (start < 0) throw new Error('SECRET_MANIFEST literal not found')
  // Skip past the `=` to avoid matching the `SecretDescriptor[]` type annotation.
  const eq = src.indexOf('=', start)
  if (eq < 0) throw new Error('= not found after SECRET_MANIFEST')
  const open = src.indexOf('[', eq)
  if (open < 0) throw new Error('opening [ not found after SECRET_MANIFEST =')
  // Find the matching closing bracket of the array literal.
  let depth = 0
  let close = -1
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) throw new Error('matching ] for SECRET_MANIFEST not found')
  const body = src.slice(open + 1, close)

  const entries = []
  // Split by top-level `},` boundaries; entries are guaranteed to be
  // a single object literal each (prettier-enforced).
  const blockRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  for (const match of body.match(blockRegex) ?? []) {
    const get = (key) => {
      const m = match.match(new RegExp(`${key}\\s*:\\s*'([^']*)'`))
      return m ? m[1] : null
    }
    const getBool = (key) => {
      const m = match.match(new RegExp(`${key}\\s*:\\s*(true|false)`))
      return m ? m[1] === 'true' : false
    }
    const name = get('name')
    if (!name) continue
    entries.push({
      name,
      tier: get('tier'),
      provider: get('provider'),
      description: get('description'),
      invalidates_sessions: getBool('invalidatesSessions'),
      destroys_data_at_rest: getBool('destroysDataAtRest'),
      has_siblings: getBool('hasSiblings'),
    })
  }
  return entries
}

function parseTierAges(src) {
  const m = src.match(/TIER_MAX_AGE_DAYS[\s\S]*?\{([\s\S]*?)\}/)
  if (!m) throw new Error('TIER_MAX_AGE_DAYS not found')
  const out = {}
  for (const line of m[1].split('\n')) {
    const lm = line.match(/([ABC])\s*:\s*(\d+)/)
    if (lm) out[lm[1]] = Number(lm[2])
  }
  return out
}

function buildManifest(secrets, tierAges) {
  const counts = secrets.reduce((acc, s) => {
    acc[s.tier] = (acc[s.tier] ?? 0) + 1
    return acc
  }, {})

  return {
    $schema:
      'https://clinipharma.com.br/schemas/secrets-manifest-v1.json (informational)',
    version: '1.0',
    generated_at: new Date().toISOString(),
    generated_by: 'scripts/secrets/export-manifest.mjs',
    source_of_truth: 'lib/secrets/manifest.ts',
    description:
      'Metadata-only inventory of every secret the platform tracks for ' +
      'rotation. Runtime freshness (last_rotated_at, age_days) is in the ' +
      'database (see `public.secret_inventory`) and exposed by ' +
      '/api/health/deep#secretRotation.',
    policy: {
      tier_max_age_days: tierAges,
      automatic_rotation_tiers: ['A'],
      assisted_rotation_tiers: ['B'],
      manual_only_tiers: ['C'],
      schedule: {
        cron_expression: '0 4 * * 0',
        timezone: 'UTC',
        human_readable: 'Sunday 04:00 UTC (01:00 BRT)',
        endpoint: '/api/cron/rotate-secrets',
      },
      auditability: {
        ledger_table: 'secret_rotation_record',
        chain_view: 'secret_inventory',
        hash_chain: 'sha256 (pre-image: prev_row_hash || row_payload)',
        retention_years: 5,
      },
      runbooks: {
        scheduled_rotation: 'docs/runbooks/secret-rotation.md',
        incident_response: 'docs/runbooks/secret-compromise.md',
      },
      feature_flags: {
        'secrets.auto_rotate_tier_a':
          'When ON, Tier A secrets are auto-rotated by the cron. Default OFF in production until first attended drill.',
        'secrets.rotation_enforce':
          'When ON, overdue Tier B/C alerts escalate to CRITICAL severity.',
      },
    },
    summary: {
      total_secrets: secrets.length,
      by_tier: counts,
      with_session_invalidation: secrets.filter((s) => s.invalidates_sessions).length,
      with_data_at_rest_impact: secrets.filter((s) => s.destroys_data_at_rest).length,
      with_siblings: secrets.filter((s) => s.has_siblings).length,
    },
    secrets,
  }
}

function main() {
  const src = readFileSync(SOURCE, 'utf8')
  const secrets = parseManifest(src)
  const tierAges = parseTierAges(src)
  if (secrets.length === 0) {
    throw new Error('parsed 0 secrets — refusing to write empty manifest')
  }
  const manifest = buildManifest(secrets, tierAges)
  mkdirSync(dirname(TARGET), { recursive: true })
  writeFileSync(TARGET, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(
    `wrote ${TARGET}\n  secrets=${secrets.length}  tiers=${JSON.stringify(manifest.summary.by_tier)}`,
  )
}

main()
