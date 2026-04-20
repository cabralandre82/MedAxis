#!/usr/bin/env node
// scripts/claims/check-cron-claims.mjs
// Claim: every /api/cron/<name> path mentioned in runbooks / skills / rules exists
// in vercel.json AND has a corresponding route file at app/api/cron/<name>/route.ts.
// Reverse: every cron declared in vercel.json is referenced by at least one doc.
//
// Pure-Node implementation (no ripgrep dependency) — runs on a vanilla CI image.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const declaredCrons = new Set((vercel.crons || []).map(c => c.path));

const SCAN = [
  'docs/runbooks',
  '.cursor/skills',
  '.cursor/rules',
  'AGENTS.md',
  'docs/SOLO_OPERATOR.md',
];

function walk(p, acc = []) {
  if (!fs.existsSync(p)) return acc;
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (/\.(md|mdc)$/.test(p)) acc.push(p);
    return acc;
  }
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), acc);
  return acc;
}

const files = SCAN.flatMap(s => walk(s));

const mentioned = new Map(); // path → Set(location)
const CRON_RE = /\/api\/cron\/[a-z0-9-]+/g;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  for (const m of content.matchAll(CRON_RE)) {
    const p = m[0];
    if (!mentioned.has(p)) mentioned.set(p, new Set());
    mentioned.get(p).add(f);
  }
}

// Forward: every mentioned cron must be declared + have a route file.
for (const [cronPath, locations] of mentioned) {
  passed++;

  if (!declaredCrons.has(cronPath)) {
    findings.push({
      severity: 'fail',
      claim: 'mentioned cron exists in vercel.json',
      detail: `${cronPath} referenced in docs but not in vercel.json crons`,
      location: [...locations].slice(0, 3).join(', '),
    });
    passed--;
    continue;
  }

  const routeFile = `app${cronPath}/route.ts`;
  if (!fs.existsSync(routeFile)) {
    findings.push({
      severity: 'fail',
      claim: 'cron route file exists',
      detail: `expected ${routeFile}`,
      location: [...locations].slice(0, 3).join(', '),
    });
    passed--;
  }
}

// Reverse: every declared cron should be mentioned somewhere (warn — might indicate
// dead cron or missing documentation).
for (const cronPath of declaredCrons) {
  if (!mentioned.has(cronPath)) {
    findings.push({
      severity: 'warn',
      claim: 'declared cron is documented',
      detail: `${cronPath} in vercel.json but not referenced in any runbook/skill`,
      location: 'vercel.json',
    });
  }
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({ name: 'cron-claims', passed, failed, warnings, findings }, null, 2));
process.exit(failed > 0 ? 1 : 0);
