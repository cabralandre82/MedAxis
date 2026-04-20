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

Five verifiers under `scripts/claims/`:

| Verifier                | Claim being verified                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `check-skill-structure` | Every `.cursor/skills/*/SKILL.md` has valid frontmatter + trigger phrase. |
| `check-cross-links`     | Every link from skills/rules/runbooks/AGENTS.md resolves to a real file.  |
| `check-cron-claims`     | Every `/api/cron/X` mentioned in docs exists in `vercel.json` + as route. |
| `check-feature-flags`   | Every `feature_flags` key referenced in docs has a migration defining it. |
| `check-invariants`      | AGENTS.md invariants hold (AES-GCM, no `unsafe-inline`, money is cents…). |

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
./scripts/claims/check-skill-structure.sh  | jq
./scripts/claims/check-cross-links.sh      | jq
./scripts/claims/check-cron-claims.mjs     | jq
./scripts/claims/check-feature-flags.mjs   | jq
./scripts/claims/check-invariants.sh       | jq
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

- **`check-metric-emission`** — every metric name referenced in runbooks (`money_drift_total`, `rls_canary_violations_total`, `rate_limit_suspicious_ips_total`, `csrf_blocked_total`, …) has a matching emission in `lib/metrics.ts` or an `app/api/**` route.
- **`check-rls-coverage`** — every table in `supabase/migrations/` that stores tenant data has an explicit `enable row level security` AND at least one policy (catches migrations that add a table but forget RLS).
- **`check-skill-trigger-overlap`** — no two skills' descriptions claim the same trigger phrase; reduces agent dispatch ambiguity.
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

| Date       | Change                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 2026-04-20 | Initial implementation — 5 verifiers (skill-structure, cross-links, cron-claims, feature-flags, invariants). |
