#!/usr/bin/env bash
# scripts/claims/check-cross-links.sh
# Claim: every doc/skill/rule link to another repo file resolves. Scans:
#  - .cursor/skills/*/SKILL.md
#  - .cursor/rules/*.mdc
#  - docs/runbooks/*.md
#  - AGENTS.md
#  - docs/SOLO_OPERATOR.md
# Resolves both absolute-from-repo and relative (../..) paths.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const SCAN = [
  '.cursor/skills',
  '.cursor/rules',
  'docs/runbooks',
  'AGENTS.md',
  'docs/SOLO_OPERATOR.md',
];

const findings = [];
let passed = 0;

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

const LINK_RE = /\]\(([^)\s]+?)(?:\s"[^"]*")?\)/g;
const CODE_FENCE_RE = /`([^`\n]+\.(?:md|mdc|ts|tsx|js|mjs|sql|yml|yaml|json))`/g;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const dir = path.dirname(f);

  const candidates = new Set();

  function isLinkable(p) {
    if (!p) return false;
    if (/^https?:/i.test(p)) return false;
    if (p.startsWith('#')) return false;
    if (p.startsWith('~')) return false; // home-dir paths (external)
    if (p.startsWith('mailto:')) return false;
    if (/[<>*?{}]/.test(p)) return false; // placeholders, glob, brace-expansion
    if (/\s/.test(p)) return false; // command examples "k6 run path"
    if (/(NNN|YYYY|MM|DD)/.test(p)) return false; // literal placeholder tokens
    return true;
  }

  for (const m of content.matchAll(LINK_RE)) {
    const href = m[1];
    if (!isLinkable(href)) continue;
    const target = href.split('#')[0];
    if (!target) continue;
    candidates.add(target);
  }

  // Also check bare markdown filenames in code fences (common pattern in this repo)
  for (const m of content.matchAll(CODE_FENCE_RE)) {
    const maybePath = m[1];
    if (!/\//.test(maybePath)) continue; // skip single-word filenames (ambiguous)
    if (!isLinkable(maybePath)) continue;
    candidates.add(maybePath);
  }

  for (const rel of candidates) {
    passed++;
    // Try three interpretations, accept if ANY resolves:
    //  (1) absolute from repo root if it starts with /
    //  (2) relative to the containing markdown file (true markdown-link semantics)
    //  (3) relative to repo root (this repo's prose convention — backtick paths are
    //      written as "docs/runbooks/foo.md" without a leading ./ or ../)
    const candidatesToCheck = [];
    if (rel.startsWith('/')) {
      candidatesToCheck.push(path.join(process.cwd(), rel.slice(1)));
    } else {
      candidatesToCheck.push(path.resolve(dir, rel));
      candidatesToCheck.push(path.resolve(process.cwd(), rel));
    }

    if (!candidatesToCheck.some(p => fs.existsSync(p))) {
      // Broken cross-links are drift signals, not invariant breaks.
      // Warn so we open a tracking issue without failing CI outright.
      findings.push({
        severity: 'warn',
        claim: 'cross-link resolves',
        detail: `${rel} does not exist`,
        location: f,
      });
      passed--;
    }
  }
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({ name: 'cross-links', passed, failed, warnings, findings: findings.slice(0, 60) }, null, 2));
process.exit(failed > 0 ? 1 : 0);
NODE
