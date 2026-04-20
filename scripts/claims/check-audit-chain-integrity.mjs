#!/usr/bin/env node
// scripts/claims/check-audit-chain-integrity.mjs
// Claim: the `public.audit_logs` hash chain — our most load-bearing
// compliance surface, cited by LGPD Art. 37 accountability and the
// 10-year fiscal retention — is described consistently across the
// single authoritative migration (046), the nightly verification
// cron, the P1 runbook, and the triage skill.
//
// Why this matters: when the chain breaks at 3 AM, the on-call
// operator is in the worst possible state — woken up, adrenalized,
// staring at a skill whose SQL snippet calls `public.verify_audit_chain`
// with the wrong column names. Every minute they debug a phantom
// schema the real tampering investigation is delayed. If the skill
// calls `public.create_audit_chain_checkpoint(p_from_seq, p_to_seq,
// …)` but that RPC was never migrated, the operator runs a query
// that returns "function does not exist", pages the DBA, and loses
// 30 minutes they didn't have. This verifier refuses to let those
// drifts survive a push.
//
// Ground truth (in descending authority):
//   1. supabase/migrations/046_audit_hash_chain.sql — defines the
//      schema, triggers, RPCs, CHECK values, and hash algorithm.
//   2. lib/metrics.ts Metrics constant — the counter/gauge names the
//      cron emits.
//   3. app/api/cron/verify-audit-chain/route.ts — the actual
//      consumer of the RPC; its param names and read columns must
//      match RETURNS TABLE.
//   4. docs/runbooks/audit-chain-tampered.md — the P1 runbook.
//   5. .cursor/skills/audit-chain-verify/SKILL.md — the triage
//      skill.
//
// Severity contract:
//   - fail — mechanical, falsifiable drift:
//       (a) migration 046 missing or unparseable;
//       (b) an expected function/trigger is missing;
//       (c) the cron uses a param or reads a column that the RPC
//           signature does not declare;
//       (d) the runbook or skill calls a `public.<fn>(…)` that has
//           no matching CREATE FUNCTION;
//       (e) the runbook or skill references a table column that the
//           migration does not create;
//       (f) a `reason = '<val>'` / `reason ILIKE '%val%'` literal
//           in docs does not resolve to a CHECK-allowed value;
//       (g) the `'sha256'` hash algo literal cited in docs does not
//           match the migration's.
//   - warn — documentation hygiene:
//       (h) the canonical payload key-set in the migration differs
//           between the IMMUTABLE function and the backfill DO block
//           (catches a future bug where the backfill canonicalises
//           differently from the trigger).

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

// ─── 1. Load the ground-truth migration ────────────────────────────────────

const migPath = 'supabase/migrations/046_audit_hash_chain.sql';
if (!fs.existsSync(migPath)) {
  fail('migration 046 exists',
       `${migPath} is the canonical source of the hash chain; without it nothing else can be verified`,
       migPath);
  emitAndExit();
}
pass();

const migSrcRaw = fs.readFileSync(migPath, 'utf8');

// Strip `--` line comments so our regexes don't get confused by
// commented-out snippets. Keep `$$ … $$` dollar-quoted bodies as
// they are — the trigger body IS code and we parse it.
function stripSqlLineComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}
const migSrc = stripSqlLineComments(migSrcRaw);

// ─── 2. Extract the schema primitives ──────────────────────────────────────

// 2a. Function definitions: name, return type, declared params.
//     Hand-rolled parser because SQL param lists contain nested
//     parens (`timestamptz DEFAULT (now() - interval '1 hour')`)
//     that break flat `\([^)]*\)` regexes.
function parseFunctions(sql) {
  const out = new Map();
  const HEADER = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = HEADER.exec(sql)) !== null) {
    const name = m[1];
    // Walk forward from the '(' to its matching ')', counting depth.
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    const paramsRaw = sql.slice(start, i - 1);
    // Split top-level commas in paramsRaw.
    const params = [];
    depth = 0;
    let buf = '';
    for (const ch of paramsRaw) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        if (buf.trim()) params.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) params.push(buf.trim());
    const paramNames = params.map(p => {
      // Strip an optional mode token (IN/OUT/INOUT/VARIADIC).
      const mm = p.match(/^(?:IN\s+|OUT\s+|INOUT\s+|VARIADIC\s+)?([a-z_][a-z0-9_]*)\s/i);
      return mm ? mm[1] : null;
    }).filter(Boolean);
    // Advance past whitespace and look for RETURNS.
    const tail = sql.slice(i).match(/^\s*RETURNS\s+([^\n]+?)\s*(?:LANGUAGE|AS)\s/i);
    const returns = tail ? tail[1].trim() : null;
    out.set(name, { paramNames, returns });
  }
  return out;
}
const funcs = parseFunctions(migSrc);

// 2b. RETURNS TABLE columns of verify_audit_chain (the only function
// whose return-column names matter downstream). Depth-aware because
// SQL type expressions inside RETURNS TABLE can carry their own
// parens (e.g. `numeric(10, 2)`).
function parseReturnsTable(sql, fnName) {
  // Anchor on the CREATE header so we pick up the right function
  // even in a file with several CREATE OR REPLACE FUNCTION blocks.
  const headerRe = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
    'i',
  );
  const headerMatch = sql.match(headerRe);
  if (!headerMatch) return null;
  // Skip past the param list.
  let i = headerMatch.index + headerMatch[0].length;
  let depth = 1;
  while (i < sql.length && depth > 0) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
    i++;
  }
  // Find `RETURNS TABLE (`.
  const tail = sql.slice(i);
  const rtMatch = tail.match(/^\s*RETURNS\s+TABLE\s*\(/i);
  if (!rtMatch) return null;
  let j = i + rtMatch[0].length;
  depth = 1;
  const start = j;
  while (j < sql.length && depth > 0) {
    if (sql[j] === '(') depth++;
    else if (sql[j] === ')') depth--;
    j++;
  }
  const inner = sql.slice(start, j - 1);
  // Split top-level commas.
  const cols = [];
  depth = 0;
  let buf = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      if (buf.trim()) cols.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) cols.push(buf.trim());
  return cols.map(c => {
    const mm = c.match(/^([a-z_][a-z0-9_]*)\s/i);
    return mm ? mm[1] : null;
  }).filter(Boolean);
}
const verifyReturnCols = parseReturnsTable(migSrc, 'verify_audit_chain');

// 2c. Trigger names.
function parseTriggers(sql) {
  const out = new Map();
  const RE = /CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)\s+BEFORE\s+([A-Z ,]+?)\s+ON\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = RE.exec(sql)) !== null) {
    out.set(m[1], { ops: m[2].split(/\s*,\s*/).map(s => s.trim().toUpperCase()), table: m[3] });
  }
  return out;
}
const triggers = parseTriggers(migSrc);

// 2d. Column set per table (only audit_logs + audit_chain_checkpoints).
function parseTableColumns(sql, table) {
  // ALTER TABLE … ADD COLUMN pieces, plus initial CREATE TABLE.
  const cols = new Set();
  const create = sql.match(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\);`, 'i'),
  );
  if (create) {
    // Each line inside is "name  type [CHECK …] [NOT NULL] [DEFAULT …][,]"
    // but CHECK expressions can contain commas, so split at depth 0.
    let depth = 0, buf = '';
    for (const ch of create[1]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        const mm = buf.trim().match(/^([a-z_][a-z0-9_]*)\s/i);
        if (mm && !['primary','constraint','check','unique','foreign'].includes(mm[1].toLowerCase())) {
          cols.add(mm[1]);
        }
        buf = ''; continue;
      }
      buf += ch;
    }
    const mm = buf.trim().match(/^([a-z_][a-z0-9_]*)\s/i);
    if (mm && !['primary','constraint','check','unique','foreign'].includes(mm[1].toLowerCase())) {
      cols.add(mm[1]);
    }
  }
  const addColRe = new RegExp(
    `ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+([\\s\\S]*?);`,
    'gi',
  );
  let alterMatch;
  while ((alterMatch = addColRe.exec(sql)) !== null) {
    const body = alterMatch[1];
    const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s/gi;
    let a;
    while ((a = addRe.exec(body)) !== null) cols.add(a[1]);
  }
  return cols;
}
const auditLogsCols = parseTableColumns(migSrc, 'audit_logs');
const checkpointCols = parseTableColumns(migSrc, 'audit_chain_checkpoints');

// 2e. CHECK values for audit_chain_checkpoints.reason.
function parseCheckValues(sql, table, column) {
  const tbl = sql.match(
    new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b[\\s\\S]*?\\);`, 'i'),
  );
  if (!tbl) return null;
  const re = new RegExp(`\\b${column}\\b[\\s\\S]*?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([\\s\\S]*?)\\)\\s*\\)`, 'i');
  const m = tbl[0].match(re);
  if (!m) return null;
  const values = [];
  const RE = /'([A-Za-z0-9_]+)'/g;
  let v;
  while ((v = RE.exec(m[1])) !== null) values.push(v[1]);
  return values;
}
const allowedReasons = parseCheckValues(migSrc, 'audit_chain_checkpoints', 'reason') ?? [];

// 2f. Hash algorithm literals — every `extensions.digest(payload,
// '<algo>')` call must use the same algo. The payload expression can
// carry nested parens + nested quoted literals (`convert_to(x,
// 'UTF8')`), so a naive lazy regex would grab the inner 'UTF8' as
// the hash algorithm. We walk to the matching `)` at depth 0 and
// take the LAST single-quoted literal inside — that's the algo.
function parseHashAlgos(sql) {
  const out = new Set();
  const HEADER = /extensions\.digest\s*\(/gi;
  let m;
  while ((m = HEADER.exec(sql)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "'") {
        // Skip past the string literal entirely (handles embedded '').
        i++;
        while (i < sql.length) {
          if (sql[i] === "'") {
            if (sql[i + 1] === "'") { i += 2; continue; }
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    const body = sql.slice(start, i - 1);
    // Last non-nested single-quoted literal (skip literals inside
    // nested parens by tracking depth while scanning).
    let last = null;
    let d = 0;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (ch === "'" && d === 0) {
        const end = body.indexOf("'", k + 1);
        if (end > k) {
          last = body.slice(k + 1, end);
          k = end;
        }
      }
    }
    if (last) out.add(last.toLowerCase());
  }
  return out;
}
const migHashAlgos = parseHashAlgos(migSrc);

// 2g. Canonical payload keys — extracted both from the
// `audit_canonical_payload` function and from the backfill DO
// block, so we can compare them for drift.
function parseCanonicalKeys(sql, anchorPattern) {
  const m = sql.match(anchorPattern);
  if (!m) return null;
  const keys = [];
  const RE = /'([a-z_][a-z0-9_]*)'\s*,/g;
  let k;
  while ((k = RE.exec(m[1])) !== null) keys.push(k[1]);
  return keys;
}
const canonicalKeysFn = parseCanonicalKeys(migSrc,
  /audit_canonical_payload[\s\S]*?jsonb_build_object\s*\(([\s\S]*?)\)\s*\$\$/);
const canonicalKeysBackfill = parseCanonicalKeys(migSrc,
  /DO\s+\$backfill\$[\s\S]*?jsonb_build_object\s*\(([\s\S]*?)\)::text/);

// ─── 3. Validate migration has everything downstream relies on ─────────────

const EXPECTED_FUNCTIONS = [
  'audit_canonical_payload',
  'audit_logs_chain_before_insert',
  'audit_logs_prevent_mutation',
  'verify_audit_chain',
  'audit_purge_retention',
];
for (const fn of EXPECTED_FUNCTIONS) {
  if (funcs.has(fn)) pass();
  else fail(`migration 046 defines public.${fn}()`,
            `${fn} is expected by either the cron, runbook, or skill but is missing in ${migPath}`,
            migPath);
}

const EXPECTED_TRIGGERS = [
  { name: 'audit_logs_chain_trg',          ops: ['INSERT'] },
  { name: 'audit_logs_prevent_update_trg', ops: ['UPDATE'] },
  { name: 'audit_logs_prevent_delete_trg', ops: ['DELETE'] },
];
for (const t of EXPECTED_TRIGGERS) {
  const got = triggers.get(t.name);
  if (!got) {
    fail(`trigger ${t.name} is installed on audit_logs`,
         `append-only / hash-chain enforcement requires ${t.name} — not found in ${migPath}`,
         migPath);
    continue;
  }
  if (got.table !== 'audit_logs') {
    fail(`trigger ${t.name} targets public.audit_logs`,
         `found trigger but on table "${got.table}" not audit_logs`,
         migPath);
    continue;
  }
  const opsMatch = t.ops.every(op => got.ops.includes(op));
  if (!opsMatch) {
    fail(`trigger ${t.name} fires on ${t.ops.join(',')}`,
         `found trigger but on ops "${got.ops.join(',')}" — expected ${t.ops.join(',')}`,
         migPath);
    continue;
  }
  pass();
}

if (migHashAlgos.size === 0) {
  fail('migration 046 uses extensions.digest()',
       'no digest() call found — hash chain cannot be cryptographic without a hash function',
       migPath);
} else if (migHashAlgos.size > 1) {
  fail('migration 046 uses a single hash algorithm',
       `multiple algos found in digest() calls: ${[...migHashAlgos].join(', ')} — verify and trigger MUST agree`,
       migPath);
} else {
  pass();
}
const migHashAlgo = [...migHashAlgos][0] ?? null;

if (allowedReasons.length === 0) {
  fail('audit_chain_checkpoints.reason has a CHECK constraint',
       'no CHECK(reason IN (…)) extracted — an open-ended reason column means anything qualifies as a "legitimate purge" and the verifier cannot tell',
       migPath);
} else pass();

if (!verifyReturnCols || verifyReturnCols.length === 0) {
  fail('verify_audit_chain RETURNS TABLE is extractable',
       'cron reads specific columns by name — if we can\'t extract the declared set, a column rename would go undetected',
       migPath);
} else pass();

if (canonicalKeysFn && canonicalKeysBackfill) {
  const fnSet = new Set(canonicalKeysFn);
  const bfSet = new Set(canonicalKeysBackfill);
  const only_fn = [...fnSet].filter(k => !bfSet.has(k));
  const only_bf = [...bfSet].filter(k => !fnSet.has(k));
  if (only_fn.length === 0 && only_bf.length === 0) pass();
  else {
    warn('canonical payload keys match between trigger function and backfill DO block',
         `drift between audit_canonical_payload and the backfill DO block — trigger-only: [${only_fn.join(', ')}] / backfill-only: [${only_bf.join(', ')}]. Backfilled rows hash differently from trigger-inserted rows, so verify_audit_chain will flag historical boundary as tampered.`,
         migPath);
  }
}

// ─── 4. Cross-check the cron route ─────────────────────────────────────────

const cronPath = 'app/api/cron/verify-audit-chain/route.ts';
if (!fs.existsSync(cronPath)) {
  fail('cron /api/cron/verify-audit-chain/route.ts exists',
       `the nightly verification cron is the only thing that turns hash-chain tampering into a P1 page`,
       cronPath);
} else {
  pass();
  const cronSrc = fs.readFileSync(cronPath, 'utf8');

  // Does it call supabase.rpc('verify_audit_chain', …)?
  const rpcCallMatch = cronSrc.match(/\.rpc\s*\(\s*['"]verify_audit_chain['"]\s*,\s*\{([\s\S]*?)\}\s*\)/);
  if (!rpcCallMatch) {
    fail('cron calls supabase.rpc("verify_audit_chain", …)',
         'no direct .rpc("verify_audit_chain", …) call found — the cron either uses a different RPC name or builds the call dynamically (fragile)',
         cronPath);
  } else {
    pass();
    // Extract passed param keys and verify they match the RPC's param list.
    const argsBody = rpcCallMatch[1];
    const passedParams = new Set();
    for (const m of argsBody.matchAll(/\b(p_[a-z_]+)\s*:/g)) passedParams.add(m[1]);
    const rpcParams = funcs.get('verify_audit_chain')?.paramNames ?? [];
    const rpcParamSet = new Set(rpcParams);
    for (const p of passedParams) {
      if (rpcParamSet.has(p)) pass();
      else fail(`cron param ${p} is declared by public.verify_audit_chain(…)`,
                `cron passes ${p} but the RPC only declares [${rpcParams.join(', ')}] — Postgres would raise "function does not exist" at first invocation`,
                cronPath);
    }
  }

  // Does it read RPC columns that the RETURNS TABLE actually provides?
  // Heuristic: any `summary?.<identifier>` or `<var>.<identifier>`
  // inside the VerifyRow interface in the cron source. Extract the
  // VerifyRow interface body.
  const ifaceMatch = cronSrc.match(/interface\s+VerifyRow\s*\{([\s\S]*?)\}/);
  if (ifaceMatch && verifyReturnCols) {
    const returnSet = new Set(verifyReturnCols);
    const ifaceKeys = [];
    const KEY_RE = /^\s*([a-z_][a-z0-9_]*)\s*:/gm;
    let km;
    while ((km = KEY_RE.exec(ifaceMatch[1])) !== null) ifaceKeys.push(km[1]);
    for (const k of ifaceKeys) {
      if (returnSet.has(k)) pass();
      else fail(`cron reads RPC column ${k} from verify_audit_chain`,
                `VerifyRow declares \`${k}\` but RETURNS TABLE only provides [${verifyReturnCols.join(', ')}] — JSON field will be undefined and the cron will silently treat every run as ok=0`,
                cronPath);
    }
  }

  // Cron emits the three expected metrics?
  const EXPECTED_METRIC_KEYS = ['AUDIT_CHAIN_VERIFY_TOTAL', 'AUDIT_CHAIN_BREAK_TOTAL', 'AUDIT_CHAIN_LAST_VERIFY_TS'];
  for (const k of EXPECTED_METRIC_KEYS) {
    if (new RegExp(`Metrics\\.${k}\\b`).test(cronSrc)) pass();
    else fail(`cron emits Metrics.${k}`,
              `dashboards and the AuditChain* alert rules depend on ${k} being emitted on every run — missing from the cron`,
              cronPath);
  }
}

// ─── 5. Cross-check runbook + skill against schema ─────────────────────────

const docs = [
  { path: 'docs/runbooks/audit-chain-tampered.md', label: 'runbook' },
  { path: '.cursor/skills/audit-chain-verify/SKILL.md', label: 'skill' },
];

for (const doc of docs) {
  if (!fs.existsSync(doc.path)) {
    fail(`${doc.label} ${doc.path} exists`,
         `canonical ${doc.label} for the audit-chain surface — without it the on-call has no procedure`,
         doc.path);
    continue;
  }
  pass();
  const src = fs.readFileSync(doc.path, 'utf8');

  // 5a. Every `public.<fn>(` mentioned must exist in migration 046.
  //     Only flag snake_case identifiers (AUDIT_CHAIN_BREAK_TOTAL
  //     shouldn't be matched).
  const fnRefs = new Set();
  for (const m of src.matchAll(/public\.([a-z_][a-z0-9_]*)\s*\(/g)) fnRefs.add(m[1]);
  for (const fn of fnRefs) {
    // Filter out non-function references (types/tables called with
    // `public.audit_logs(` would be rare but possible). Only flag if
    // the name isn't a table we already know about.
    if (fn === 'audit_logs' || fn === 'audit_chain_checkpoints' ||
        fn === 'server_logs' || fn === 'cron_runs') continue;
    if (funcs.has(fn)) pass();
    else fail(`${doc.label} references public.${fn}()`,
              `${doc.path} instructs the operator to call \`public.${fn}(…)\` but migration 046 does not define it — at 3am this returns "function does not exist" and the runbook is useless`,
              doc.path);
  }

  // 5b. Every audit_chain_checkpoints.<col> reference must exist.
  for (const m of src.matchAll(/audit_chain_checkpoints[\s\S]{0,3}\.([a-z_][a-z0-9_]*)/g)) {
    const col = m[1];
    if (checkpointCols.has(col)) pass();
    else fail(`${doc.label} references audit_chain_checkpoints.${col}`,
              `${doc.path} references \`audit_chain_checkpoints.${col}\` but migration 046 does not create that column — the snippet fails with "column does not exist"`,
              doc.path);
  }

  // Also look for bare references like `new_genesis_hash`, `signer_key_id`
  // inside table-qualified contexts. We catch these by scanning any
  // backtick-quoted column-style token and testing against the column
  // set IFF the token appears in a "column" column of a markdown
  // table whose surrounding header mentions "checkpoint".
  // Too fragile — instead we rely on SQL-snippet scraping below.

  // 5c. Any `reason = '<val>'` / `reason ILIKE '%val%'` literal must
  //     resolve to an allowed CHECK value.
  const reasonLiterals = new Set();
  for (const m of src.matchAll(/reason\s*=\s*'([A-Za-z0-9_]+)'/gi)) reasonLiterals.add(m[1]);
  for (const m of src.matchAll(/reason\s+ILIKE\s*'%([A-Za-z0-9_]+)%'/gi)) reasonLiterals.add(m[1]);
  for (const lit of reasonLiterals) {
    if (allowedReasons.some(r => r === lit || r.includes(lit))) pass();
    else fail(`${doc.label} reason literal '${lit}' is a valid CHECK value`,
              `${doc.path} instructs the operator to filter \`reason = '${lit}'\` / \`ILIKE '%${lit}%'\` but migration 046's CHECK only allows [${allowedReasons.map(r => `'${r}'`).join(', ')}] — the query returns zero rows and the operator mis-classifies tampering as legitimate purge`,
              doc.path);
  }

  // 5d. Any `extensions.digest(payload, '<algo>')` in snippets must
  //     match the migration's algo. Reuse the depth-aware parser so
  //     we don't mistake the inner `convert_to(x, 'UTF8')` literal
  //     for the hash algo.
  const docAlgos = parseHashAlgos(src);
  for (const algo of docAlgos) {
    if (!migHashAlgo) continue;
    if (algo === migHashAlgo) pass();
    else fail(`${doc.label} digest() algo '${algo}' matches migration`,
              `${doc.path} recomputes the hash with \`'${algo}'\` but migration 046 uses \`'${migHashAlgo}'\` — operator's recomputed hash will never match stored_hash, so the diagnostic in the runbook lies to them`,
              doc.path);
  }

  // 5e. Every verify_audit_chain-return column referenced in docs
  //     (`first_broken_seq`, `rows_scanned`, etc.) must be in
  //     verifyReturnCols. We extract bare-word identifiers
  //     immediately following the RPC call's SQL.
  //     Heuristic: parse ```sql``` fenced blocks, find any line
  //     that looks like `select * from public.verify_audit_chain`,
  //     then within 40 lines after that line scan for identifiers
  //     that *could* be column references and aren't SQL keywords.
  //     False-positive-prone → cap to identifiers that appear in a
  //     `t.<col>` or `.<col>` position.
  if (verifyReturnCols) {
    const snippet = src; // whole doc
    const sqlBlocks = [...snippet.matchAll(/```sql([\s\S]*?)```/g)].map(x => x[1]);
    const joined = sqlBlocks.join('\n');
    if (/verify_audit_chain/.test(joined)) {
      // Tokens that the skill/runbook highlight as RPC return columns.
      // Only match words that would be column names in the context
      // of a SELECT result (i.e. referenced bare or after a dot).
      // We do a whitelist check: if the doc uses ONE of the
      // documented `verifyReturnCols`-style tokens, require it
      // exists in verifyReturnCols.
      const CANDIDATE_NAMES = new Set([
        'scanned_rows', 'inconsistent_count', 'first_broken_seq',
        'first_broken_id', 'verified_from', 'verified_to',
        'rows_scanned', 'rows_ok', 'rows_failed', 'ok',
      ]);
      const returnSet = new Set(verifyReturnCols);
      // Find candidates present in the doc body
      for (const name of CANDIDATE_NAMES) {
        const re = new RegExp(`\\b${name}\\b`);
        if (!re.test(src)) continue;
        if (returnSet.has(name)) pass();
        else fail(`${doc.label} RPC column reference ${name} exists in verify_audit_chain RETURNS TABLE`,
                  `${doc.path} names the column \`${name}\` in a diagnostic snippet/table but RETURNS TABLE only provides [${verifyReturnCols.join(', ')}] — the operator's query fails or silently returns nulls`,
                  doc.path);
      }
    }
  }
}

// ─── 6. Retention policy must use the SECURITY DEFINER RPC ─────────────────

const retPath = 'lib/retention/policies.ts';
if (fs.existsSync(retPath)) {
  const retSrc = fs.readFileSync(retPath, 'utf8');
  // The RP that governs audit_logs must cite the RPC name — the raw
  // unconditional-remove path is blocked by the prevent_delete
  // trigger, so any future code trying to drop rows from audit_logs
  // would hit prod at 2am on the 1st of the month and fail
  // silently. The catalog entry keeps the escape hatch discoverable.
  if (/audit_logs[\s\S]*?audit_purge_retention/.test(retSrc)) pass();
  else warn('retention catalog cites audit_purge_retention for audit_logs',
            `${retPath}'s audit_logs entry does not mention audit_purge_retention — someone reading the catalog might try a raw DELETE, which the prevent_delete trigger blocks at run-time with no clear remediation path`,
            retPath);
}

// ─── 7. Emit ───────────────────────────────────────────────────────────────

function emitAndExit() {
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const failed   = findings.filter(f => f.severity === 'fail').length;
  console.log(JSON.stringify({
    name: 'audit-chain-integrity',
    passed,
    failed,
    warnings,
    findings,
  }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}
emitAndExit();
