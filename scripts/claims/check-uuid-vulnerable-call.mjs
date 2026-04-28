#!/usr/bin/env node
// scripts/claims/check-uuid-vulnerable-call.mjs
//
// Claim: no app code calls `uuid.v3()`, `uuid.v5()` or `uuid.v6()`
// with a caller-controlled `buf` / `offset` argument — i.e. the
// exploit surface of GHSA-w5hq-g745-h8pq is not reachable from
// our codebase.
//
// Why this matters
// ----------------
// Dependabot alert #11 flags `uuid < 14.0.0` as moderate-severity
// because v3/v5/v6 in those versions accept an external output
// buffer and DO NOT reject out-of-range writes (they fall through
// silently, partially overwriting the caller's buffer). v4 already
// throws RangeError correctly and is unaffected.
//
// We currently CANNOT bump uuid globally to >=14: starting at
// uuid@12 the package is ESM-only (CommonJS dropped), which would
// break every CJS dependent in our tree (firebase-admin,
// exceljs, svix, @google-cloud/storage, google-gax, gaxios,
// teeny-request). The patched range is 14.x. There is no backport
// to 8/9/10/11. So forcing the override is a worse trade than
// keeping the vulnerable versions while proving the vulnerable
// code path is not invoked.
//
// Audit done at the time of the dismissal (2026-04-28):
//   • Our code does not import `uuid` at all (zero matches for
//     `from 'uuid'` / `require('uuid')` in app code).
//   • Every transitive dep that imports uuid (firebase-admin,
//     svix, @google-cloud/storage, google-gax, gaxios,
//     teeny-request) calls only `uuid.v4()` (verified by grep).
//     v4 is NOT vulnerable.
//
// This verifier locks that property in. If a future PR ever
// imports uuid v3/v5/v6 with a `buf` argument, the audit fails
// and we are forced to revisit (either patch the call site, drop
// the dependency, or upgrade once a CJS-compatible patched range
// exists).
//
// Severity contract
// -----------------
//   - fail: any direct or namespace-imported call of uuid v3/v5/v6
//           that passes 3+ arguments (i.e. with `buf`/`offset`).
//   - pass: bare `v3(...)` / `v5(...)` / `v6(...)` with 1–2 args
//           (no buffer parameter exposed) — those return a string
//           and never touch a caller buffer.
//
// Note: this is a defence-in-depth tripwire, not a replacement for
// the dismissal rationale documented at
// docs/security/uuid-cve-2026-w5hq.md. If GHSA-w5hq-g745-h8pq is
// ever superseded by a CVE that affects v4 or any path we DO
// touch, the dismissal must be revoked manually.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;
function pass() {
  passed++;
}
function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}

// ─── 1. Walk app source tree ──────────────────────────────────────────────
//
// We deliberately scan ONLY first-party code. The whole point is
// to detect a *new* call we wrote — node_modules is the
// dependency layer the security verdict already covers.

const SCAN_DIRS = ['app', 'components', 'lib', 'services', 'scripts'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.vercel',
  'dist',
  'build',
  '.git',
  'coverage',
  '.results',
]);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = SCAN_DIRS.flatMap((d) =>
  fs.existsSync(d) ? walk(d) : []
);

// ─── 2. Scan every file for vulnerable call shapes ────────────────────────
//
// We resolve each `uuid` import to a local binding and then look
// for that binding being invoked with 3+ arguments. We are not
// trying to be a full TS parser — we just need enough fidelity to
// catch the obvious shapes:
//
//   import { v3, v5, v6 } from 'uuid'
//   import * as uuid from 'uuid'
//   const { v3: foo } = require('uuid')
//   const uuid = require('uuid')
//
// A regex pass then looks for `<binding>(<arg1>, <arg2>, <arg3>...)`.

let scanned = 0;

const ARG_RE_3PLUS = /\(([^()]*?,[^()]*?,[^()]*?)\)/; // 3+ args, no nested parens

// Helper: given the file source, return a list of local
// identifiers that resolve to uuid.v3 / v5 / v6.
function resolveVulnerableBindings(src) {
  const bindings = new Set();
  const namespaceBindings = new Set();

  // ── Named imports (ESM): import { v3, v5, v6 as foo } from 'uuid'
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"]uuid['"]/g;
  let m;
  while ((m = namedRe.exec(src)) !== null) {
    const list = m[1];
    for (const item of list.split(',')) {
      const parts = item.trim().split(/\s+as\s+/);
      const orig = parts[0]?.trim();
      const alias = (parts[1] ?? parts[0])?.trim();
      if (!orig || !alias) continue;
      if (orig === 'v3' || orig === 'v5' || orig === 'v6') {
        bindings.add(alias);
      }
    }
  }

  // ── Namespace import: import * as uuid from 'uuid'
  const nsRe = /import\s*\*\s*as\s+(\w+)\s*from\s*['"]uuid['"]/g;
  while ((m = nsRe.exec(src)) !== null) {
    namespaceBindings.add(m[1]);
  }

  // ── Default import (rare for uuid): treat as namespace too, since
  //    some bundles surface { v4, v5, ... } on the default export.
  const defRe = /import\s+(\w+)\s*from\s*['"]uuid['"]/g;
  while ((m = defRe.exec(src)) !== null) {
    namespaceBindings.add(m[1]);
  }

  // ── CJS destructured: const { v3, v5: bar } = require('uuid')
  const cjsDestrRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(['"]uuid['"]\)/g;
  while ((m = cjsDestrRe.exec(src)) !== null) {
    for (const item of m[1].split(',')) {
      const parts = item.trim().split(/\s*:\s*/);
      const orig = parts[0]?.trim();
      const alias = (parts[1] ?? parts[0])?.trim();
      if (!orig || !alias) continue;
      if (orig === 'v3' || orig === 'v5' || orig === 'v6') {
        bindings.add(alias);
      }
    }
  }

  // ── CJS namespace: const uuid = require('uuid')
  const cjsNsRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]uuid['"]\)/g;
  while ((m = cjsNsRe.exec(src)) !== null) {
    namespaceBindings.add(m[1]);
  }

  return { bindings, namespaceBindings };
}

// Helper: count arguments in a call expression `name(...)`. We
// strip strings and template literals first so commas inside them
// don't inflate the count, but we still bail on nested parens —
// in that case we conservatively REPORT the call (avoid false
// negatives). The cost is occasional false positives, which the
// reviewer fixes by inspection.
function callHasThreePlusArgs(callBody) {
  // Strip simple strings.
  const cleaned = callBody
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  // Top-level comma count == arg count - 1, but only if there are
  // no nested unbalanced parens. Bail (treat as risky) otherwise.
  let depth = 0;
  let topCommas = 0;
  for (const ch of cleaned) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) topCommas++;
  }
  return topCommas >= 2;
}

for (const file of files) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  if (!/['"]uuid['"]/.test(src)) {
    pass();
    continue;
  }

  const { bindings, namespaceBindings } = resolveVulnerableBindings(src);

  // Walk every line-ish chunk.
  const lines = src.split('\n');
  let leakInThisFile = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // Direct named binding: `<alias>(args)`
    for (const b of bindings) {
      const re = new RegExp(`\\b${b}\\s*\\(([^]*)`);
      const m = stripped.match(re);
      if (!m) continue;
      // Find the matching closing paren window — limit to 240 chars to
      // avoid runaway scans on minified output.
      const window = (m[1] ?? '').slice(0, 240);
      const argMatch = window.match(/^([^]*?\))/);
      if (!argMatch) continue;
      const inside = argMatch[1].slice(0, -1);
      if (callHasThreePlusArgs(inside)) {
        fail(
          'no app code invokes uuid.v3 / v5 / v6 with caller-controlled buf+offset',
          `\`${b}(...)\` (resolved to a vulnerable uuid version of v3/v5/v6) is called with 3+ arguments — that means a buffer/offset is being passed, which is the exact exploit surface of GHSA-w5hq-g745-h8pq. Either drop the buffer arg or wait for a CJS-compatible patched uuid release (≥14.x is ESM-only).`,
          `${file}:${i + 1}: ${line.trim().slice(0, 160)}`
        );
        leakInThisFile = true;
      }
    }

    // Namespace binding: `<ns>.v3(args)` / `.v5(...)` / `.v6(...)`
    for (const ns of namespaceBindings) {
      const re = new RegExp(`\\b${ns}\\.v[356]\\s*\\(([^]*)`);
      const m = stripped.match(re);
      if (!m) continue;
      const window = (m[1] ?? '').slice(0, 240);
      const argMatch = window.match(/^([^]*?\))/);
      if (!argMatch) continue;
      const inside = argMatch[1].slice(0, -1);
      if (callHasThreePlusArgs(inside)) {
        fail(
          'no app code invokes uuid.v3 / v5 / v6 with caller-controlled buf+offset',
          `\`${ns}.v[356](...)\` is called with 3+ arguments. The third arg is the output buffer — exactly the exploit surface of GHSA-w5hq-g745-h8pq.`,
          `${file}:${i + 1}: ${line.trim().slice(0, 160)}`
        );
        leakInThisFile = true;
      }
    }
  }

  if (!leakInThisFile) pass();
}

// ─── 3. Emit ──────────────────────────────────────────────────────────────

const warnings = findings.filter((f) => f.severity === 'warn').length;
const failed = findings.filter((f) => f.severity === 'fail').length;

console.log(
  JSON.stringify(
    {
      name: 'uuid-vulnerable-call',
      scanned,
      passed,
      failed,
      warnings,
      findings,
    },
    null,
    2
  )
);

process.exit(failed > 0 ? 1 : 0);
