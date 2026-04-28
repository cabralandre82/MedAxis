// @vitest-environment node
/**
 * Migration 060 — shape invariants.
 *
 * We can't run an ephemeral Postgres in this unit-test loop, so the
 * test asserts the SQL DDL still has the four properties that make
 * the trigger correct:
 *
 *   1. The function is `SECURITY DEFINER` — without this the trigger
 *      cannot UPDATE `public.profiles` because the auth ban is
 *      executed as `supabase_auth_admin`.
 *   2. The trigger is on `auth.users`, column `banned_until`, AFTER
 *      UPDATE, with the WHEN clause that gates on a real value
 *      change (so we never pay the cost on unrelated UPDATEs).
 *   3. `search_path` is hard-pinned (no implicit `public`-shadowing
 *      attacks via session-level `SET search_path`).
 *   4. The backfill runs and the migration ships a smoke test that
 *      raises an exception if drift remains.
 *
 * If the SQL is reformatted in a way that breaks any of these
 * properties, this test catches it before the migration runs in
 * production.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/060_profile_active_mirror_from_auth.sql'
)

describe('migration 060 — profile active mirror', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')

  it('declares the trigger function as SECURITY DEFINER', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sync_profile_is_active_from_auth/i
    )
    expect(sql).toMatch(/SECURITY\s+DEFINER/i)
  })

  it('hard-pins search_path on the function', () => {
    // Mirrors the pattern from migrations 056/057: the function MUST
    // pin search_path explicitly, otherwise a session-level
    // `SET search_path` could redirect `public.profiles` to a
    // schema-shadowed table planted by a malicious extension.
    expect(sql).toMatch(/SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i)
  })

  it('binds the trigger to UPDATE OF banned_until on auth.users', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+sync_profile_is_active_on_auth_update[\s\S]+?AFTER\s+UPDATE\s+OF\s+banned_until\s+ON\s+auth\.users/i
    )
  })

  it('gates on actual column change via WHEN clause', () => {
    // We don't want the trigger to fire on every auth.users UPDATE
    // (password resets, email confirms, …) — only when banned_until
    // really changed. The WHEN clause delivers exactly that.
    expect(sql).toMatch(
      /WHEN\s*\(\s*OLD\.banned_until\s+IS\s+DISTINCT\s+FROM\s+NEW\.banned_until\s*\)/i
    )
  })

  it('treats expired bans as inactive→active (banned_until < now())', () => {
    // The semantics of banned_until in Supabase auth: a row is banned
    // UNTIL that timestamp. Once it's in the past, the user is no
    // longer banned. The trigger MUST encode that or stale bans will
    // permanently lock profiles inactive.
    expect(sql).toMatch(
      /(NEW\.|u\.)?banned_until\s+IS\s+NULL\s+OR\s+(NEW\.|u\.)?banned_until\s*<\s*now\(\)/i
    )
  })

  it('backfills drift in a single bounded UPDATE', () => {
    expect(sql).toMatch(
      /UPDATE\s+public\.profiles\s+p[\s\S]+?FROM\s+auth\.users\s+u[\s\S]+?WHERE\s+u\.id\s*=\s*p\.id[\s\S]+?IS\s+DISTINCT\s+FROM/i
    )
  })

  it('ships a smoke test that raises on drift after install', () => {
    // The smoke test is what makes the migration self-verifying.
    expect(sql).toMatch(/SMOKE FAIL 060/)
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i)
    expect(sql).toMatch(/RAISE\s+NOTICE\s+'Migration 060 smoke OK/i)
  })

  it('grants EXECUTE to supabase_auth_admin (the trigger executor)', () => {
    // The trigger fires under the auth admin role. Even though
    // SECURITY DEFINER swaps to the function owner for the body, the
    // dispatch still requires EXECUTE on the function.
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sync_profile_is_active_from_auth\(\)\s+TO\s+supabase_auth_admin/i
    )
  })
})
