# Synthetic Monitoring

| Field         | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Owner         | Engineering / SRE                                                                                        |
| Last reviewed | 2026-04-19                                                                                               |
| Pairs with    | `docs/observability/slos.md`, `docs/observability/burn-rate.md`                                          |
| Layers active | **L1** (in-cluster cron, 5 min) + **L2** (external availability, 5 min) + **L3** (external DAST, weekly) |

## Why synthetic monitoring exists

In-process metrics tell you _the function ran_. Synthetic monitoring
tells you _someone could reach the function in the first place_. The
two are complementary:

| Failure                         | In-process counter | Synthetic probe |
| ------------------------------- | ------------------ | --------------- |
| Route handler throws            | YES (5xx)          | YES (5xx)       |
| Cold-start panic                | NO (never started) | YES (502)       |
| DNS misconfig                   | NO                 | YES             |
| Vercel project paused / deleted | NO                 | YES             |
| Firewall / regional blackhole   | NO                 | YES             |

We have **three layers**:

1. **In-cluster availability probe** — `/api/cron/synthetic-probe`,
   every 5 min, hits `/api/health/{live,ready}` + `/api/status/summary`
   from _another_ function in the same Vercel project. Catches
   everything except a full Vercel project outage.
2. **External availability probe** —
   `.github/workflows/external-probe.yml`, every 5 min, hits the same
   public URLs from a GitHub Actions runner. GitHub Actions runs on
   Microsoft Azure, completely independent of our Vercel project, so
   it stays up when Vercel is down. Catches the failures the
   in-cluster probe cannot see.
3. **External security probe (DAST)** —
   `.github/workflows/zap-baseline.yml`, weekly OWASP ZAP baseline
   scan against the production URL. Catches a different failure
   class entirely: not "is it up?" but "is it still configured
   securely?" — header drift, TLS regressions, info disclosure.
   Detailed in [`docs/security/dynamic-scanning.md`](../security/dynamic-scanning.md).

All three layers are shipped and active. The L1/L2 split is
load-bearing for availability: a green L1 + red L2 means our edge is
fine but the platform is unreachable from outside (DNS, TLS,
Vercel-wide outage); a red L1 + green L2 means the public surface is
healthy but our internal control plane is broken (cron infra, DB
connectivity from cron, etc.). L3 is orthogonal: a green L1 + L2 + red
L3 means the app is up and serving traffic, but a security control
silently regressed and we'd never have caught it from availability
metrics alone.

## Layer 1 — In-cluster probe (shipped)

### Schedule

`vercel.json` cron entry:

```json
{
  "path": "/api/cron/synthetic-probe",
  "schedule": "*/5 * * * *"
}
```

12 invocations per hour × 3 endpoints = 36 outbound HTTPS calls per
hour from the project to itself. Each call has a 10 s timeout. The
total cost is dominated by the Vercel function-invocation budget, not
egress (each request is < 2 KB).

### Targets

The probe is deliberately wide. If we narrow it to `/api/health/live`
only, a regression on the database-aware `ready` check is invisible.

| Target                | Validates                           |
| --------------------- | ----------------------------------- |
| `/api/health/live`    | function process boots, no panic    |
| `/api/health/ready`   | DB reachable, all required envs set |
| `/api/status/summary` | public status pipeline functions    |

### Authentication

The probe is run by Vercel Cron, so it is hit with the
`vercel-cron: 1` user agent and is admitted by `withCronGuard`.
The targets it hits are **public, unauthenticated** by design (they
are the same URLs an end user sees), so no extra credentials are
shipped.

If you ever add an authenticated target, prefer:

1. Mint a short-lived JWT inside the probe with a probe-only role.
2. Verify the JWT in the target with the standard middleware path
   (no special probe-only branch — auditable).

### Result handling

`withCronGuard` records the run in `cron_runs`:

- `status='success'` when all targets returned the expected HTTP code.
- `status='success'` with `result.failed > 0` when SOME targets
  failed. This is intentional: the cron itself ran, but the system is
  partially degraded. The `lib/status/internal-source.ts` predicate
  picks up `result.failed > 0` and surfaces an incident on the `app`
  component.
- `status='failed'` only when the probe code itself threw — i.e. our
  cron infra is broken, not the platform.

This split is what lets `/api/health/deep` say "the cron ran on time"
while `/status` says "two probe targets are degraded".

### Configuration

| Env var                    | Required | Default                   |
| -------------------------- | -------- | ------------------------- |
| `SYNTHETIC_PROBE_BASE_URL` | no       | `NEXT_PUBLIC_APP_URL`     |
| `NEXT_PUBLIC_APP_URL`      | no       | `https://${VERCEL_URL}`   |
| `CRON_SECRET`              | yes      | (used by `withCronGuard`) |

For drills, set `SYNTHETIC_PROBE_BASE_URL` to a sinkhole
(`https://httpbin.org/status/503`) to verify the alert path lights up.
Reset to the production URL after the drill and document it in
`docs/runbooks/fire-drill-YYYY-MM.md`.

## Layer 2 — External probe (shipped 2026-04-19)

### Why GitHub Actions instead of a vendor

We considered BetterStack, Checkly, and UptimeRobot. GitHub Actions
won on three criteria:

1. **Auditability.** The probe configuration is a workflow file in this
   repo. No vendor account, no separate UI to lose track of, every
   change to the cadence or targets shows up in `git log`.
2. **Cost.** This repo is public, which means Actions minutes are
   unlimited. Vendor free tiers cap at 10 monitors / 3-min cadence
   (BetterStack) or 50 monitors / 5-min cadence (UptimeRobot).
3. **Independence.** GitHub Actions runs on Microsoft Azure
   infrastructure. A Vercel-wide outage cannot take it down. A
   GitHub-wide outage CAN take it down, but a GitHub outage and a
   Vercel outage at the same time is correlated risk we accept.

We retain the option to layer a third-party probe on top later if the
incident pattern warrants it.

### Schedule

| When                | What                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `*/5 * * * *`       | Scheduled run from GitHub. Cadence matches Layer 1.                |
| `workflow_dispatch` | Manual run. Optional `target_url` input lets you point at staging. |

`concurrency.cancel-in-progress: true` ensures a slow probe never
queues up behind the next 5-min tick.

### Targets

| Target              | Validates                             |
| ------------------- | ------------------------------------- |
| `/api/health/live`  | function process boots, no panic      |
| `/api/health/ready` | DB reachable, all required envs set   |
| `/login`            | edge serves HTML, app bundle loads    |
| `/registro`         | public registration page is reachable |

`/api/status/summary` and `/status` are deliberately NOT probed because
they 307-redirect to `/login?next=...` (auth gate) and a redirect
following can mask a real failure on the original endpoint. Layer 1
hits them from inside the project where redirects don't apply.

### Authentication

None. Every probed URL is public by design — these are the same paths
an end user can hit without an account. The probe identifies itself
with `user-agent: clinipharma-external-probe/1.0` so it can be
filtered out of analytics.

If you ever add an authenticated target, prefer:

1. Mint a short-lived JWT inside the workflow with a probe-only role
   (store the signing key in `secrets.PROBE_JWT_SIGNING_KEY`).
2. Verify the JWT in the target via the standard middleware path —
   no special probe-only branch.

### Result handling

Each run writes a `probe.jsonl` artifact (one line per target) with
status code, latency, body size, and a `reason` field on failure.
Retention is 7 days, enough to triage two consecutive weekend outages
without manual log-shipping.

When ANY target fails:

1. The job exits non-zero (so the GitHub run is red and the
   `external-probe.yml` workflow shows an X in the Actions tab).
2. A second job (`alert`) opens — or comments on — a GitHub Issue
   labelled `probe-failure`. The label is auto-created on first use.
   Issue title is fixed (`🔴 External probe failing`) so dedup is
   trivial: never more than one open issue at a time.
3. If you wire `secrets.SLACK_WEBHOOK_URL` (not done today), the
   `alert` job can also POST to Slack — see the commented block at
   the bottom of the workflow.

When ALL targets pass and there is an open `probe-failure` issue, the
`recover` job inspects the previous run on `main`. If it ALSO passed,
the issue auto-closes. This `2-greens-to-close` rule prevents flapping
issues from a single transient blip.

### Drill cadence

Quarterly fire-drill: dispatch the workflow with
`target_url=https://httpbin.org/status/503` and verify the alert path
fires (issue opens, comment lands, label applied). Reset to default
afterward and document the drill in `docs/runbooks/fire-drill-YYYY-QN.md`.

### Bypassing Vercel deployment protection (staging)

Production aliases (`clinipharma.com.br`) are public. Preview
deployments behind Vercel's automation bypass shield require:

```bash
gh secret set VERCEL_AUTOMATION_BYPASS_SECRET --body '<secret>'
```

then add to the probe step:

```yaml
-H "x-vercel-protection-bypass: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}"
-H "x-vercel-set-bypass-cookie: true"
```

Today we probe production only; the staging branch is left un-probed
until that secret is provisioned (see PENDING items in the Wave-16
roadmap).

## Verification

After every change to the probe code:

```bash
npm run dev
curl -H "authorization: Bearer $CRON_SECRET" \
     -H "user-agent: vercel-cron/test" \
     http://localhost:3000/api/cron/synthetic-probe \
     | jq
```

Expected: `{ "ok": true, "results": [...], "failed": 0 }` when the
local dev server is healthy.

## Change log

| Date       | Change                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | Initial publication. Layer 1 (in-cluster) shipped, Layer 2 documented as promotion path.                                                                                                          |
| 2026-04-19 | Layer 2 shipped via `.github/workflows/external-probe.yml`. Probes 4 public URLs every 5 min from a GitHub-hosted runner; auto-opens/closes a `probe-failure` issue with 2-greens-to-close dedup. |
