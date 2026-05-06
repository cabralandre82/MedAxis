# Vercel cron quota — Hobby plan workaround

> **Status (2026-04-18):** RESOLVED. The Clinipharma Vercel team is now
> on the **Pro** plan, sub-daily cron schedules are accepted again, and
> the three flattened jobs have been restored to their original
> cadence. This document is retained as historical context and as a
> diagnostic checklist if a similar deploy blackout ever recurs.

## Background

The Clinipharma Vercel project (`clinipharma`, team
`cabralandre-3009's projects`; previously known as `b2b-med-platform`,
deleted 2026-05-06) was originally on the **Hobby** plan.
Hobby allows **at most one execution per day** for any cron job declared
in `vercel.json`. Sub-daily schedules (`*/15`, `*/30`, hourly, etc.)
caused the deployment **to be rejected up-front** by Vercel's API with:

```
{
  "error": {
    "code": "cron_jobs_limits_reached",
    "message": "Hobby accounts are limited to daily cron jobs."
  }
}
```

This rejection happened **before** Vercel created a deployment record —
so the failed deploy never appeared in `vercel ls`, never ran the
build, and produced no useful log line. From the operator's seat it
looked as if the GitHub→Vercel webhook had silently broken. From
2026-04-17 through 2026-04-18 every commit from Wave 8 onward (eight
waves' worth of code) was invisibly stranded for this reason.

## Current schedules (Pro plan — original cadences restored)

After the Pro upgrade on 2026-04-18, the three previously-flattened
jobs run at their designed frequency again:

| Job                 | Cadence                       | Detection-latency target                                              |
| ------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `money-reconcile`   | every 30 min (`*/30 * * * *`) | A payment-vs-order drift surfaces in ≤ 30 min. SLO-08 honoured.       |
| `dsar-sla-check`    | hourly (`0 * * * *`)          | LGPD 15-day SLA enforced with ≤ 1 h granularity; warning ladder firm. |
| `rate-limit-report` | every 15 min (`*/15 * * * *`) | Abuse waves paged within ≤ 15 min of crossing thresholds.             |

Each job is also wrapped in `withCronGuard()` (Wave 2) which adds
single-flight locking and idempotency, so accidental double-runs at
the platform layer are still safe.

## If Hobby ever needs to be re-applied (downgrade or new project)

1. Replace the three schedules in `vercel.json`:

```diff
-      "path": "/api/cron/money-reconcile",
-      "schedule": "*/30 * * * *"
+      "path": "/api/cron/money-reconcile",
+      "schedule": "15 4 * * *"
```

```diff
-      "path": "/api/cron/dsar-sla-check",
-      "schedule": "0 * * * *"
+      "path": "/api/cron/dsar-sla-check",
+      "schedule": "0 5 * * *"
```

```diff
-      "path": "/api/cron/rate-limit-report",
-      "schedule": "*/15 * * * *"
+      "path": "/api/cron/rate-limit-report",
+      "schedule": "30 5 * * *"
```

2. Commit, push, verify the deploy succeeds. The exact daily slots
   above were chosen to fan out across non-overlapping UTC windows so
   no two jobs collide on a single Hobby execution allowance.

3. Update SLO-08, SLO-09, and SLO-10 accordingly (detection latency
   widens to ≤ 24 h on Hobby).

## Why Pro is the right fit for production

Beyond cron flexibility, Pro also unlocks:

- 99.99 % uptime SLA (Hobby has no SLA — incidents are best-effort).
- 1 GB-Hours of edge function memory and concurrency limits suited
  to a B2B medical workload.
- Build concurrency > 1, so backed-up CI doesn't stall preview
  deploys.
- Region-pinning enforcement (`gru1` São Paulo) — important for
  LGPD data-residency posture.
- Audit logs retained 30 days (Hobby = 7 days).
- Ability to add team members under SSO.

## Detection: why Vercel error reporting was so quiet

The `cron_jobs_limits_reached` error is returned synchronously to the
GitHub→Vercel webhook payload. Vercel **does not** retry, **does not**
create a placeholder failed deployment, and **does not** notify the
GitHub commit-status check. From the developer's perspective the only
visible signal is "no deployment shows up." The mitigation we should
add (Wave 15 candidate) is a polling watchdog at the Vercel API level
that pages on prolonged absence of a new deploy after a `main` push.
