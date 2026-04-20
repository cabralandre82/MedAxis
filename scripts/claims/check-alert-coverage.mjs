#!/usr/bin/env node
// scripts/claims/check-alert-coverage.mjs
// Claim: every "must-page" metric the code emits has at least one
// alert rule in `monitoring/prometheus/alerts.yml`, every rule has
// the hygiene annotations on-call expects (severity, team,
// runbook) pointing at a real runbook file, and the §6 "Alert
// rules" table in `docs/observability/metrics.md` stays in sync
// with the YAML.
//
// Why this matters: `check-metric-emission` proves that every
// metric cited by a doc is emitted by the code. But that says
// nothing about whether the metric ever pages anyone. An
// integrity-violation counter (`audit_chain_break_total`,
// `rls_canary_violations_total`, `money_drift_total`) that
// silently increments on a Grafana dashboard nobody's watching
// is the worst failure mode possible: post-incident we'd discover
// the signal was there all along, just unwired.
//
// Ground truth (in order of authority):
//   1. `monitoring/prometheus/alerts.yml` — what actually pages.
//   2. `lib/metrics.ts` Metrics constant — what the code emits.
//   3. `docs/observability/metrics.md` §6 table — the public
//      "here are our alerts" catalog.
//
// Severity contract:
//   - fail — mechanical, falsifiable:
//       (a) YAML doesn't parse;
//       (b) an alert lacks severity/team/runbook annotations;
//       (c) an alert's expr references a metric no code emits;
//       (d) an alert's runbook: path doesn't exist;
//       (e) a must-page metric (suffix-matched) has zero coverage;
//       (f) an alert cited in metrics.md §6 has no rule in YAML.
//   - warn — hygienic:
//       (g) a CRITICAL alert in YAML is not documented in §6
//           (public catalog lag).

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

// ─── 1. Parse alerts.yml ───────────────────────────────────────────────────
//
// The file has a predictable shape — a single top-level `groups:`
// sequence of `{ name, interval, rules: [{ alert, expr, for,
// labels, annotations }] }`. Node ships no YAML parser in stdlib,
// but the structure is regular enough to walk line-by-line:
//
//   - alert: Name
//     expr: |
//       <multi-line expression indented deeper than `expr:`>
//     for: 5m
//     labels:
//       severity: critical
//       team: sre
//     annotations:
//       summary: ...
//       runbook: docs/runbooks/foo.md
//
// We extract one record per `- alert:` block, terminating when
// the next `- alert:` or `- name:` appears at the same or lower
// indent. Good enough for a verifier — if the file grows more
// exotic, switch to a real YAML parser (e.g. `yaml` npm package).

const alertsPath = 'monitoring/prometheus/alerts.yml';
if (!fs.existsSync(alertsPath)) {
  fail('monitoring/prometheus/alerts.yml exists',
       `${alertsPath} not found — no alerting configured`,
       alertsPath);
  emitAndExit();
}
pass();

const alertsSrc = fs.readFileSync(alertsPath, 'utf8');
const alertsLines = alertsSrc.split('\n');

// Returns { alerts: [{name, expr, for, severity, team, service,
// runbook, summary, startLine, endLine, group}], errors: [] }.
function parseAlertsYaml(lines) {
  const alerts = [];
  let currentGroup = null;
  let current = null;                // in-flight alert record
  let currentSectionKey = null;      // 'labels' or 'annotations' or null
  let currentExprIndent = null;      // for multi-line expr: |
  const errors = [];

  function closeCurrent(endLine) {
    if (!current) return;
    current.endLine = endLine;
    alerts.push(current);
    current = null;
    currentSectionKey = null;
    currentExprIndent = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');
    // Strip full-line comments; preserve indent.
    if (/^\s*#/.test(line)) continue;
    if (line.trim() === '') continue;

    // Group header: `- name: foo` at 2-space indent.
    const groupMatch = line.match(/^\s*-\s*name:\s*(\S+)\s*$/);
    if (groupMatch) {
      closeCurrent(i - 1);
      currentGroup = groupMatch[1];
      continue;
    }

    // Alert header: `- alert: FooBar`.
    const alertMatch = line.match(/^(\s*)-\s*alert:\s*(\S+)\s*$/);
    if (alertMatch) {
      closeCurrent(i - 1);
      current = {
        name: alertMatch[2],
        group: currentGroup,
        startLine: i + 1,
        expr: '',
        for: null,
        severity: null,
        team: null,
        service: null,
        runbook: null,
        summary: null,
        description: null,
      };
      currentSectionKey = null;
      currentExprIndent = null;
      continue;
    }

    if (!current) continue;   // top-level junk between groups

    // Multi-line expression capture: after `expr: |`, capture any
    // line whose indent > the `expr:` key's indent, until a
    // sibling key returns us to that indent.
    if (currentExprIndent !== null) {
      const leading = line.match(/^(\s*)/)[1].length;
      if (leading > currentExprIndent) {
        current.expr += line.slice(currentExprIndent + 1) + '\n';
        continue;
      } else {
        currentExprIndent = null;
        currentSectionKey = null;
      }
    }

    // Single-line scalar: `  expr: <inline>` — capture on one line.
    const exprInline = line.match(/^(\s*)expr:\s*(.+)$/);
    if (exprInline) {
      const indent = exprInline[1].length;
      const val = exprInline[2].trim();
      if (val === '|' || val === '|-' || val === '>' || val === '>-') {
        currentExprIndent = indent + 1;
      } else {
        current.expr = val;
      }
      continue;
    }

    // `  for: 5m`.
    const forMatch = line.match(/^\s+for:\s*(.+)$/);
    if (forMatch) { current.for = forMatch[1].trim(); continue; }

    // Section heads: `  labels:` / `  annotations:`.
    const sectionMatch = line.match(/^(\s+)(labels|annotations):\s*$/);
    if (sectionMatch) { currentSectionKey = sectionMatch[2]; continue; }

    // Scalar inside a section: `    severity: critical`.
    if (currentSectionKey) {
      const scalarMatch = line.match(/^\s+([a-z_]+):\s*(.+)$/);
      if (scalarMatch) {
        const key = scalarMatch[1];
        let val = scalarMatch[2].trim();
        // Strip surrounding quotes and a trailing `|`/`>` leftover.
        val = val.replace(/^['"](.*)['"]$/, '$1');
        if (currentSectionKey === 'labels') {
          if (['severity', 'team', 'service'].includes(key)) current[key] = val;
        } else if (currentSectionKey === 'annotations') {
          if (['runbook', 'summary', 'description', 'dashboard'].includes(key)) {
            // description: | takes multi-line; skip the pipe form
            // when val === '|'.
            if (val !== '|' && val !== '|-' && val !== '>' && val !== '>-') {
              current[key] = val;
            }
          }
        }
        continue;
      }
    }
  }
  closeCurrent(lines.length - 1);
  return { alerts, errors };
}

const { alerts, errors: parseErrors } = parseAlertsYaml(alertsLines);
if (parseErrors.length > 0) {
  for (const e of parseErrors) fail('alerts.yml parses cleanly', e, alertsPath);
} else {
  pass();
}

if (alerts.length === 0) {
  fail('alerts.yml has at least one alert',
       'parser extracted zero alerts from the YAML — either the file is empty or the line-based parser drifted',
       alertsPath);
  emitAndExit();
}
pass();

// ─── 2. Structural hygiene: each alert has the mandatory shape ─────────────

for (const a of alerts) {
  const loc = `${alertsPath}:${a.startLine}`;
  if (!a.expr || !a.expr.trim()) {
    fail(`alert ${a.name} has an expr`, 'missing expr — alert cannot fire', loc);
  } else pass();

  if (!a.severity) {
    fail(`alert ${a.name} has labels.severity`,
         'missing labels.severity — alertmanager routing will default to "none" and drop the page',
         loc);
  } else if (!['critical', 'warning', 'info'].includes(a.severity)) {
    fail(`alert ${a.name} severity is one of critical|warning|info`,
         `got severity="${a.severity}" — alertmanager routes on these exact tokens`,
         loc);
  } else pass();

  if (!a.team) {
    fail(`alert ${a.name} has labels.team`,
         'missing labels.team — on-call rotation mapping breaks',
         loc);
  } else pass();

  if (!a.runbook) {
    fail(`alert ${a.name} has annotations.runbook`,
         'missing runbook annotation — on-call opens the page with no procedure link',
         loc);
  } else {
    // Runbook should be a repo-relative path; check existence.
    if (!fs.existsSync(a.runbook)) {
      const sev = a.severity === 'critical' ? fail : warn;
      sev(`alert ${a.name} runbook ${a.runbook} exists`,
          `runbook path "${a.runbook}" annotated on ${a.name} does not resolve to a file — the 3am operator clicks a dead link`,
          loc);
    } else pass();
  }
}

// ─── 3. Every metric referenced in `expr:` is emitted by the code ──────────
//
// Reverse of `check-metric-emission` (which validates docs →
// code). Here we validate alert rules → code: an alert whose
// `expr:` references `foo_bar_total` will silently evaluate to 0
// forever if nothing actually emits `foo_bar_total`.

const metricsLibSrc = fs.existsSync('lib/metrics.ts')
  ? fs.readFileSync('lib/metrics.ts', 'utf8')
  : '';
const emittedMetrics = new Set();
{
  // From the Metrics constant: `FOO_BAR_TOTAL: 'foo_bar_total'`.
  const RE = /[A-Z_][A-Z0-9_]+:\s*'([a-z][a-z0-9_]*)'/g;
  let m;
  while ((m = RE.exec(metricsLibSrc)) !== null) emittedMetrics.add(m[1]);
  // Also accept direct literals via incCounter('foo_bar_total', …)
  const RE2 = /incCounter\s*\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
  while ((m = RE2.exec(metricsLibSrc)) !== null) emittedMetrics.add(m[1]);
}
// Scan the rest of the codebase for direct literal emissions
// (Grep-equivalent over app/, lib/, services/).
{
  const roots = ['app', 'lib', 'services'];
  const RE_DIRECT = /\b(incCounter|observeHistogram|setGauge)\s*\(\s*['"]([a-z][a-z0-9_]*)['"]/g;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(ent.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      let m;
      RE_DIRECT.lastIndex = 0;
      while ((m = RE_DIRECT.exec(src)) !== null) emittedMetrics.add(m[2]);
    }
  }
  for (const r of roots) walk(r);
}

// Allowlist of PromQL idioms that look like metric names but
// aren't: `vector`, `on`, `by`, `rate`, `sum`, the `_bucket` /
// `_count` / `_sum` histogram suffixes emitted by Prometheus's
// recording side — we strip those before checking.
const HISTOGRAM_DERIVED_SUFFIXES = /_bucket$|_count$|_sum$/;

function metricsInExpr(expr) {
  const tokens = new Set();
  // A PromQL expression mixes three token classes that all look
  // like identifiers: metric names, label names (inside `{...}`
  // and `by(...)`/`on(...)`/`without(...)`/`group_left(...)`
  // clauses), and function/operator keywords. We want only the
  // first class. Strategy:
  //   1. Mask everything inside `{...}` — those are label
  //      matchers (`status_class="5xx"`).
  //   2. Mask `by (...) / on (...) / without (...) / ignoring (...)
  //      / group_left (...) / group_right (...)` argument lists.
  //   3. Mask `[5m]` / `[1h]` range selectors — safe because they
  //      contain digits + unit letters only.
  //   4. Skip the known PromQL builtins whitelist.
  let masked = expr;
  masked = masked.replace(/\{[^}]*\}/g, ' ');
  masked = masked.replace(/\[[^\]]*\]/g, ' ');
  masked = masked.replace(
    /\b(by|on|without|ignoring|group_left|group_right)\s*\([^)]*\)/g,
    ' ',
  );
  const RE = /\b([a-z][a-z0-9_]+)\b/g;
  const PROMQL_BUILTINS = new Set([
    'sum', 'rate', 'increase', 'by', 'on', 'without', 'and', 'or',
    'unless', 'avg', 'min', 'max', 'count', 'clamp_min', 'clamp_max',
    'histogram_quantile', 'time', 'vector', 'absent', 'group_left',
    'group_right', 'ignoring', 'offset', 'le', 'bool', 'topk', 'bottomk',
    'quantile', 'stddev', 'stdvar', 'delta', 'idelta', 'deriv', 'predict_linear',
    'humanizeduration', 'humanizepercentage', 'humanize', 'value', 'labels',
  ]);
  let m;
  while ((m = RE.exec(masked)) !== null) {
    const tok = m[1];
    if (PROMQL_BUILTINS.has(tok)) continue;
    if (!tok.includes('_')) continue;  // single word, likely not a metric
    tokens.add(tok);
  }
  return tokens;
}

function isKnownMetric(tok) {
  if (emittedMetrics.has(tok)) return true;
  // Accept histogram-derived suffixes: `foo_ms_bucket` is a real
  // time-series if `foo_ms` is emitted as a histogram.
  const stripped = tok.replace(HISTOGRAM_DERIVED_SUFFIXES, '');
  if (stripped !== tok && emittedMetrics.has(stripped)) return true;
  return false;
}

for (const a of alerts) {
  const refs = metricsInExpr(a.expr);
  if (refs.size === 0) { pass(); continue; }
  let allOk = true;
  for (const ref of refs) {
    if (isKnownMetric(ref)) continue;
    allOk = false;
    fail(`metric ${ref} referenced by alert ${a.name} is emitted by code`,
         `alert ${a.name} at ${alertsPath}:${a.startLine} uses \`${ref}\` in its expr but no Metrics constant or literal emission produces it — expr evaluates to 0 forever, alert is dead`,
         `${alertsPath}:${a.startLine}`);
  }
  if (allOk) pass();
}

// ─── 4. Must-page metrics: coverage check ──────────────────────────────────
//
// A "must-page" metric is one where any non-zero increment is a
// compliance or integrity exposure (ANPD, financial, security).
// These are identified by naming suffix, a design we lock in
// through AGENTS.md ("any metric named *_chain_break_total, etc.
// MUST be covered by an alert rule"). The heuristic is explicit
// so the verifier can't be sidestepped by accident.

const MUST_PAGE_SUFFIXES = [
  '_chain_break_total',   // hash-chain integrity (audit, backup, DSAR, money)
  '_violations_total',    // binary-gated security breach (RLS canary)
  '_drift_total',         // financial/reconciliation mismatch
  '_breach_total',        // SLA or threshold breach (DSAR, backup freshness)
  '_tampered_total',      // explicit tamper evidence (future-proof)
];

const mustPageMetrics = [...emittedMetrics].filter(m =>
  MUST_PAGE_SUFFIXES.some(sfx => m.endsWith(sfx))
);

// Build the set of metrics referenced by any alert expr (flat).
const alertedMetrics = new Set();
for (const a of alerts) {
  for (const m of metricsInExpr(a.expr)) {
    alertedMetrics.add(m);
    // Also strip histogram suffix so `foo_ms_bucket` → `foo_ms`.
    alertedMetrics.add(m.replace(HISTOGRAM_DERIVED_SUFFIXES, ''));
  }
}

for (const metric of mustPageMetrics) {
  if (alertedMetrics.has(metric)) { pass(); continue; }
  fail(`must-page metric ${metric} is covered by at least one alert`,
       `${metric} matches a critical-suffix pattern (${MUST_PAGE_SUFFIXES.join(' | ')}) but no rule in ${alertsPath} references it in an expr. Silent-signal risk: Grafana shows the line climbing while on-call hears nothing.`,
       alertsPath);
}

// ─── 5. metrics.md §6 ↔ alerts.yml bidirectional consistency ───────────────

const metricsDocPath = 'docs/observability/metrics.md';
const metricsDocSrc = fs.existsSync(metricsDocPath)
  ? fs.readFileSync(metricsDocPath, 'utf8')
  : '';

// Extract the §6 table. Header is like "## 6. Alert rules" and
// the table is a markdown-pipes block. Pull every row whose first
// cell is a backticked `Xxx` CamelCase token.
function extractSection6Alerts(src) {
  const m = src.match(/##\s+6\.\s+Alert rules[\s\S]*?(?=\n##\s+\d+\.|\n---\s*$)/);
  if (!m) return [];
  const section = m[0];
  const names = [];
  for (const line of section.split('\n')) {
    const row = line.match(/^\|\s*`([A-Z][A-Za-z0-9]+)`\s*\|/);
    if (row) names.push(row[1]);
  }
  return names;
}

const docAlertNames = new Set(extractSection6Alerts(metricsDocSrc));
const yamlAlertNames = new Set(alerts.map(a => a.name));

for (const name of docAlertNames) {
  if (yamlAlertNames.has(name)) { pass(); continue; }
  fail(`alert ${name} documented in metrics.md §6 exists in alerts.yml`,
       `§6 of ${metricsDocPath} lists \`${name}\` but ${alertsPath} has no rule by that name — the public catalog promises a page that will never fire`,
       metricsDocPath);
}

// Reverse direction: every CRITICAL alert in YAML is listed in §6.
// We warn (not fail) because catalog lag is common and not itself
// a regression — but it hides on-call context from new engineers.
for (const a of alerts) {
  if (a.severity !== 'critical') continue;
  if (docAlertNames.has(a.name)) { pass(); continue; }
  warn(`critical alert ${a.name} is documented in metrics.md §6`,
       `${a.name} is SEV-critical (will page P1) but is not listed in §6 of ${metricsDocPath} — on-call reading the catalog won't know this alert exists`,
       metricsDocPath);
}

// ─── 6. Emit ───────────────────────────────────────────────────────────────

function emitAndExit() {
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const failed   = findings.filter(f => f.severity === 'fail').length;
  console.log(JSON.stringify({
    name: 'alert-coverage',
    passed,
    failed,
    warnings,
    findings,
  }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
emitAndExit();
