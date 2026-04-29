#!/usr/bin/env node
// scripts/claims/check-cron-scheduled.mjs
// Claim: `vercel.json.crons[]` and `app/api/cron/<name>/route.ts`
// are a bidirectional 1:1 mapping, every route is wrapped by
// `withCronGuard('<name>', …)` whose name matches its directory,
// every route exports GET (the verb Vercel actually invokes), and
// every schedule is a valid 5-field crontab expression.
//
// Why this matters: the companion `check-cron-claims` verifier
// checks that docs reference crons that exist, but it doesn't
// notice that:
//   - a cron exists in `vercel.json` but the source file was
//     deleted (deploy succeeds, runtime returns 404, alerts look
//     fine because `cron_runs_total` never increments — silent
//     compliance hole);
//   - a cron exists as a route but nobody scheduled it (code
//     merged, compile passes, the job never fires and a retention
//     pipeline quietly stops);
//   - a route exports only POST and Vercel's cron (GET-only) is
//     invoking an empty endpoint that 405s every hour;
//   - the `withCronGuard(name, …)` wrapper uses a different name
//     from the directory, so dashboards keyed on `cron_name` label
//     show results for a phantom job while the real job looks
//     silent.
//
// Severity contract:
//   - fail — mechanical, falsifiable (path drift, missing GET,
//            name mismatch, invalid crontab syntax);
//   - warn — hygienic (two daily crons on the exact same minute,
//            which on Vercel's free tier triggers queueing).

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

// ─── 1. Load vercel.json ───────────────────────────────────────────────────

const vercelJsonPath = 'vercel.json';
let vercelConfig;
try {
  vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
  pass();
} catch (err) {
  fail('vercel.json parses as JSON', `parse error: ${err.message}`, vercelJsonPath);
  emitAndExit();
}

const scheduled = Array.isArray(vercelConfig.crons) ? vercelConfig.crons : null;
if (!scheduled) {
  fail('vercel.json has a crons[] array', 'crons missing or not an array; no crons will run', vercelJsonPath);
  emitAndExit();
}
pass();

// ─── 2. vercel.json → route files (json drives code) ───────────────────────

const cronDir = 'app/api/cron';
const existingRoutes = fs.existsSync(cronDir)
  ? fs.readdirSync(cronDir).filter(n => fs.statSync(path.join(cronDir, n)).isDirectory())
  : [];
const existingRouteSet = new Set(existingRoutes);

const scheduledPaths = new Map();   // path → index in crons[]
const duplicatePaths = [];

for (let i = 0; i < scheduled.length; i++) {
  const entry = scheduled[i];
  const { path: cronPath } = entry;

  if (typeof cronPath !== 'string' || !cronPath) {
    fail('crons[i].path is a non-empty string',
         `crons[${i}] missing or empty .path`,
         vercelJsonPath);
    continue;
  }
  pass();

  if (scheduledPaths.has(cronPath)) {
    duplicatePaths.push(cronPath);
    fail('cron path is unique in vercel.json',
         `duplicate schedule for ${cronPath} (crons[${scheduledPaths.get(cronPath)}] and crons[${i}]). Vercel picks one silently; the other never runs.`,
         vercelJsonPath);
  } else {
    scheduledPaths.set(cronPath, i);
    pass();
  }

  // Must be `/api/cron/<name>` with nothing else.
  const m = cronPath.match(/^\/api\/cron\/([a-z0-9][a-z0-9-]*)$/);
  if (!m) {
    fail('cron path matches /api/cron/<slug>',
         `crons[${i}].path="${cronPath}" is not of the form /api/cron/<kebab-case>. Vercel will fail to register it.`,
         vercelJsonPath);
    continue;
  }
  pass();

  const name = m[1];
  if (existingRouteSet.has(name)) {
    const routeFile = `${cronDir}/${name}/route.ts`;
    if (fs.existsSync(routeFile)) pass();
    else fail(
      `route file exists for ${cronPath}`,
      `${cronDir}/${name}/ exists as directory but has no route.ts — cron will 404 at runtime and silently fail every invocation`,
      `${cronDir}/${name}/`,
    );
  } else {
    fail(
      `route handler exists for ${cronPath}`,
      `vercel.json schedules ${cronPath} but ${cronDir}/${name}/ does not exist — cron fires every invocation against a 404, alerts won't trigger because cron_runs_total never increments`,
      vercelJsonPath,
    );
  }
}

// ─── 3. route files → vercel.json (code drives schedule) ───────────────────
//
// Every directory under `app/api/cron/` must be registered in
// `vercel.json.crons[]`. Without this, the route exists but is
// never invoked — a compliance silent-failure where an operator
// believes a retention/verify job is running when in fact nothing
// is scheduled.

for (const name of existingRoutes) {
  const expectedPath = `/api/cron/${name}`;
  if (scheduledPaths.has(expectedPath)) { pass(); continue; }
  fail(
    `${expectedPath} is scheduled in vercel.json`,
    `${cronDir}/${name}/route.ts exists but vercel.json has no crons[] entry for ${expectedPath} — the route is dead code from Vercel's perspective and will never fire unless invoked manually`,
    `${cronDir}/${name}/route.ts`,
  );
}

// ─── 4. Each route exports GET + wraps withCronGuard(<name>, …) ────────────

for (const name of existingRoutes) {
  const routeFile = `${cronDir}/${name}/route.ts`;
  if (!fs.existsSync(routeFile)) continue;   // already flagged above
  const src = fs.readFileSync(routeFile, 'utf8');

  // Vercel cron triggers GET. If a route exports only POST/etc.,
  // every invocation 405s and the cron looks alive in logs.
  if (/\bexport\s+(?:async\s+function|const)\s+GET\b/.test(src)) {
    pass();
  } else {
    fail(
      `route ${routeFile} exports GET`,
      `no \`export const GET\` or \`export async function GET\` found — Vercel cron will 405 on every invocation. The ops dashboard will look quiet because cron_runs_total never increments.`,
      routeFile,
    );
  }

  // Every cron must be wrapped by withCronGuard so it shares the
  // single-flight lock, CRON_SECRET auth gate, and cron_runs audit.
  // The guard's first argument MUST equal the directory name —
  // otherwise metric labels diverge from dashboards.
  const guardMatch = src.match(/withCronGuard\s*\(\s*['"]([a-z0-9][a-z0-9-]*)['"]/);
  if (!guardMatch) {
    fail(
      `route ${routeFile} is wrapped by withCronGuard(…)`,
      `no withCronGuard('<name>', …) wrapper found — route bypasses single-flight lock, CRON_SECRET check, and cron_runs audit. If it runs at all, the run is invisible to money-and-dsar dashboards.`,
      routeFile,
    );
    continue;
  }
  const guardName = guardMatch[1];
  if (guardName === name) {
    pass();
  } else {
    fail(
      `withCronGuard name matches directory name (${name})`,
      `${routeFile} calls withCronGuard('${guardName}', …) but its directory is '${name}' — cron_runs_total{job="${guardName}"} will populate a phantom job while dashboards keyed on '${name}' show silent. Rename one of them.`,
      routeFile,
    );
  }
}

// ─── 5. Schedule sanity (valid 5-field crontab) ────────────────────────────
//
// Vercel accepts standard cron syntax. An invalid schedule is
// silently rejected at deploy time with an obscure error; catching
// it here means the verifier fails loud in CI instead.

function parseCronField(field, min, max) {
  // Accepts: '*', 'N', 'N-M', '*/N', 'N-M/N', 'N,M,K' (comma-separated
  // of any of the above).
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const withStep = part.split('/');
    if (withStep.length > 2) return false;
    const [range, step] = withStep;
    if (step !== undefined && !/^[1-9][0-9]*$/.test(step)) return false;

    if (range === '*') continue;
    const bounds = range.split('-');
    if (bounds.length === 1) {
      if (!/^[0-9]+$/.test(bounds[0])) return false;
      const n = Number(bounds[0]);
      if (n < min || n > max) return false;
    } else if (bounds.length === 2) {
      if (!/^[0-9]+$/.test(bounds[0]) || !/^[0-9]+$/.test(bounds[1])) return false;
      const a = Number(bounds[0]);
      const b = Number(bounds[1]);
      if (a < min || b > max || a > b) return false;
    } else {
      return false;
    }
  }
  return true;
}

function parseCron(expr) {
  if (typeof expr !== 'string') return { ok: false, reason: 'schedule is not a string' };
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { ok: false, reason: `schedule has ${fields.length} fields, expected 5 (minute hour day-of-month month day-of-week)` };
  }
  const [m, h, dom, mon, dow] = fields;
  if (!parseCronField(m, 0, 59)) return { ok: false, reason: `minute field "${m}" out of range 0-59` };
  if (!parseCronField(h, 0, 23)) return { ok: false, reason: `hour field "${h}" out of range 0-23` };
  if (!parseCronField(dom, 1, 31)) return { ok: false, reason: `day-of-month field "${dom}" out of range 1-31` };
  if (!parseCronField(mon, 1, 12)) return { ok: false, reason: `month field "${mon}" out of range 1-12` };
  // DOW: 0-7 (both 0 and 7 = Sunday, per POSIX). Vercel follows this.
  if (!parseCronField(dow, 0, 7)) return { ok: false, reason: `day-of-week field "${dow}" out of range 0-7` };
  return { ok: true };
}

for (let i = 0; i < scheduled.length; i++) {
  const entry = scheduled[i];
  const p = entry.path;
  const s = entry.schedule;
  const result = parseCron(s);
  if (result.ok) { pass(); continue; }
  fail(
    `schedule for ${p} is a valid 5-field crontab`,
    `crons[${i}].schedule="${s}" is invalid: ${result.reason}. Vercel will silently drop this schedule at deploy-time.`,
    vercelJsonPath,
  );
}

// ─── 6. Two daily crons firing at the exact same minute (warn) ────────────
//
// Vercel's shared-tenant scheduler queues same-minute invocations;
// spreading load by at least 5 minutes is a cheap resilience win
// and prevents cascading alerts when one cron fails and neighbours
// stall. Only flag when both are literal (no */N, no ranges) and
// match on {minute, hour, dom, month, dow}.

function normalizeLiteralSlot(expr) {
  const parts = expr.trim().split(/\s+/);
  // Treat `*` as a literal wildcard — compare slot-for-slot.
  return parts.join(' ');
}

const slotMap = new Map();   // slot → [{ path }]
for (const entry of scheduled) {
  const slot = normalizeLiteralSlot(entry.schedule);
  // Skip sub-hourly crons ('*/N' in minute field) — they're by
  // design multi-fire and spreading them is a separate concern.
  if (/^\*\//.test(slot.split(' ')[0])) continue;
  if (!slotMap.has(slot)) slotMap.set(slot, []);
  slotMap.get(slot).push(entry);
}

for (const [slot, entries] of slotMap) {
  if (entries.length <= 1) continue;
  warn(
    `crons share schedule slot "${slot}"`,
    `${entries.length} crons fire at the same slot: ${entries.map(e => e.path).join(', ')}. On Vercel's shared-tenant scheduler this queues invocations and on a failure cascades alerts together. Stagger by ≥ 5 minutes.`,
    vercelJsonPath,
  );
}

// ─── 7. Emit ───────────────────────────────────────────────────────────────

function emitAndExit() {
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const failed   = findings.filter(f => f.severity === 'fail').length;
  console.log(JSON.stringify({
    name: 'cron-scheduled',
    passed,
    failed,
    warnings,
    findings,
  }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
emitAndExit();
