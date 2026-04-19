# Synthetic Monitoring

| Field         | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| Owner         | Engineering / SRE                                               |
| Last reviewed | 2026-04-18                                                      |
| Pairs with    | `docs/observability/slos.md`, `docs/observability/burn-rate.md` |

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

We have **two layers**:

1. **In-cluster probe** — `/api/cron/synthetic-probe`, every 5 min,
   hits `/api/health/{live,ready}` + `/api/status/summary` from
   _another_ function in the same Vercel project. Catches everything
   except a full Vercel project outage.
2. **External probe** _(promotion path)_ — third-party uptime checker
   (UptimeRobot / BetterStack / Checkly) hitting the same URLs from
   distinct PoPs. Catches the failures the in-cluster probe cannot
   see.

The in-cluster probe is shipped today. The external probe is documented
below as the explicit next step when incident frequency justifies the
additional cost.

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

## Layer 2 — External probe (promotion path)

### When to add it

Add an external probe when **either** of these is true:

- Two consecutive months had a P1 incident invisible to the
  in-cluster probe (i.e. the project itself was down).
- A customer SLA contract requires third-party uptime evidence.

Until then the in-cluster probe is sufficient and zero-cost.

### Recommended providers (no commitment)

| Provider    | Notes                                            |
| ----------- | ------------------------------------------------ |
| BetterStack | Generous free tier (10 monitors, 3-min cadence). |
| Checkly     | Code-as-monitor (Playwright scripts), great DX.  |
| UptimeRobot | Cheapest, 5-min cadence on free tier.            |

All three support webhook-style alerting. Wire the webhook to the
PagerDuty schedule named in `docs/observability/burn-rate.md`.

### What to probe externally

Same three URLs as Layer 1, plus a single deep-probe of the login
page (`/login` returns 200 and contains the string `Clinipharma`).
The login probe catches frontend asset bundling failures that the
JSON health endpoints cannot see.

### Required Vercel configuration

If the external probe needs to bypass the deployment-protection
shield (for preview environments), set:

```bash
vercel env add VERCEL_AUTOMATION_BYPASS_SECRET production
```

then configure the probe to send `x-vercel-protection-bypass:
$VERCEL_AUTOMATION_BYPASS_SECRET` on every request.

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

| Date       | Change                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- |
| 2026-04-18 | Initial publication. Layer 1 (in-cluster) shipped, Layer 2 documented as promotion path. |
