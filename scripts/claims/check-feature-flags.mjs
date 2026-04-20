#!/usr/bin/env node
// scripts/claims/check-feature-flags.mjs
// Claim: every feature_flags key referenced in runbooks/skills/rules is defined
// by at least one migration (INSERT INTO feature_flags or upsert_feature_flag).
//
// Pure-Node implementation — no ripgrep dependency.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

function walk(p, filter, acc = []) {
  if (!fs.existsSync(p)) return acc;
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (filter(p)) acc.push(p);
    return acc;
  }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), filter, acc);
  return acc;
}

// 1. Collect defined flag keys from migrations.
const defined = new Set();
const migrationFiles = walk('supabase/migrations', p => p.endsWith('.sql'));
const FLAG_KEY = /'([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)'/g;

for (const f of migrationFiles) {
  const sql = fs.readFileSync(f, 'utf8');

  // Strategy: find each `INSERT INTO feature_flags ... ;` statement block and
  // extract every namespaced quoted key inside it. Catches multi-row VALUES().
  const blockRe = /insert\s+into\s+(?:public\.)?feature_flags[\s\S]*?;/gi;
  for (const m of sql.matchAll(blockRe)) {
    for (const k of m[0].matchAll(FLAG_KEY)) defined.add(k[1]);
  }

  // Also: upsert_feature_flag('key', ...)
  const upsertRe = /upsert_feature_flag\s*\(\s*'([a-z][a-z0-9._-]{2,})'/gi;
  for (const m of sql.matchAll(upsertRe)) defined.add(m[1]);

  // Also: explicit updates to existing flags (treats them as "known")
  const updateRe = /update\s+(?:public\.)?feature_flags[\s\S]*?key\s*=\s*'([a-z][a-z0-9._-]{2,})'/gi;
  for (const m of sql.matchAll(updateRe)) defined.add(m[1]);
}

// 2. Collect referenced flag keys from docs/skills/rules/AGENTS.
const SCAN = [
  'docs/runbooks',
  '.cursor/skills',
  '.cursor/rules',
  'AGENTS.md',
  'docs/SOLO_OPERATOR.md',
];
const docFiles = SCAN.flatMap(s => walk(s, p => /\.(md|mdc)$/.test(p)));

const referenced = new Map(); // flag → first location
const REFS = [
  /key\s*=\s*'([a-z][a-z0-9._-]+)'/g, // SQL snippet
  /'([a-z][a-z0-9._-]+)'\s*,\s*enabled/g, // array-ish reference
  /feature_flags?[\s\S]{0,60}?['"]([a-z][a-z0-9._-]+)['"]/g, // prose mention
];

for (const f of docFiles) {
  const content = fs.readFileSync(f, 'utf8');
  for (const re of REFS) {
    for (const m of content.matchAll(re)) {
      const flag = m[1];
      if (!flag.includes('.')) continue; // real flag namespaces contain a dot
      if (flag.startsWith('docs.') || flag.startsWith('lib.')) continue; // path-like, not flag
      if (!referenced.has(flag)) referenced.set(flag, f);
    }
  }
}

// 3. Compare.
for (const [flag, loc] of referenced) {
  passed++;
  if (!defined.has(flag)) {
    findings.push({
      severity: 'fail',
      claim: 'referenced feature flag has migration',
      detail: `'${flag}' referenced but no migration in supabase/migrations/ defines it`,
      location: loc,
    });
    passed--;
  }
}

// 4. Bonus: flags defined but unreferenced (warn — possibly dead).
for (const flag of defined) {
  if (!referenced.has(flag)) {
    findings.push({
      severity: 'warn',
      claim: 'defined flag is used',
      detail: `'${flag}' exists in migrations but not referenced in any runbook/skill`,
      location: 'supabase/migrations/',
    });
  }
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(
  JSON.stringify(
    { name: 'feature-flags', passed, failed, warnings, findings: findings.slice(0, 50) },
    null,
    2
  )
);
process.exit(failed > 0 ? 1 : 0);
