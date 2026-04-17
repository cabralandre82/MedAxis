/**
 * PII Encryption Migration Script
 *
 * Encrypts existing plaintext values for:
 *   - profiles.phone          → profiles.phone_encrypted
 *   - doctors.crm             → doctors.crm_encrypted
 *   - registration_requests.form_data → registration_requests.form_data_encrypted
 *
 * Safe to run multiple times (idempotent — only processes rows where *_encrypted IS NULL).
 *
 * Usage:
 *   ENCRYPTION_KEY=<hex> SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     npx tsx scripts/migrate-pii-encryption.ts
 *
 * Or with .env.local:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-pii-encryption.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as nodeCrypto from 'crypto'

// ── Inline encrypt (no import from lib/crypto to avoid Next.js deps) ──────────

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (256 bits)')
  }
  return Buffer.from(hex, 'hex')
}

function encrypt(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  const key = getKey()
  const iv = nodeCrypto.randomBytes(IV_LENGTH)
  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

// ── Supabase admin client ─────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BATCH_SIZE = 100

// ── profiles.phone ────────────────────────────────────────────────────────────

async function migrateProfiles(): Promise<void> {
  console.log('\n── profiles.phone ──────────────────────────────────────────')
  let offset = 0
  let total = 0

  while (true) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, phone')
      .not('phone', 'is', null)
      .is('phone_encrypted', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.error('  Error fetching profiles:', error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const encrypted = encrypt(row.phone as string)
      const { error: updErr } = await admin
        .from('profiles')
        .update({ phone_encrypted: encrypted })
        .eq('id', row.id)

      if (updErr) {
        console.error(`  ✗ profiles ${row.id}:`, updErr.message)
      } else {
        total++
      }
    }

    console.log(`  Processed ${total} profiles so far...`)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  console.log(`  ✓ Done. Encrypted ${total} profiles.phone rows.`)
}

// ── doctors.crm ───────────────────────────────────────────────────────────────

async function migrateDoctors(): Promise<void> {
  console.log('\n── doctors.crm ─────────────────────────────────────────────')
  let offset = 0
  let total = 0

  while (true) {
    const { data, error } = await admin
      .from('doctors')
      .select('id, crm')
      .not('crm', 'is', null)
      .is('crm_encrypted', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.error('  Error fetching doctors:', error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const encrypted = encrypt(row.crm as string)
      const { error: updErr } = await admin
        .from('doctors')
        .update({ crm_encrypted: encrypted })
        .eq('id', row.id)

      if (updErr) {
        console.error(`  ✗ doctors ${row.id}:`, updErr.message)
      } else {
        total++
      }
    }

    console.log(`  Processed ${total} doctors so far...`)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  console.log(`  ✓ Done. Encrypted ${total} doctors.crm rows.`)
}

// ── registration_requests.form_data ───────────────────────────────────────────

async function migrateRegistrationRequests(): Promise<void> {
  console.log('\n── registration_requests.form_data ─────────────────────────')
  let offset = 0
  let total = 0

  while (true) {
    const { data, error } = await admin
      .from('registration_requests')
      .select('id, form_data')
      .not('form_data', 'is', null)
      .is('form_data_encrypted', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.error('  Error fetching registration_requests:', error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const json = JSON.stringify(row.form_data)
      const encrypted = encrypt(json)
      const { error: updErr } = await admin
        .from('registration_requests')
        .update({ form_data_encrypted: encrypted })
        .eq('id', row.id)

      if (updErr) {
        console.error(`  ✗ registration_requests ${row.id}:`, updErr.message)
      } else {
        total++
      }
    }

    console.log(`  Processed ${total} registration_requests so far...`)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }

  console.log(`  ✓ Done. Encrypted ${total} registration_requests.form_data rows.`)
}

// ── Summary ───────────────────────────────────────────────────────────────────

async function verifyCoverage(): Promise<void> {
  console.log('\n── Verification ─────────────────────────────────────────────')

  const [{ count: pTotal }, { count: pDone }] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }).not('phone', 'is', null),
    admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .not('phone_encrypted', 'is', null),
  ])
  console.log(`  profiles:              ${pDone ?? 0} / ${pTotal ?? 0} encrypted`)

  const [{ count: dTotal }, { count: dDone }] = await Promise.all([
    admin.from('doctors').select('*', { count: 'exact', head: true }).not('crm', 'is', null),
    admin
      .from('doctors')
      .select('*', { count: 'exact', head: true })
      .not('crm_encrypted', 'is', null),
  ])
  console.log(`  doctors:               ${dDone ?? 0} / ${dTotal ?? 0} encrypted`)

  const [{ count: rTotal }, { count: rDone }] = await Promise.all([
    admin
      .from('registration_requests')
      .select('*', { count: 'exact', head: true })
      .not('form_data', 'is', null),
    admin
      .from('registration_requests')
      .select('*', { count: 'exact', head: true })
      .not('form_data_encrypted', 'is', null),
  ])
  console.log(`  registration_requests: ${rDone ?? 0} / ${rTotal ?? 0} encrypted`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('PII Encryption Migration')
  console.log('========================')
  console.log(`Supabase: ${supabaseUrl}`)
  console.log(`Batch size: ${BATCH_SIZE}`)

  await migrateProfiles()
  await migrateDoctors()
  await migrateRegistrationRequests()
  await verifyCoverage()

  console.log('\n✅ Migration complete.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
