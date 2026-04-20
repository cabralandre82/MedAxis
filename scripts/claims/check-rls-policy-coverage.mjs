#!/usr/bin/env node
// scripts/claims/check-rls-policy-coverage.mjs
// Claim: every table in schema `public` has at least one `CREATE POLICY`,
// OR an explicit `-- @rls-policy: <justification>` marker declaring
// intentional deny-all / service-role-only access.
//
// Why this matters:
//   Migration 057 installed an event trigger that auto-enables RLS on
//   every new `public` table. That's a great safety net — but RLS
//   enabled without any policy is **deny-all**: every authenticated
//   query returns zero rows silently. For tenant-scoped tables, that
//   looks like "the feature is broken"; for audit-style tables that
//   should be service_role-only, deny-all is exactly what we want.
//
//   This verifier forces the distinction to be explicit. Without a
//   policy AND without a marker, the table is drift.
//
// Marker format (anywhere in any migration):
//   -- @rls-policy(table_name): service_role-only
//   -- @rls-policy(table_name): admin-only-via-rpc
//   -- @rls-policy(table_name): deny-all-by-design
//   -- @rls-policy(table_name): <free text justification>
//
// The table name is embedded in the marker itself (not inferred by
// proximity) so attribution is deterministic and reviewer-friendly.
//
// Severity contract:
//   - fail — table exists in public, has no policy, and has no marker.
//   - pass — table has ≥ 1 policy, OR has an explicit marker.
//
// Pure-Node implementation — no external deps.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}

// SQL keywords that look like identifiers but aren't real tables.
const RESERVED = new Set([
  'as', 'in', 'if', 'from', 'when', 'then', 'select', 'with', 'on',
  'where', 'and', 'or', 'not', 'is', 'like', 'between', 'exists',
]);

// Mask SQL comments (`-- ...`) and single-quoted string literals with
// same-length spaces. Keeping byte positions identical to `raw` means
// match indexes from the masked version line up 1:1 with marker
// indexes from `raw`, which matters when we attribute markers to
// their nearest table reference.
//
// Note: we mask, not strip, because:
//   - Comments must disappear from the SQL-statement scan (so
//     `CREATE TABLE in ``public``` in a top-of-file block doesn't
//     register as a table named `in`).
//   - String literals must disappear too (so `'058 smoke: COMMENT ON
//     TABLE public.%'` doesn't register as a table named `public`).
//   - But marker scan (`-- @rls-policy:`) obviously needs the raw text.
//
// So we keep both strings; they share the same positions.
function maskSql(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      const end = nl < 0 ? sql.length : nl;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      out += ' ';
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += '  '; i += 2; continue; }
        if (sql[i] === "'") { out += ' '; i++; break; }
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

// ── 1. Collect tables declared in public ──────────────────────────────────
const MIGRATIONS_DIR = 'supabase/migrations';
if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.log(JSON.stringify({
    name: 'rls-policy-coverage',
    passed: 0, failed: 0, warnings: 0, findings: [],
  }, null, 2));
  process.exit(0);
}

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

// Require CREATE TABLE at a statement boundary (start of file or after ;).
// Reject public.X where X is a reserved word (from constructs like
// `CREATE TABLE AS` in trigger function bodies that live inside strings).
const RE_CREATE_TABLE = /(?:^|;)\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gim;
const RE_DROP_TABLE   = /(?:^|;)\s*drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gim;

// Policy regex — policy name can be a bare identifier OR a double/single-
// quoted string containing spaces. Table name comes after `ON [public.]`.
const RE_CREATE_POLICY = /create\s+policy\s+(?:"[^"]+"|'[^']+'|[a-z_][a-z0-9_]*)\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)/gim;

// Marker: `-- @rls-policy(table_name): justification` — the table name
// is captured explicitly so there's no ambiguity about which table the
// marker refers to.
const RE_MARKER = /--\s*@rls-policy\(\s*([a-z_][a-z0-9_]*)\s*\)\s*:\s*([^\n]+)/gi;

const tables   = new Map(); // name → first declaring migration
const policies = new Map(); // name → [migration]
const markers  = new Map(); // name → { justification, file }

for (const f of files) {
  const raw    = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
  const masked = maskSql(raw);

  for (const m of masked.matchAll(RE_CREATE_TABLE)) {
    const t = m[1].toLowerCase();
    if (RESERVED.has(t)) continue;
    if (!tables.has(t)) tables.set(t, f);
  }

  for (const m of masked.matchAll(RE_CREATE_POLICY)) {
    const t = m[1].toLowerCase();
    if (RESERVED.has(t)) continue;
    if (!policies.has(t)) policies.set(t, []);
    policies.get(t).push(f);
  }

  // Marker scan: each `-- @rls-policy(table_name): ...` comment carries
  // its own target table name, so attribution is a direct capture —
  // no proximity heuristic needed.
  for (const m of raw.matchAll(RE_MARKER)) {
    const target = m[1].toLowerCase();
    const just   = m[2].trim();
    if (!markers.has(target)) {
      markers.set(target, { justification: just, file: f });
    }
  }
}

// Honor DROP TABLE (dropped tables are no longer our problem).
for (const f of files) {
  const masked = maskSql(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  for (const m of masked.matchAll(RE_DROP_TABLE)) {
    const t = m[1].toLowerCase();
    if (RESERVED.has(t)) continue;
    tables.delete(t);
  }
}

// ── 2. Cross-reference ────────────────────────────────────────────────────
for (const [t, firstDecl] of [...tables.entries()].sort()) {
  if (policies.has(t)) {
    passed++;
    continue;
  }
  if (markers.has(t)) {
    passed++;
    continue;
  }
  fail(
    'table in public has RLS policy or explicit deny-all marker',
    `'${t}' has no CREATE POLICY and no "-- @rls-policy(${t}): ..." marker — RLS is enabled (event trigger) but deny-all-by-silence is drift; either add at least one policy, or add an explicit marker with justification (see migration 058 for the reference pattern)`,
    `supabase/migrations/${firstDecl}`
  );
}

const failed = findings.filter(f => f.severity === 'fail').length;
const warnings = 0;

console.log(JSON.stringify({
  name: 'rls-policy-coverage',
  passed,
  failed,
  warnings,
  findings,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
