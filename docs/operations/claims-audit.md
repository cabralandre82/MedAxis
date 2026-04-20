# Claims Audit — the evidence loop

**Owner:** solo operator + AI agents
**Cadence:** weekly (Tuesday 06:00 UTC via `.github/workflows/claims-audit.yml`)
**SLA:** weekly review; any `fail` must be resolved before the next run.

## Why this exists

Every skill, rule, runbook and invariant in this repo makes claims about
the platform — "audit chain is intact", "all 19 crons exist", "money is
always cents/bigint", "every skill crosslinks its runbook", "every
referenced feature flag is migrated".

Claims rot silently. Someone removes a cron from `vercel.json` but leaves
the runbook; a skill links to a file that was renamed; an invariant
documents a behaviour that was reverted. Each break makes the agent
answer wrong next time it's asked.

The claims audit is the **evidence loop** for this trust problem: a
weekly job that _verifies_ every plausible claim the docs make against
the actual codebase and fails loud when a claim becomes a lie.

## What it verifies (today)

Nine verifiers under `scripts/claims/`:

| Verifier                      | Claim being verified                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-skill-structure`       | Every `.cursor/skills/*/SKILL.md` has valid frontmatter + trigger phrase.                                                                                                                                                                                                                                    |
| `check-cross-links`           | Every link from skills/rules/runbooks/AGENTS.md resolves to a real file.                                                                                                                                                                                                                                     |
| `check-cron-claims`           | Every `/api/cron/X` mentioned in docs exists in `vercel.json` + as route.                                                                                                                                                                                                                                    |
| `check-feature-flags`         | Every `feature_flags` key referenced in docs has a migration defining it.                                                                                                                                                                                                                                    |
| `check-invariants`            | AGENTS.md invariants hold — see expanded matrix below.                                                                                                                                                                                                                                                       |
| `check-metric-emission`       | Every metric name backtick-cited in a runbook/skill/rule/AGENTS.md is actually emitted by the codebase.                                                                                                                                                                                                      |
| `check-skill-trigger-overlap` | No two skills' descriptions share a normalized trigger phrase — dispatch must be a disjoint partition.                                                                                                                                                                                                       |
| `check-rls-policy-coverage`   | Every table in `public` has either ≥ 1 `CREATE POLICY` or an explicit `-- @rls-policy(table_name): <justification>` marker. Protects against "deny-all by silence" drift.                                                                                                                                    |
| `check-env-documented`        | Every `process.env.X` read by production paths (`app/`, `lib/`, `middleware.ts`, `next.config.ts`, `components/`, `services/`) is templated in `.env.example` or annotated with `# @env-exempt: X — reason`. Protects onboarding + deploys from "app boots then silently degrades on missing env" foot-guns. |

Each verifier emits JSON to `scripts/claims/.results/<name>.json`:

```json
{
  "name": "cron-claims",
  "passed": 9,
  "failed": 0,
  "warnings": 10,
  "findings": [
    {
      "severity": "warn",
      "claim": "declared cron is documented",
      "detail": "/api/cron/churn-check in vercel.json but not referenced in any runbook/skill",
      "location": "vercel.json"
    }
  ]
}
```

`run-all.sh` aggregates them into a Markdown summary published to the
GitHub Actions step summary + attached as artifact (90-day retention).

### Invariants matrix (what `check-invariants.sh` enforces)

The invariants verifier encodes every AGENTS.md rule we can falsify in
code. Each check below is **"claim broken → this script flags it"**.

| Invariant                                               | Severity on break | How it's detected                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crypto uses AES-256-GCM**                             | fail              | `lib/crypto.ts` contains the `aes-256-gcm` algorithm string.                                                                                                                                                                                                                        |
| **Crypto reads ENCRYPTION_KEY**                         | fail              | `lib/crypto.ts` references `process.env.ENCRYPTION_KEY`.                                                                                                                                                                                                                            |
| **CSP has no `'unsafe-inline'` in `script-src`**        | fail              | `lib/security/csp.ts`'s `script-src` directive is strict.                                                                                                                                                                                                                           |
| **CSP uses a per-request nonce**                        | warn              | `lib/security/csp.ts` mentions `nonce`.                                                                                                                                                                                                                                             |
| **`audit_logs` is append-only**                         | fail              | No raw `DELETE FROM` / `UPDATE` against `audit_logs` outside `lib/audit/**` and tests.                                                                                                                                                                                              |
| **CSRF uses `__Host-csrf`**                             | warn              | `lib/security/csrf.ts` references `__Host-csrf`.                                                                                                                                                                                                                                    |
| **Money vocabulary is cents/bigint**                    | warn              | `lib/money.ts` mentions `cents` or `bigint`.                                                                                                                                                                                                                                        |
| **`X-Powered-By` stripped**                             | fail              | `next.config.ts` has `poweredByHeader: false`.                                                                                                                                                                                                                                      |
| **Stryker threshold ≥ 84%**                             | fail              | `stryker.config.mjs` has `break >= 84`.                                                                                                                                                                                                                                             |
| **Cron count in `vercel.json`**                         | fail/warn         | At least 15 crons declared.                                                                                                                                                                                                                                                         |
| **Required workflows present**                          | fail              | `ci.yml`, `cost-guard.yml`, `external-probe.yml`, `mutation-test.yml`, `offsite-backup.yml`, `restore-drill.yml`, `schema-drift.yml`, `zap-baseline.yml` all exist.                                                                                                                 |
| **Every skill has `SKILL.md`**                          | fail              | Each dir under `.cursor/skills/` has a `SKILL.md`.                                                                                                                                                                                                                                  |
| **Every rule has frontmatter + description**            | fail/warn         | Each `.cursor/rules/*.mdc` starts with `---` and declares `description:`.                                                                                                                                                                                                           |
| **API route has rate-limit or auth gate** (Wave 16.1)   | warn              | Every `app/api/*/route.ts` imports rate-limit OR rbac OR session client OR uses secret-based auth (CRON_SECRET, METRICS_SECRET, HMAC); routes under `/api/cron` and `/api/health` are blanket-exempt. Explicit opt-out: `// @auth: public` or `// @rate-limit: skipped — <reason>`. |
| **RLS auto-enable event trigger installed** (Wave 16.2) | fail              | `supabase/migrations/057_rls_auto_enable_safety_net.sql` defines `public.rls_auto_enable()` + `CREATE EVENT TRIGGER ensure_rls`.                                                                                                                                                    |
| **Migrations numbered sequentially** (Wave 16.3)        | fail              | `supabase/migrations/NNN_*.sql` from `001` to `MAX` with no gaps and no duplicates.                                                                                                                                                                                                 |
| **`.env.example` has no real secrets** (Wave 16.4)      | fail              | No matches for Resend `re_*`, Vercel `vcp_*`/`vrc_*`, OpenAI `sk-*`, GitHub `ghp_*`/`github_pat_*`, JWTs, or AWS `AKIA*`.                                                                                                                                                           |
| **`/(private)` layout gates auth** (Wave 16.5)          | fail              | `app/(private)/layout.tsx` reads session (`getCurrentUser`/`requireRole`) AND imports + calls `redirect()` from `next/navigation` targeting `/login`/`/unauthorized`/`/sign-in`.                                                                                                    |
| **Compliance crons documented** (Wave 16.6)             | fail              | Every cron in the compliance set — `verify-audit-chain`, `backup-freshness`, `rls-canary`, `dsar-sla-check`, `rotate-secrets`, `enforce-retention` — is referenced in at least one doc/skill/rule.                                                                                  |

## Severity philosophy

- **`fail`** — the claim is currently a lie (e.g. referenced cron doesn't exist, `poweredByHeader: false` is missing). Breaks CI. Fix before merging.
- **`warn`** — drift signal, not a broken invariant. Referenced doc missing (stub never written), flag defined but nobody mentions it, cron configured but undocumented. Tracked via weekly issue; triage at leisure.
- **`pass`** — claim held this run. Counted for trend visibility.

Failing the job outright on any warning would create alert fatigue — you'd silence the audit. Warnings are accumulated into a single tracking issue opened weekly so triage is a ritual, not an interrupt.

## Output

### Per-run artefacts (`scripts/claims/.results/`)

- `summary.md` — human-readable Markdown with per-verifier counts + findings
- `<verifier>.json` — machine-readable detail for each check

### CI integration

- **PR events** (on changes to scanned paths): the audit runs, any `fail` blocks merge, the Markdown summary is posted to the Actions summary tab.
- **Weekly cron** (Tuesday 06:00 UTC): opens/updates a GitHub issue labelled `claims-audit`, `operations`, `solo-operator` with the summary + a link to the run. Dedupes within a 7-day window.

## Local development

Run any single verifier:

```bash
./scripts/claims/check-skill-structure.sh        | jq
./scripts/claims/check-cross-links.sh            | jq
./scripts/claims/check-cron-claims.mjs           | jq
./scripts/claims/check-feature-flags.mjs         | jq
./scripts/claims/check-invariants.sh             | jq
./scripts/claims/check-metric-emission.mjs      | jq
./scripts/claims/check-skill-trigger-overlap.mjs | jq
./scripts/claims/check-rls-policy-coverage.mjs   | jq
./scripts/claims/check-env-documented.mjs        | jq
```

Run all + print the markdown summary:

```bash
./scripts/claims/run-all.sh
cat scripts/claims/.results/summary.md
```

Exit code `1` means at least one claim failed. Any non-zero warning
count still exits `0`.

## Adding a new verifier

1. Drop a script into `scripts/claims/` — bash, mjs, or ts.
2. The script MUST emit valid JSON on stdout with this shape:

   ```json
   {
     "name": "<slug-kebab>",
     "passed": <int>,
     "failed": <int>,
     "warnings": <int>,
     "findings": [
       { "severity": "fail|warn|info", "claim": "...", "detail": "...", "location": "..." }
     ]
   }
   ```

3. The script MUST exit `0` when no claim failed (warnings OK) and `1`
   when at least one claim failed.
4. Register it in the `VERIFIERS=(...)` array at the top of
   `scripts/claims/run-all.sh`.
5. If the verifier needs rules/skills/runbooks to change, also list the
   claim in the `docs/operations/claims-audit.md` table above.

### Claim ideas not yet implemented

Low-hanging extensions, ranked by effort × value:

- **`check-retention-policies`** — every entry in `lib/retention/policies.ts` corresponds to a real table + column pair; every destructive cron references a retention policy.
- **`check-anti-patterns`** — each `.cursor/rules/*.mdc` has an "Anti-patterns" section (keeps the rule a two-sided invariant, not one-sided advice).

## Relationship to existing loops

The claims audit is orthogonal to runtime verification loops:

| Loop                        | Verifies                      | When fails        |
| --------------------------- | ----------------------------- | ----------------- |
| `money-reconcile` (30 min)  | Runtime money drift           | Immediate alert   |
| `verify-audit-chain` (cron) | Runtime audit chain integrity | Immediate alert   |
| `backup-freshness` (cron)   | Runtime backup pipeline       | Immediate alert   |
| `rls-canary` (cron)         | Runtime tenant isolation      | Immediate alert   |
| `schema-drift` (CI)         | Schema vs. migrations match   | Blocks merge      |
| **`claims-audit` (weekly)** | **Docs vs. code match**       | **Weekly triage** |

Runtime loops catch production drift. The claims audit catches
_documentation_ drift — the kind that makes the AI agent answer stale
questions correctly-but-wrongly.

## Anti-patterns

- **Never commit fixes that silence a `fail` without addressing the claim.** If the runbook referenced a cron that no longer exists, either restore the cron or update the runbook — don't just remove the mention.
- **Never let weekly issues accumulate > 4 weeks.** Triage creates a forcing function; skipped triage means the audit is noise.
- **Never add verifiers that produce false positives.** A verifier that cries wolf poisons the trust of every other verifier. Filter placeholders + external paths aggressively.
- **Never raise warning threshold to silence drift.** Fix the underlying drift or delete the documentation — don't move the goal posts.

## Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-20 | Initial implementation — 5 verifiers (skill-structure, cross-links, cron-claims, feature-flags, invariants).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-20 | Wave 16 — 6 new invariants: API rate-limit/auth gate, RLS event-trigger, migration numbering, `.env.example` secret scan, `/(private)` layout gate, compliance-cron documentation. Surfaced a real defect in `/api/tracking` (no rate-limit on public token endpoint) — now fixed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-04-20 | `check-metric-emission` verifier added. Reads emission catalog from `lib/metrics.ts` registry + direct `incCounter`/`observeHistogram`/`setGauge` literals; flags any metric backtick-cited in docs that isn't emitted. Severity promoted to `fail` when the citing doc is compliance-critical (audit-chain, money, DSAR, RLS canary, backup, legal-hold, secret-rotation). Historical docs (`execution-log.md`, `PENDING.md`, `implementation-plan.md`, `performance-baseline.md`, `REVIEW-*.md`) are skipped. Surfaced 4 real doc drifts: `legal_hold_purge_blocked_total` (wrong word order in `retention-policy.md`), `duration_ms`/`age_seconds` (ambiguous column refs, now qualified as `table.column`), `runs_total` shorthand (expanded to `rls_canary_runs_total`), and two fake example metrics in `observability.mdc` replaced with real ones.                                                                                                                                                                                                                                                                                                                                                       |
| 2026-04-20 | Cross-link drift closed from 22 warnings to 0. Wrote 9 new docs (runbooks: `emergency-restore`, `security-incident`, `region-failure`; compliance: `anpd-art-48-notification`, `subprocessors`; templates: `anpd-incident-notice`, `breach-notice-holder`, `incident-comms`; security: `rls-matrix`; operations: `budget`) + fixed 3 path typos + corrected 1 aspirational reference (`ops/maintenance-mode.ts` doesn't exist; skill now directs operator to Vercel Pause Deployments).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-04-20 | `check-skill-trigger-overlap` verifier added. Enforces that the 11 skill descriptions form a **disjoint partition of the trigger phrase space** — no two skills can claim the same normalized trigger. Without this, agent dispatch becomes a coin-flip whenever triggers overlap. Extracts quoted phrases from each `description:` frontmatter field, normalizes (lowercase, collapse whitespace, unify `-_` to space), and fails on any key claimed by ≥ 2 skills. Short phrases (< 3 chars) are excluded to avoid flagging severity markers like `"P1"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-04-20 | 5 remaining feature-flag warnings closed. Each undocumented flag (`coupons.atomic_rpc`, `payments.atomic_confirm`, `backup.freshness_enforce`, `legal_hold.block_dsar_erasure`, `secrets.rotation_enforce`) now has a "Kill-switches & feature flags" section in its operationally-relevant runbook, in the `key = 'flag'` SQL form the verifier (and the 3-AM operator) both grep for. Full audit: 7 verifiers · 721 passing · 0 fails · 0 warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-04-20 | `check-rls-policy-coverage` verifier added. Enforces that every table in `public` has either ≥ 1 `CREATE POLICY` or an explicit `-- @rls-policy(table_name): <justification>` marker. Closes the "RLS enabled but no policy = silent deny-all" trap created by migration 057's safety-net event trigger. The verifier masks SQL comments and string literals with same-length whitespace (preserving byte positions) so references like `'COMMENT ON TABLE public.%'` inside error strings don't register as phantom tables; reserved-word filtering rejects `in`, `as`, `if`, etc. from the ref scan. Surfaced the 6 pre-existing service-role-only tables (`backup_runs`, `rate_limit_violations`, `rls_canary_log`, `legal_holds`, `dsar_audit`, `secret_rotations`) whose deny-all posture was intentional but undocumented; migration 058 formalizes their intent via the marker + `COMMENT ON TABLE` so the distinction survives into the running database (visible in `\d+` and dashboards). Adversarial test: injecting a policy-less table produces a clear fail pointing at the drift source. Full audit: 8 verifiers · 786 passing · 0 fails · 0 warnings.                                            |
| 2026-04-20 | `check-env-documented` verifier added. Scans the repo for every `process.env.X` read and cross-references it against `.env.example`: **fail** when a production path (`app/`, `lib/`, `middleware.ts`, `next.config.ts`, `components/`, `services/`, `hooks/`, `types/`) reads a var that isn't templated, **warn** when only scripts/tests reference it, **warn** when `.env.example` has a stale entry nothing reads. Supports `# @env-exempt: VAR — reason` for vars that are intentionally undocumented because they're platform-injected (Vercel runtime, Stryker, CI secrets) or consumed by CLI tooling outside app code. Closes a long-standing onboarding foot-gun: before this pass, `.env.example` listed 16 vars while the code read 81, meaning a fresh clone could boot and then silently degrade (Firebase push silent, Upstash rate-limit silent, Sentry silent, OpenAI OCR silent, Zenvia SMS silent, etc.). Also cleaned two stale entries (`NEXT_PUBLIC_APP_NAME` in `.env.example`/`DEPLOY.md`/`go-live-checklist.md` — nothing in code reads it; `GOOGLE_CLIENT_*` commented-out block — removed since OAuth isn't in scope). Full audit: 9 verifiers · 943 passing · 0 fails · 0 warnings. |
