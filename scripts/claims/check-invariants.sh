#!/usr/bin/env bash
# scripts/claims/check-invariants.sh
# Claim: a subset of AGENTS.md invariants can be machine-verified against the
# actual codebase. If code regressed vs. the documented invariant, we want a
# loud signal — otherwise the invariant is a lie.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

node <<'NODE'
const fs = require('fs');
const { execSync } = require('node:child_process');

const findings = [];
let passed = 0;

function pass(claim) { passed++; }
function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}
function warn(claim, detail, location) {
  findings.push({ severity: 'warn', claim, detail, location });
}
function exists(p) { return fs.existsSync(p); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

// Pure-Node grep replacement — returns matching lines as "path:line:content".
function grep(pattern, roots, excludeDirs = []) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  const matches = [];
  function visit(p) {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isFile()) {
      // Only scan source-ish files
      if (!/\.(ts|tsx|js|mjs|sql|md|mdc|yml|yaml)$/.test(p)) return;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) matches.push(`${p}:${i + 1}:${lines[i]}`);
      }
      return;
    }
    if (st.isDirectory()) {
      const base = require('path').basename(p);
      if (excludeDirs.includes(base)) return;
      for (const e of fs.readdirSync(p)) visit(require('path').join(p, e));
    }
  }
  for (const r of roots) visit(r);
  return matches;
}

// --- Invariant 2: AES-256-GCM + ENCRYPTION_KEY ---
if (exists('lib/crypto.ts')) {
  const src = read('lib/crypto.ts');
  if (!/aes-256-gcm/i.test(src)) {
    fail('crypto uses AES-256-GCM', "lib/crypto.ts missing 'aes-256-gcm' string", 'lib/crypto.ts');
  } else pass();
  if (!/ENCRYPTION_KEY/.test(src)) {
    fail('crypto reads ENCRYPTION_KEY', "lib/crypto.ts never references process.env.ENCRYPTION_KEY", 'lib/crypto.ts');
  } else pass();
} else {
  fail('lib/crypto.ts present', 'file missing', 'lib/crypto.ts');
}

// --- Invariant 3/4: CSP + nonce + no unsafe-inline in script-src ---
if (exists('lib/security/csp.ts')) {
  const src = read('lib/security/csp.ts');
  if (/script-src[^;]*unsafe-inline/i.test(src)) {
    fail("no 'unsafe-inline' in script-src", 'lib/security/csp.ts contains unsafe-inline in script-src directive', 'lib/security/csp.ts');
  } else pass();
  if (!/nonce/i.test(src)) {
    warn('CSP uses nonce', "lib/security/csp.ts doesn't reference nonce", 'lib/security/csp.ts');
  } else pass();
} else {
  fail('lib/security/csp.ts present', 'file missing', 'lib/security/csp.ts');
}

// --- Invariant 5: audit_logs is append-only (no raw DELETE/UPDATE outside migrations/audit infra) ---
const auditRoots = ['app', 'lib', 'components', 'scripts', 'services'];
const auditHits = grep(
  /\b(delete\s+from|update)\s+(public\.)?audit_logs\b/i,
  auditRoots,
  ['node_modules', '.next', 'audit']
).filter(h => {
  // exclude lib/audit/** and test files
  if (/\blib\/audit\b/.test(h)) return false;
  if (/\.test\.(ts|tsx|js|mjs)/.test(h)) return false;
  if (/\/tests?\//.test(h)) return false;
  return true;
});
if (auditHits.length > 0) {
  fail('audit_logs is append-only', `raw DELETE/UPDATE on audit_logs found outside lib/audit/`, auditHits[0]);
} else pass();

// --- Invariant 6: CSRF double-submit cookie + __Host-csrf ---
if (exists('lib/security/csrf.ts')) {
  const src = read('lib/security/csrf.ts');
  if (!/__Host-csrf/.test(src)) {
    warn('CSRF uses __Host-csrf cookie', "lib/security/csrf.ts doesn't reference __Host-csrf", 'lib/security/csrf.ts');
  } else pass();
} else {
  fail('lib/security/csrf.ts present', 'file missing', 'lib/security/csrf.ts');
}

// --- Invariant 7: money is cents (bigint) ---
if (exists('lib/money.ts')) {
  const src = read('lib/money.ts');
  if (!/bigint|\bcents\b/i.test(src)) {
    warn('lib/money.ts uses cents/bigint', 'no cents/bigint vocabulary found', 'lib/money.ts');
  } else pass();
} else {
  fail('lib/money.ts present', 'file missing', 'lib/money.ts');
}

// --- Invariant 8: migrations are append-only (no edits to existing SHA → out of scope here) ---
if (exists('supabase/migrations/057_rls_auto_enable_safety_net.sql')) {
  pass();
} else {
  warn('RLS safety-net migration exists', 'supabase/migrations/057_rls_auto_enable_safety_net.sql missing', 'supabase/migrations/');
}

// --- Invariant (Wave 15): X-Powered-By stripped in next.config.ts ---
if (exists('next.config.ts')) {
  const src = read('next.config.ts');
  if (!/poweredByHeader\s*:\s*false/.test(src)) {
    fail('X-Powered-By header stripped', 'next.config.ts missing poweredByHeader: false', 'next.config.ts');
  } else pass();
} else {
  fail('next.config.ts present', 'file missing', 'next.config.ts');
}

// --- Invariant 15: mutation testing threshold 84% ---
if (exists('stryker.config.mjs')) {
  const src = read('stryker.config.mjs');
  const m = src.match(/break\s*:\s*(\d+)/);
  if (!m || parseInt(m[1], 10) < 84) {
    fail('Stryker break threshold >= 84', m ? `break=${m[1]}` : 'no break threshold', 'stryker.config.mjs');
  } else pass();
} else {
  warn('stryker.config.mjs present', 'mutation-test config missing', 'stryker.config.mjs');
}

// --- Claim: 19 crons declared (matches AGENTS.md / SOLO_OPERATOR.md narrative) ---
if (exists('vercel.json')) {
  const v = JSON.parse(read('vercel.json'));
  const count = (v.crons || []).length;
  if (count === 0) {
    fail('crons declared in vercel.json', 'zero crons found', 'vercel.json');
  } else if (count < 15) {
    warn('cron count reasonable', `only ${count} crons declared (solo-operator docs claim ~16+)`, 'vercel.json');
  } else pass();
} else {
  fail('vercel.json present', 'file missing', 'vercel.json');
}

// --- Claim: required workflows exist ---
const requiredWorkflows = [
  'ci.yml',
  'cost-guard.yml',
  'external-probe.yml',
  'mutation-test.yml',
  'offsite-backup.yml',
  'restore-drill.yml',
  'schema-drift.yml',
  'zap-baseline.yml',
];
for (const wf of requiredWorkflows) {
  const p = `.github/workflows/${wf}`;
  if (!exists(p)) {
    fail(`workflow ${wf} exists`, 'file missing', p);
  } else pass();
}

// --- Claim: every skill directory has a SKILL.md ---
if (exists('.cursor/skills')) {
  for (const d of fs.readdirSync('.cursor/skills', { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = `.cursor/skills/${d.name}/SKILL.md`;
    if (!exists(p)) {
      fail(`skill ${d.name} has SKILL.md`, 'missing', p);
    } else pass();
  }
}

// --- Claim: every .cursor/rules/*.mdc has frontmatter with description ---
if (exists('.cursor/rules')) {
  for (const f of fs.readdirSync('.cursor/rules')) {
    if (!f.endsWith('.mdc')) continue;
    const p = `.cursor/rules/${f}`;
    const src = read(p);
    if (!src.startsWith('---')) {
      fail(`rule ${f} has frontmatter`, 'no --- delimiter', p);
      continue;
    }
    if (!/^description:\s*\S+/m.test(src)) {
      warn(`rule ${f} has description`, 'description missing in frontmatter', p);
      continue;
    }
    pass();
  }
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({ name: 'invariants', passed, failed, warnings, findings }, null, 2));
process.exit(failed > 0 ? 1 : 0);
NODE
