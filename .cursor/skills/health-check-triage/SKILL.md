---
name: health-check-triage
description: Triages a failing `/api/health/live`, `/ready`, or `/deep` endpoint — isolates which sub-check failed, routes to the right specific runbook, applies kill-switch if the deep probe itself is hot. Use when the user says "health check down", "UptimeRobot incident", "ready 503", "deep degraded", "status page yellow", or when UptimeRobot/Sentry flags `HealthCheckDegraded`. P2 by default; P1 if `ready` stays 503 for more than 5 min.
---

# Health-check triage (entry point to most infra incidents)

`/api/health/*` is the canary that _every_ other runbook depends on.
The goal of this skill is NOT to fix downstream issues — it's to
classify them fast and route to the right specific skill/runbook.

Full runbook: `docs/runbooks/health-check-failing.md`.

## The three layers

| Endpoint            | What it checks                                      | Who calls it                                        |
| ------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `/api/health/live`  | Process alive — only fails during deploy            | Vercel load balancer                                |
| `/api/health/ready` | DB reachable + env + circuit breakers closed        | UptimeRobot + status page                           |
| `/api/health/deep`  | Ready + cron freshness + webhook backlog + upstream | Synthetic monitors + on-call checks (auth required) |

## Workflow

```
Health-check triage:
- [ ] 1. Determined which layer failed (live / ready / deep)
- [ ] 2. Parsed `checks` field from JSON response
- [ ] 3. Classified sub-check (database / circuits / env / cronFreshness / webhookBacklog)
- [ ] 4. Handed off to specific runbook or skill
- [ ] 5. If none: root-cause directly, document in skill catalog after
```

## Step 1 — hit all three endpoints

```bash
curl -si https://clinipharma.com.br/api/health/live  | head -3
curl -si https://clinipharma.com.br/api/health/ready | head -3

# deep is auth-guarded
curl -si -H "Authorization: Bearer $CRON_SECRET" \
  https://clinipharma.com.br/api/health/deep | head -20
```

Interpretation:

- `live` 503 → **impossible in steady state**; means a deploy is failing health-startup. Rollback or investigate runtime crash.
- `ready` 503 → infra layer down (DB, env, breakers). Continue.
- `deep` 503 but `ready` 200 → cron/webhook/upstream layer. Continue.

## Step 2 — parse the `checks` field

Example `ready` response:

```json
{
  "status": "degraded",
  "checks": {
    "env": { "ok": true },
    "database": { "ok": false, "error": "connection refused", "latencyMs": 503 },
    "circuits": { "ok": false, "error": "Open circuits: asaas" },
    "migrations": { "ok": true }
  }
}
```

Each sub-check comes with `ok`, `error`, optional `latencyMs`.

Example `deep` response (supersets `ready`):

```json
{
  "checks": {
    ...ready subset...,
    "cronFreshness":  { "ok": false, "stale": ["dsar-sla-check"], "maxAgeMs": 9200000 },
    "webhookBacklog": { "ok": false, "failures": { "asaas": 14 } },
    "secretRotation": { "ok": true, "overdueCount": 0 },
    "rlsCanary":      { "ok": true, "lastRunAt": "..." }
  }
}
```

## Step 3 — classify and route

Read `checks.*.ok = false` in priority order. The FIRST failing check is usually the root cause; subsequent ones may be cascading.

| Failing sub-check                                         | Route to                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `env.ok = false`                                          | Vercel env vars missing. Restore from `docs/execution-log.md` inventory. No runbook needed — manual restore. |
| `database.ok = false`                                     | `docs/runbooks/database-unavailable.md` (not yet written) OR open Supabase ticket directly.                  |
| `circuits.ok = false` + name `asaas`/`clicksign`/`resend` | `docs/runbooks/external-integration-down.md` (not yet written) with the specific circuit name.               |
| `migrations.ok = false`                                   | Migration drift. Check `.github/workflows/schema-drift.yml` last run.                                        |
| `cronFreshness.ok = false`                                | Inspect `public.cron_runs` — step A below. Likely `cron-job-failing.md`.                                     |
| `webhookBacklog.ok = false`                               | Step B below. Route to `docs/runbooks/webhook-replay.md`.                                                    |
| `secretRotation.ok = false`                               | Skill `.cursor/skills/secret-rotate/SKILL.md`.                                                               |
| `rlsCanary.ok = false`                                    | Skill `.cursor/skills/rls-violation-triage/SKILL.md`.                                                        |
| `backupFreshness.ok = false`                              | Skill `.cursor/skills/backup-verify/SKILL.md`.                                                               |

## Step A — cron freshness details

```sql
select job_name,
       max(started_at) filter (where status = 'success') as last_success,
       now() - max(started_at) filter (where status = 'success') as age
  from public.cron_runs
 group by job_name
 order by age desc nulls first;
```

Thresholds:

- Every-15-min cron with age > 2h → investigate (`cron-job-failing.md`)
- Daily cron with age > 25h → investigate
- NULL `last_success` for any job → Vercel Cron Jobs UI: is the schedule configured?

If NO jobs at all appear, Vercel cron may be paused. Check **Vercel → Project → Cron Jobs**.

## Step B — webhook backlog details

```sql
select source, count(*) as failures
  from public.webhook_events
 where status = 'failed'
   and received_at > now() - interval '1 hour'
 group by source
 order by failures desc;
```

Any `source` with > 10 failures/hour → `docs/runbooks/webhook-replay.md` with that source name.

## Step C — Prometheus dump (deep only)

For broader pattern visibility:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  'https://clinipharma.com.br/api/health/deep?format=prometheus'
```

Key signals and their routes:

| Metric                                                 | Threshold    | Runbook                                   |
| ------------------------------------------------------ | ------------ | ----------------------------------------- |
| `csrf_blocked_total`                                   | > 30/min     | `docs/runbooks/csrf-block-surge.md`       |
| `rbac_rpc_errors_total`                                | > 5 in 5 min | `docs/runbooks/rbac-permission-denied.md` |
| `cron_run_total{status="failed"}`                      | any non-zero | `docs/runbooks/cron-job-failing.md`       |
| `rate_limit_suspicious_ips_total{severity="critical"}` | any non-zero | `.cursor/skills/rate-limit-abuse/`        |
| `money_drift_total`                                    | any non-zero | `.cursor/skills/money-drift/`             |

## Step 4 — mitigations before handoff

### Disable deep endpoint under pressure

If `/api/health/deep` is itself expensive (queries wedging on `cron_runs`) and downstream checks are piling:

```sql
update public.feature_flags
   set enabled = false
 where key = 'observability.deep_health';
```

Response becomes `200 {status:'disabled'}`. Monitors stay green. You lose breakdown detail — trade-off acceptable during acute triage.

### Force circuit breaker HALF_OPEN

Circuits auto-recover after `recoveryTimeMs` (30s default). To accelerate after confirming upstream is back:

```bash
# Deploy a new revision without code change — clears in-memory state
vercel --prod --force --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

## Anti-patterns

- **Never skip reading the `checks` object** — fixing what you think is wrong without classifying is how you extend outages.
- **Never assume `deep` being 503 means the site is down** — if `ready` is 200, user impact is zero and you have time.
- **Never silence a `cronFreshness.ok = false`** — silent cron failure = silent drift (audit chain, backups, RLS canary).
- **Never modify `circuits.open` state directly** — use the normal recovery path or force-deploy.
- **Never close the incident** without all previously failing sub-checks green for at least 5 min.

## Related

- Full runbook: `docs/runbooks/health-check-failing.md`
- Synthetic monitoring strategy: `docs/observability/synthetic-monitoring.md`
- Observability rule: `.cursor/rules/observability.mdc`
- Downstream skills: `secret-rotate`, `rls-violation-triage`, `backup-verify`, `money-drift`, `rate-limit-abuse`
