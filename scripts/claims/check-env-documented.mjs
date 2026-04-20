#!/usr/bin/env node
// scripts/claims/check-env-documented.mjs
// Claim: every `process.env.VAR` reference in the codebase is either
//   (a) templated in `.env.example`, or
//   (b) provided by the runtime platform (Node.js, Next.js, Vercel, CI), or
//   (c) explicitly declared with an `# @env-exempt: VAR — reason` marker
//       inside `.env.example`.
//
// Why this matters: when a new engineer (or AI agent) clones the repo,
// `.env.example` is the *only* authoritative list of what must be set for
// the app to boot. If a production path silently reads `process.env.X`
// and X is undocumented, that engineer will hit a NullPointer / silent
// fallback at runtime — often in a path that never executes on their
// laptop because the feature it gates is off locally. This has been the
// single highest-frequency foot-gun across every onboarding I've seen.
//
// Severity contract:
//   - fail  — var is read from a **production path** (app/, lib/,
//             middleware.ts, next.config.ts, components/, services/,
//             hooks/, types/) but is not documented or exempted.
//             Running prod without it is undefined behaviour.
//   - warn  — var is read only from scripts/tests/CI-fixtures and is
//             undocumented. Still worth fixing (onboarding clarity),
//             but doesn't block a deploy.
//   - warn  — var is listed in `.env.example` but never referenced
//             anywhere (stale entry → lies to the operator).
//
// Pure-Node implementation — no ripgrep, no external deps, O(n) walk.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..');
process.chdir(repoRoot);

const findings = [];
let passed = 0;

function pass() { passed++; }
function fail(claim, detail, location) {
  findings.push({ severity: 'fail', claim, detail, location });
}
function warn(claim, detail, location) {
  findings.push({ severity: 'warn', claim, detail, location });
}

// ─── 1. Scan filesystem for `process.env.X` references ────────────────────

const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'coverage',
  '.turbo', '.vercel', 'reports', 'playwright-report', 'test-results',
]);

const RE_ENV = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

// name → Set<relative file path>
const refs = new Map();

function recordRef(name, file) {
  if (!refs.has(name)) refs.set(name, new Set());
  refs.get(name).add(file);
}

// Don't scan the verifier itself — the regex above matches the literal
// `process.env.VAR` example inside our own documentation block, which
// produces spurious `VAR` / `X` findings.
const SELF_PATH = 'scripts/claims/check-env-documented.mjs';

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    // Skip hidden dirs except `.github` (workflow files can reference envs too,
    // but we only care about code here — they're excluded by extension).
    if (ent.name.startsWith('.') && ent.name !== '.github') continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(abs); continue; }
    if (!ent.isFile()) continue;
    if (!SCAN_EXTS.has(path.extname(ent.name))) continue;
    const rel = path.relative(repoRoot, abs);
    if (rel === SELF_PATH) continue;
    const src = fs.readFileSync(abs, 'utf8');
    let m;
    RE_ENV.lastIndex = 0;
    while ((m = RE_ENV.exec(src)) !== null) {
      recordRef(m[1], rel);
    }
  }
}

walk(repoRoot);

// ─── 2. Parse `.env.example` for documented keys + exempt markers ─────────
//
// A key is considered documented if the file contains EITHER:
//   - a bare line of the form `KEY=...` (uncommented), OR
//   - a commented-out template line `# KEY=...` (optional/disabled block),
//   - an explicit exempt marker `# @env-exempt: KEY — reason`.
//
// We collect the exempt reasons separately so we can surface them in
// findings if a human later mis-spells the key — the marker must match
// the exact name referenced in code.

const documented = new Set();
const exempt = new Map();  // name → reason

const envExamplePath = '.env.example';
if (!fs.existsSync(envExamplePath)) {
  fail(
    '.env.example exists',
    'repo has no .env.example — cannot verify env documentation claim',
    envExamplePath,
  );
} else {
  const src = fs.readFileSync(envExamplePath, 'utf8');
  const lines = src.split('\n');

  //   KEY=value                                (documented)
  //   # KEY=value                              (documented, optional)
  //   # KEY= value                             (documented, optional)
  //   # @env-exempt: KEY — reason              (exempt)
  const RE_EXEMPT = /^\s*#\s*@env-exempt:\s*([A-Z_][A-Z0-9_]*)\s*[—\-:]\s*(.+)$/;
  const RE_DOC    = /^\s*(?:#\s*)?([A-Z_][A-Z0-9_]*)\s*=/;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const em = line.match(RE_EXEMPT);
    if (em) {
      exempt.set(em[1], em[2].trim());
      continue;
    }
    const dm = line.match(RE_DOC);
    if (dm) documented.add(dm[1]);
  }
}

// ─── 3. Platform-provided allowlist ───────────────────────────────────────
// These are set automatically by the runtime (Node.js, Next.js, Vercel) or
// by the CI environment (GitHub Actions). Never belong in `.env.example`
// because the operator doesn't supply them — they're injected.
const PLATFORM_PROVIDED = new Set([
  'NODE_ENV',              // Node.js standard
  'CI',                    // set by all major CI systems
  'NEXT_RUNTIME',          // Next.js: 'nodejs' | 'edge'
  'VERCEL_ENV',            // Vercel: 'production' | 'preview' | 'development'
  'VERCEL_URL',            // Vercel: deployment URL
  'VERCEL_DEPLOYMENT_ID',  // Vercel: unique deployment ID
  'VERCEL_GIT_COMMIT_SHA', // Vercel: git SHA of the deployment
  'GITHUB_TOKEN',          // GitHub Actions: auto-provided to every job
]);

// ─── 4. Production-path classifier ────────────────────────────────────────
// A reference is "production" if it comes from a path that executes in
// the Vercel runtime (server or client). Scripts, tests, config files,
// and CI-only helpers are warn-level.

const PROD_PATH_PREFIXES = [
  'app/', 'lib/', 'components/', 'services/', 'hooks/', 'types/',
  'middleware.ts', 'next.config.ts', 'instrumentation.ts',
  'instrumentation-client.ts', 'sentry.server.config.ts',
  'sentry.edge.config.ts', 'sentry.client.config.ts',
];

function isProdPath(file) {
  return PROD_PATH_PREFIXES.some(p =>
    p.endsWith('/') ? file.startsWith(p) : file === p
  );
}

// ─── 5. Cross-reference: every ref must be documented/exempt/platform ─────

for (const [name, files] of refs.entries()) {
  if (PLATFORM_PROVIDED.has(name)) { pass(); continue; }
  if (documented.has(name))        { pass(); continue; }
  if (exempt.has(name))            { pass(); continue; }

  const fileList = [...files].sort();
  const prodFile = fileList.find(isProdPath);
  const firstFile = prodFile ?? fileList[0];
  const detail =
    `referenced in ${fileList.length} file(s) but missing from .env.example` +
    ` (add it, comment it out under an "optional" block, or declare ` +
    `\`# @env-exempt: ${name} — <reason>\`)`;

  if (prodFile) {
    fail(`env var ${name} is documented`, detail, firstFile);
  } else {
    warn(`env var ${name} is documented`, detail, firstFile);
  }
}

// ─── 6. Inverse: flag stale `.env.example` entries ────────────────────────
//
// A key is considered a valid `.env.example` entry when SOMETHING in the
// codebase reads it. The `@env-exempt` marker wins over the stale check
// because it declares "this key is intentionally here even without a
// `process.env.X` reference" — typically because it's consumed by CLI
// tooling (Supabase CLI, Vercel CLI), a build-time loader, or an external
// process that doesn't show up in static scanning.

for (const name of documented) {
  if (refs.has(name))              { pass(); continue; }
  if (exempt.has(name))            { pass(); continue; }
  if (PLATFORM_PROVIDED.has(name)) { pass(); continue; }
  warn(
    `env var ${name} is referenced in code`,
    '.env.example documents this var but no code path reads it — stale entry, remove or annotate with `# @env-exempt: ' + name + ' — <reason>`',
    '.env.example',
  );
}

// ─── 7. Sanity: exempt markers should map to *something* real ─────────────
//
// A marker that declares an exemption for a key not referenced anywhere
// (neither in code nor in `.env.example`) is just dead documentation —
// it used to justify a reference that was since removed. Flag it so the
// catalog doesn't rot.

for (const [name, reason] of exempt.entries()) {
  if (refs.has(name))       { pass(); continue; }
  if (documented.has(name)) { pass(); continue; }
  warn(
    `env-exempt marker for ${name} still valid`,
    `@env-exempt declares "${reason}" but ${name} is neither referenced in code nor documented elsewhere — remove the marker`,
    '.env.example',
  );
}

const warnings = findings.filter(f => f.severity === 'warn').length;
const failed   = findings.filter(f => f.severity === 'fail').length;

console.log(JSON.stringify({
  name: 'env-documented',
  passed,
  failed,
  warnings,
  findings,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
