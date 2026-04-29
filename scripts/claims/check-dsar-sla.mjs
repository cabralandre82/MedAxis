#!/usr/bin/env node
// scripts/claims/check-dsar-sla.mjs
// Claim: the LGPD Art. 18/19 surface described in `.cursor/skills/dsar-fulfill/`
// and `docs/runbooks/dsar-sla-missed.md` describes the system we're
// actually running — not the one we wish we had.
//
// Why this matters: DSAR drift is specifically the surface ANPD
// audits on a breach inquiry. If the skill tells a human operator
// to call `public.dsar_anonymize_subject()` and that RPC never
// shipped, the SLA clock runs out while they debug the pg error.
// If the runbook claims `{from, to}` labels on `dsar_transition_total`
// but the code emits only `{to}`, the alert rule that counts from-
// FULFILLED-to-REJECTED transitions never fires and a compliance
// regression goes unobserved for months.
//
// Ground truth (in order of authority):
//   1. `supabase/migrations/051_dsar_sla.sql` CHECK constraints —
//      the statuses and kinds enforced by the database.
//   2. `lib/dsar.ts` `DsarStatus`/`DsarKind` types — must mirror (1).
//   3. `lib/metrics.ts` `Metrics.DSAR_*` + `incCounter/observeHistogram`
//      call sites — what's actually emitted.
//   4. `app/api/cron/dsar-sla-check/route.ts` — the enforcer.
//
// Every human-facing surface below must be consistent with those
// four: the skill, the runbook, and `docs/observability/metrics.md`.
//
// Severity contract:
//   - fail — the claim is mechanical: a cron doesn't exist, an RPC is
//            aspirational, the TS type drifted from the DB enum.
//   - warn — the claim is best-effort: a metric lacks user-facing
//            documentation, a label-set in the docs doesn't match the
//            emitter call-site. Actionable but not a regression.

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

// ─── 1. Ground-truth extraction ────────────────────────────────────────────

const migrationsDir = 'supabase/migrations';
function readAllMigrations() {
  if (!fs.existsSync(migrationsDir)) return '';
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  return files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n-- NEW FILE --\n');
}

const allMigrations = readAllMigrations();

// Extract DSAR status/kind CHECK values. Ground-truth format in
// migration 051 is:
//
//   status text NOT NULL DEFAULT 'RECEIVED'
//          CHECK (status IN (
//              'RECEIVED', -- awaiting admin triage
//              …
//              'EXPIRED'   -- > 30 days past SLA (retention exposure)
//          )),
//
// Inline `--` comments contain parentheses of their own — the
// original greedy-up-to-`)` capture misclassified `(retention)`
// as the end of the CHECK list. Strip line comments before
// matching so the `(...)` balancing is clean.
function stripSqlLineComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

function extractCheckValues(sql, tableRe, column) {
  const cleaned = stripSqlLineComments(sql);
  const tableMatch = cleaned.match(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${tableRe}\\b[\\s\\S]*?\\);`, 'i'));
  if (!tableMatch) return null;
  const tableBody = tableMatch[0];
  const colRe = new RegExp(`\\b${column}\\s+text\\b[\\s\\S]*?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([\\s\\S]*?)\\)\\s*\\)`, 'i');
  const m = tableBody.match(colRe);
  if (!m) return null;
  const values = [];
  const RE_VAL = /'([A-Z_]+)'/g;
  let v;
  while ((v = RE_VAL.exec(m[1])) !== null) values.push(v[1]);
  return values;
}

const dbStatuses = extractCheckValues(allMigrations, 'dsar_requests', 'status');
const dbKinds = extractCheckValues(allMigrations, 'dsar_requests', 'kind');

if (!dbStatuses || dbStatuses.length === 0) {
  fail('dsar_requests CHECK(status) extractable',
       'could not parse status enum from dsar_requests CREATE TABLE — regex drift, verifier needs update',
       `${migrationsDir}/051_dsar_sla.sql`);
} else {
  pass();
}
if (!dbKinds || dbKinds.length === 0) {
  fail('dsar_requests CHECK(kind) extractable',
       'could not parse kind enum from dsar_requests CREATE TABLE',
       `${migrationsDir}/051_dsar_sla.sql`);
} else {
  pass();
}

// Existing DSAR functions in migrations (any `CREATE OR REPLACE FUNCTION public.X`).
// Scope to DSAR-related ones: starts with `dsar_` or is `_dsar_`.
const dbFunctions = new Set();
{
  const RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = RE.exec(allMigrations)) !== null) {
    dbFunctions.add(m[1]);
  }
}

// Tables in public schema (reuse pattern from check-retention-policies).
const dbTables = new Set();
{
  const RE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = RE.exec(allMigrations)) !== null) {
    const n = m[1].toLowerCase();
    if (['as', 'in', 'if'].includes(n)) continue;
    dbTables.add(n);
  }
}

// Feature flag dsar.sla_enforce (from migration `INSERT INTO feature_flags`).
const flagMatch = allMigrations.match(/feature_flags[\s\S]*?VALUES\s*\(\s*'dsar\.sla_enforce'/);
if (flagMatch) pass();
else fail('feature flag dsar.sla_enforce is migrated',
          'no INSERT INTO feature_flags with key=dsar.sla_enforce found — the cron flag is a runtime guess',
          migrationsDir);

// Cron file exists
const cronPath = 'app/api/cron/dsar-sla-check/route.ts';
if (fs.existsSync(cronPath)) pass();
else fail('dsar-sla-check cron route file exists', `${cronPath} not found`, cronPath);

// ─── 2. TS types agree with DB enums ──────────────────────────────────────

const dsarLibPath = 'lib/dsar.ts';
if (!fs.existsSync(dsarLibPath)) {
  fail('lib/dsar.ts exists', 'DSAR service module not found', dsarLibPath);
} else {
  const dsarLib = fs.readFileSync(dsarLibPath, 'utf8');

  function extractUnion(src, typeName) {
    // Match `export type X = 'A' | 'B' | 'C'` on a single line or
    // across lines. Be permissive with whitespace.
    const re = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([^\\n]+(?:\\n\\s*\\|[^\\n]+)*)`);
    const m = src.match(re);
    if (!m) return null;
    const values = [];
    const RE_LIT = /'([A-Z_]+)'/g;
    let v;
    while ((v = RE_LIT.exec(m[1])) !== null) values.push(v[1]);
    return values;
  }

  const tsKinds = extractUnion(dsarLib, 'DsarKind');
  const tsStatuses = extractUnion(dsarLib, 'DsarStatus');

  function compareSets(a, b, _labelA, _labelB) {
    const setA = new Set(a); const setB = new Set(b);
    const missingInB = a.filter(x => !setB.has(x));
    const extraInB  = b.filter(x => !setA.has(x));
    return { ok: missingInB.length === 0 && extraInB.length === 0, missingInB, extraInB };
  }

  if (dbKinds && tsKinds) {
    const cmp = compareSets(dbKinds, tsKinds, 'DB', 'TS');
    if (cmp.ok) pass();
    else fail(
      'DsarKind (TS) == CHECK(kind) (DB)',
      `DB allows [${dbKinds.join(', ')}] but TS declares [${tsKinds.join(', ')}]. Missing in TS: [${cmp.missingInB.join(', ') || '—'}]. Extra in TS: [${cmp.extraInB.join(', ') || '—'}]`,
      dsarLibPath,
    );
  }
  if (dbStatuses && tsStatuses) {
    const cmp = compareSets(dbStatuses, tsStatuses, 'DB', 'TS');
    if (cmp.ok) pass();
    else fail(
      'DsarStatus (TS) == CHECK(status) (DB)',
      `DB allows [${dbStatuses.join(', ')}] but TS declares [${tsStatuses.join(', ')}]. Missing in TS: [${cmp.missingInB.join(', ') || '—'}]. Extra in TS: [${cmp.extraInB.join(', ') || '—'}]`,
      dsarLibPath,
    );
  }
}

// ─── 3. Docs don't invent kinds/statuses ──────────────────────────────────
//
// Target: the `.cursor/skills/dsar-fulfill/SKILL.md` H3 subsection
// headers under "## Step 4 — execute by kind" — each H3 there claims
// to be a DSAR kind. They MUST be in `dbKinds`.

const skillPath = '.cursor/skills/dsar-fulfill/SKILL.md';
if (fs.existsSync(skillPath) && dbKinds) {
  const skill = fs.readFileSync(skillPath, 'utf8');

  // Find the "Execute by kind" section and grab every H3 in it.
  const step4 = skill.match(/##\s+Step 4[\s\S]*?(?=\n##\s+Step|\n---)/);
  if (step4) {
    const RE_H3 = /^###\s+([A-Z_]+)\b/gm;
    let m;
    while ((m = RE_H3.exec(step4[0])) !== null) {
      const claimedKind = m[1];
      if (dbKinds.includes(claimedKind)) { pass(); continue; }
      fail(
        `skill kind header ${claimedKind} is a valid DsarKind`,
        `"### ${claimedKind}" appears under "Execute by kind" in the DSAR skill but the DB only allows [${dbKinds.join(', ')}]. Operators following this runbook will get a CHECK-constraint violation.`,
        skillPath,
      );
    }
  }
}

// ─── 4. Every `public.X(` function reference in docs exists in a migration ──
//
// Scan both the skill and the runbook for `public.<name>(` where
// `<name>` starts with `dsar_` or `user_` (skill calls out
// `user_correct_field()`). Each must be a function defined by a
// migration.

const docsToScan = [
  '.cursor/skills/dsar-fulfill/SKILL.md',
  'docs/runbooks/dsar-sla-missed.md',
];

const RE_PUBLIC_FN = /public\.([a-z_][a-z0-9_]*)\s*\(/g;
const DSAR_FN_PREFIXES = ['dsar_', 'user_correct', 'dsar_anonymize', '_dsar_'];
const seenFnRefs = new Set();  // "file\x00fn" pairs to avoid dupes

for (const doc of docsToScan) {
  if (!fs.existsSync(doc)) {
    warn(`${doc} exists`, 'referenced in verifier but missing', doc);
    continue;
  }
  const src = fs.readFileSync(doc, 'utf8');
  let m;
  RE_PUBLIC_FN.lastIndex = 0;
  while ((m = RE_PUBLIC_FN.exec(src)) !== null) {
    const fn = m[1];
    if (!DSAR_FN_PREFIXES.some(p => fn.startsWith(p))) continue;
    const key = doc + '\x00' + fn;
    if (seenFnRefs.has(key)) continue;
    seenFnRefs.add(key);
    if (dbFunctions.has(fn)) { pass(); continue; }
    fail(
      `RPC public.${fn}() exists`,
      `${doc} references \`public.${fn}()\` as if it were a sanctioned DSAR RPC, but no migration defines it — the skill is aspirational at the point an operator needs it most (3am, breach in progress)`,
      doc,
    );
  }
}

// ─── 5. Table references in docs exist ─────────────────────────────────────
//
// Scan `public.<table>` references in SQL code blocks of the skill +
// runbook and verify each table exists. Scope: only identifiers that
// aren't in the DSAR-function allowlist above (already handled).

const RE_PUBLIC_TABLE = /\bpublic\.([a-z_][a-z0-9_]*)\b/g;
const seenTableRefs = new Set();
const DOCS_TABLE_ALLOWLIST = new Set([
  // Supabase-managed or generic schemas we don't own
]);

for (const doc of docsToScan) {
  if (!fs.existsSync(doc)) continue;
  const src = fs.readFileSync(doc, 'utf8');
  let m;
  RE_PUBLIC_TABLE.lastIndex = 0;
  while ((m = RE_PUBLIC_TABLE.exec(src)) !== null) {
    const name = m[1];
    // Skip function references (next char is `(`).
    const afterIdx = m.index + m[0].length;
    if (src[afterIdx] === '(') continue;
    if (DOCS_TABLE_ALLOWLIST.has(name)) continue;
    const key = doc + '\x00' + name;
    if (seenTableRefs.has(key)) continue;
    seenTableRefs.add(key);
    if (dbTables.has(name)) { pass(); continue; }
    fail(
      `public.${name} exists (referenced by ${path.basename(doc)})`,
      `${doc} references \`public.${name}\` but no migration creates this table — operator following the SQL will get "relation does not exist"`,
      doc,
    );
  }
}

// ─── 6. Every Metrics.DSAR_* has a corresponding docs row ─────────────────
//
// The observability metrics.md is the canonical Prometheus catalog.
// Every DSAR metric the code emits MUST have a row there so SRE dashboards
// and alert rules have something to reference.

const metricsLib = fs.existsSync('lib/metrics.ts') ? fs.readFileSync('lib/metrics.ts', 'utf8') : '';
const metricsDoc = fs.existsSync('docs/observability/metrics.md')
  ? fs.readFileSync('docs/observability/metrics.md', 'utf8')
  : '';
const runbookDoc = fs.existsSync('docs/runbooks/dsar-sla-missed.md')
  ? fs.readFileSync('docs/runbooks/dsar-sla-missed.md', 'utf8')
  : '';

const dsarMetricNames = [];
{
  const RE = /DSAR_[A-Z_]+:\s*'([a-z_]+)'/g;
  let m;
  while ((m = RE.exec(metricsLib)) !== null) dsarMetricNames.push(m[1]);
}

for (const metric of dsarMetricNames) {
  // Look for the metric name as a backticked token or bare word.
  const re = new RegExp('`' + metric + '`|\\b' + metric + '\\b');
  const inCatalog = re.test(metricsDoc);
  const inRunbook = re.test(runbookDoc);
  if (inCatalog) { pass(); continue; }
  if (inRunbook) {
    warn(
      `metric ${metric} is in the Prometheus catalog`,
      `${metric} is emitted by the code and mentioned in the runbook but NOT in docs/observability/metrics.md — dashboards won't find it`,
      'docs/observability/metrics.md',
    );
    continue;
  }
  fail(
    `metric ${metric} is documented`,
    `${metric} is emitted by the code but appears in neither docs/observability/metrics.md nor docs/runbooks/dsar-sla-missed.md — invisible to ops`,
    'docs/observability/metrics.md',
  );
}

// ─── 7. Metric label coherence: docs describe what code emits ─────────────
//
// For each DSAR metric, extract the label keys the code passes to
// `incCounter(Metrics.X, {…})` and compare against the labels column
// in metrics.md. Label drift is a favourite silent-break:
// dashboards group by a label that never arrives.

function extractCodeLabelsForMetric(metricConstKey /* e.g. DSAR_EXPIRED_TOTAL */) {
  // Find every `Metrics.<KEY>` usage in the repo's TS files, and capture
  // the object-literal argument that follows.
  const roots = ['app', 'lib', 'components', 'services'];
  const labels = new Set();
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (/\.(ts|tsx|mjs)$/.test(ent.name)) files.push(p);
    }
  }
  for (const r of roots) walk(r);
  const callRe = new RegExp(
    'Metrics\\.' + metricConstKey + '\\s*,\\s*\\{([^}]*)\\}',
    'g',
  );
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(src)) !== null) {
      const objBody = m[1];
      // Object literals in Metrics call sites include both
      // `foo: bar` (pinned) and `foo` (shorthand) forms. The
      // shorthand case (e.g. `{ reason, to: toStatus }`) used to
      // be skipped, which under-counted labels and spuriously
      // flagged a doc drift that was actually a code drift. Match
      // both forms by splitting on commas first.
      for (const part of objBody.split(',')) {
        const mm = part.trim().match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|$)/);
        if (mm) labels.add(mm[1]);
      }
    }
  }
  return labels;
}

// Pre-compute the metrics.md "Labels" column index by reading the
// header rows. In the current catalog the tables use the header
// `| Métrica | Tipo | Labels | Descrição | ... |`; finding the
// "Labels" cell by name is more robust than a fixed column number.
function buildMetricsDocIndex(doc) {
  const lines = doc.split('\n');
  // Map row index → labels-column index based on the most recent
  // header row. Tracks *which* table the row belongs to.
  const labelColByRow = new Map();
  let currentLabelCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cells = line.split('|').map(c => c.trim());
    if (cells.length > 2 && /labels/i.test(line)) {
      const idx = cells.findIndex(c => /^labels$/i.test(c));
      if (idx > 0) currentLabelCol = idx;
    }
    // Skip delimiter rows like `| --- | --- |`.
    if (/^\|[\s|:-]+\|$/.test(line.trim())) continue;
    if (cells.length > 1) labelColByRow.set(i, currentLabelCol);
  }
  return { lines, labelColByRow };
}

const metricsDocIndex = buildMetricsDocIndex(metricsDoc);

function extractDocLabelsForMetric(metricName) {
  const { lines, labelColByRow } = metricsDocIndex;
  const labels = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('`' + metricName + '`')) continue;
    // The first-column cell must BE the backticked metric name —
    // otherwise this is a row that merely references the metric in
    // prose (e.g. the alert-rules table cites it in the expression
    // column).
    const cells = line.split('|').map(c => c.trim());
    if (cells[1] !== '`' + metricName + '`') continue;
    const col = labelColByRow.get(i);
    if (col === undefined || col < 0 || col >= cells.length) continue;
    const labelsCell = cells[col];
    if (!labelsCell || labelsCell === '—' || labelsCell === '-') continue;
    for (const m of labelsCell.matchAll(/`([a-z_]+)`/g)) labels.add(m[1]);
  }
  return labels;
}

// Map from Prometheus name → const name in lib/metrics.ts.
const DSAR_METRIC_MAP = [];
{
  const RE = /(DSAR_[A-Z_]+):\s*'([a-z_]+)'/g;
  let m;
  while ((m = RE.exec(metricsLib)) !== null) {
    DSAR_METRIC_MAP.push({ constKey: m[1], name: m[2] });
  }
}

for (const { constKey, name } of DSAR_METRIC_MAP) {
  const codeLabels = extractCodeLabelsForMetric(constKey);
  const docLabels = extractDocLabelsForMetric(name);
  if (codeLabels.size === 0) continue;   // histogram-only or not yet emitted
  if (docLabels.size === 0) continue;    // doc row not yet labelled — skip (would double-warn with C6)

  const missingInDoc = [...codeLabels].filter(l => !docLabels.has(l));
  const missingInCode = [...docLabels].filter(l => !codeLabels.has(l));

  if (missingInDoc.length === 0 && missingInCode.length === 0) { pass(); continue; }
  warn(
    `metric ${name} label coherence (code ↔ docs)`,
    `code emits {${[...codeLabels].join(', ')}} but docs/observability/metrics.md documents {${[...docLabels].join(', ')}}` +
      (missingInDoc.length ? ` — code-only: {${missingInDoc.join(', ')}}` : '') +
      (missingInCode.length ? ` — doc-only: {${missingInCode.join(', ')}}` : ''),
    'docs/observability/metrics.md',
  );
}

// ─── 8. Emit ──────────────────────────────────────────────────────────────

function emitAndExit() {
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const failed   = findings.filter(f => f.severity === 'fail').length;
  console.log(JSON.stringify({
    name: 'dsar-sla',
    passed,
    failed,
    warnings,
    findings,
  }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
emitAndExit();
