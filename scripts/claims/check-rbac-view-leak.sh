#!/usr/bin/env bash
# scripts/claims/check-rbac-view-leak.sh
#
# Claim under verification
# ------------------------
# "No pharmacy-facing surface renders sales price (`price_current`,
#  `unit_price`, `total_price`) without first deciding via the central
#  view-mode helper (`lib/orders/view-mode.ts`) whether the current user
#  may see it."
#
# Why this script exists
# ----------------------
# The 2026-04-28 regression audit (`docs/compliance/regression-audit-2026-04-28.md`)
# found 4 places where the sales price leaked to PHARMACY_ADMIN users:
# `/orders` list, `/orders/[id]` detail, `/products`, `/my-pharmacy`.
# The cause-root was *not* a single bug — it was the absence of a
# central RBAC-view helper, so each new component reinvented the rule
# (and one always forgot it).
#
# Onda 1 created `lib/orders/view-mode.ts` and wired the four offenders.
# This script is the permanent guardrail: any future component placed in
# a pharmacy-facing surface that touches `price_current` / `unit_price`
# / `total_price` MUST also import the helper or carry an explicit
# `isPharmacyAdmin` (or equivalent) gate. Otherwise we fail the claims
# audit and the regression bites again.
#
# Heuristic (deliberately permissive — tuned for low false-positive)
# ------------------------------------------------------------------
# • A file under one of the pharmacy-facing surface globs that
#   references any of the leaky fields…
# • …MUST contain *one* of these gate markers, anywhere in the file:
#
#     - `from '@/lib/orders/view-mode'`
#     - `visibleLineTotal` / `visibleOrderTotal` / `visibleUnitAmount`
#     - `priceColumnLabel` / `unitColumnLabel`
#     - `isPharmacyView` / `viewMode`
#     - `isPharmacyAdmin` / `isPharmacy`         (explicit role gate)
#     - `// @rbac-view: ok — <reason>`           (escape hatch w/ rationale)
#
# That covers (a) components/pages that import the helper, (b) forms
# that already carried an explicit pharmacy gate before view-mode existed,
# and (c) cases an operator legitimately needs to bypass with a clear
# comment trail.
#
# JSON contract: `{ name, passed, failed, warnings, findings: [...] }`
# matches `scripts/claims/run-all.sh`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

node <<'NODE'
const fs = require('fs');
const path = require('path');

// --- Pharmacy-facing surfaces -----------------------------------------------
// Anything in these directories is rendered for pharmacy users at some point.
// Note: `components/catalog/*` is buyer-only (clinics/doctors) and is
// deliberately NOT listed here. `components/dashboard/clinic-dashboard.tsx`
// is buyer-only too. Add a new directory here whenever a new pharmacy view
// is introduced.
const SURFACE_DIRS = [
  'app/(private)/orders',
  'app/(private)/products',
  'app/(private)/my-pharmacy',
  'app/(private)/transfers',
  'components/orders',
  'components/products',
  'components/transfers',
];

// Files that are explicitly pharmacy-facing even though they live in a
// shared dashboard directory.
const SURFACE_FILES = [
  'components/dashboard/pharmacy-dashboard.tsx',
];

// --- Leaky fields to watch ---------------------------------------------------
// We grep for property access (`.price_current`, `.unit_price`, etc.) and
// for the bare identifier so we catch destructuring (`const { price_current } = …`).
const LEAK_PATTERNS = [
  /\.\s*price_current\b/,
  /\.\s*unit_price\b/,
  /\.\s*total_price\b/,
  /\bprice_current\s*[:,}]/,
  /\bunit_price\s*[:,}]/,
  /\btotal_price\s*[:,}]/,
];

// --- Gates that prove the file already obeys the RBAC contract --------------
const GATE_PATTERNS = [
  /from\s+['"]@\/lib\/orders\/view-mode['"]/,
  /\bvisibleLineTotal\b/,
  /\bvisibleOrderTotal\b/,
  /\bvisibleUnitAmount\b/,
  /\bpriceColumnLabel\b/,
  /\bunitColumnLabel\b/,
  /\bisPharmacyView\b/,
  /\bresolveViewMode\b/,
  /\bviewMode\b/,
  /\bisPharmacyAdmin\b/,
  /\bisPharmacy\b/,
  /@rbac-view:\s*ok/i,
];

const findings = [];
let passed = 0;
const fail = (claim, detail, location) =>
  findings.push({ severity: 'fail', claim, detail, location });

function walk(root, out) {
  if (!fs.existsSync(root)) return;
  const st = fs.statSync(root);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(root)) out.push(root);
    return;
  }
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(root)) walk(path.join(root, e), out);
  }
}

const surfaceFiles = new Set();
for (const dir of SURFACE_DIRS) {
  const collected = [];
  walk(dir, collected);
  for (const f of collected) surfaceFiles.add(f);
}
for (const f of SURFACE_FILES) {
  if (fs.existsSync(f)) surfaceFiles.add(f);
}

// Files we deliberately exclude even though they live in a surface dir.
// Tests under any of those dirs: out of scope (they intentionally use the raw
// values to assert the helper output).
const isOutOfScope = (f) =>
  /\/__tests__\//.test(f) ||
  /\.test\.(ts|tsx)$/.test(f) ||
  /\.spec\.(ts|tsx)$/.test(f) ||
  /\.stories\.(ts|tsx)$/.test(f);

let scanned = 0;
let leaks = 0;

for (const file of [...surfaceFiles].sort()) {
  if (isOutOfScope(file)) continue;
  const src = fs.readFileSync(file, 'utf8');

  // Strip comments to avoid matching `// uses unit_price` in docstrings.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');

  const leaky = LEAK_PATTERNS.some((rx) => rx.test(codeOnly));
  scanned++;
  if (!leaky) {
    passed++;
    continue;
  }

  // Run gate detection against the ORIGINAL source so the `// @rbac-view: ok`
  // escape hatch is recognised.
  const gated = GATE_PATTERNS.some((rx) => rx.test(src));
  if (gated) {
    passed++;
    continue;
  }

  // Find the first offending line for a useful error pointer.
  const lines = src.split('\n');
  let firstHit = '';
  for (let i = 0; i < lines.length; i++) {
    if (LEAK_PATTERNS.some((rx) => rx.test(lines[i]))) {
      firstHit = `${file}:${i + 1}: ${lines[i].trim().slice(0, 160)}`;
      break;
    }
  }
  leaks++;
  fail(
    'pharmacy-facing surface gates sales-price fields',
    `file references price_current/unit_price/total_price but does NOT import lib/orders/view-mode nor carry an isPharmacy/isPharmacyAdmin gate. Either wire the helper or add a '// @rbac-view: ok — <reason>' comment with rationale.`,
    firstHit || file,
  );
}

const failed = findings.filter((f) => f.severity === 'fail').length;
const warnings = findings.filter((f) => f.severity === 'warn').length;

console.log(JSON.stringify({
  name: 'rbac-view-leak',
  passed,
  failed,
  warnings,
  findings,
  meta: { scanned, leaks },
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
NODE
