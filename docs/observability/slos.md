# SLOs and Error Budgets

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| Owner           | Engineering / SRE                                  |
| Last reviewed   | 2026-04-18                                         |
| Next review     | 2026-07-18 (quarterly) — earlier on incident       |
| Window          | 30 days, rolling                                   |
| Source-of-truth | `cron_runs`, `server_logs`, `metrics_*` histograms |

This document is the canonical contract for what users can expect from
the platform and what triggers an on-call response. Every SLI here is
**measurable from data the platform already collects**; no SLO is
aspirational.

## 1. Service Level Objectives

### 1.1 Availability — public surface

| SLI                                      | Source                              | Target | Budget / 30d |
| ---------------------------------------- | ----------------------------------- | ------ | ------------ |
| `/api/health/live` returns 2xx           | `synthetic-probe` cron, `cron_runs` | 99.9 % | 43m 12s      |
| `/api/health/ready` returns 2xx          | `synthetic-probe` cron, `cron_runs` | 99.5 % | 3h 36m       |
| `/api/status/summary` returns 2xx        | `synthetic-probe` cron, `cron_runs` | 99.5 % | 3h 36m       |
| Logged-in route success rate (5xx ratio) | `server_logs.level='error'` rate    | 99.5 % | 3h 36m       |

The numerator for each row comes from the synthetic-probe cron (every
5 min) which writes its own `cron_runs` row. The denominator is the
total expected ticks over the window (8 640 ticks / 30 d).

### 1.2 Latency — orders & catalog

| SLI                     | Source                            | Target  |
| ----------------------- | --------------------------------- | ------- |
| `GET /api/orders` p95   | `metrics_*` histogram, `endpoint` | < 800ms |
| `POST /api/orders` p95  | idem                              | < 1.5s  |
| `GET /api/products` p95 | idem                              | < 600ms |

Histograms are exported via `/api/metrics` (Prometheus format) and read
by Grafana Cloud / Vector (whichever is wired). When neither is wired
the snapshot in `/api/health/deep` is the human-readable fallback.

### 1.3 Data integrity — non-negotiable

These are not graded on a budget. **Any** breach pages immediately:

- RLS canary: zero tenant-leak rows in 24h (`lib/rls-canary`).
- Audit chain: zero hash gaps (`/api/cron/verify-audit-chain`).
- Backup freshness: latest BACKUP < 25h, RESTORE_DRILL < 8d.
- Money reconcile: zero unmatched Asaas events > 1h old.

## 2. Error budgets

### 2.1 30-day budget table

For a 30-day window:

| SLO    | Budget    | Equivalent          |
| ------ | --------- | ------------------- |
| 99.9 % | 43 m 12 s | ≈ 9 ticks of 5 min  |
| 99.5 % | 3 h 36 m  | ≈ 43 ticks of 5 min |
| 99.0 % | 7 h 12 m  | ≈ 86 ticks of 5 min |

### 2.2 Burn-rate alerts

We use the Google SRE workbook two-window burn-rate method. The
windows are short enough to catch a fast outage and long enough to
ignore one-off blips.

For the **99.9 % live** SLO:

| Severity | Long window | Burn rate | Short window | Burn rate | Pages? |
| -------- | ----------- | --------- | ------------ | --------- | ------ |
| Page     | 1h          | 14.4 ×    | 5 min        | 14.4 ×    | Yes    |
| Page     | 6h          | 6 ×       | 30 min       | 6 ×       | Yes    |
| Ticket   | 24h         | 3 ×       | 2h           | 3 ×       | No     |
| Ticket   | 72h         | 1 ×       | 6h           | 1 ×       | No     |

A burn rate of `r` over a window of `w` consumes `r × w / SLO_window`
of the budget. With a 30-day window:

- 14.4 × over 1h = 1h × 14.4 / 720h ≈ 2 % budget burned in 1h → page.
- 6 × over 6h = 6h × 6 / 720h ≈ 5 % budget burned in 6h → page.
- 3 × over 24h = 24h × 3 / 720h ≈ 10 % budget in 24h → ticket.
- 1 × over 72h = 72h × 1 / 720h ≈ 10 % over 3d → ticket.

Both short and long windows must be above the threshold simultaneously
to fire (eliminates one-off ticks). The query lives in
`docs/observability/burn-rate.md` together with the Sentry/Grafana rule
templates.

### 2.3 What to do when the budget is exhausted

If the rolling 30-day budget is < 0 for any SLO:

1. Freeze risky changes (no schema migrations, no auth changes).
2. Open an incident-mode burndown: focus exclusively on raising the SLI.
3. After the SLO recovers, write a postmortem
   (`docs/templates/postmortem.md`) regardless of whether a single
   incident was the cause.
4. Re-evaluate the SLO target (sometimes the right answer is to lower
   the target; usually it is to fix the underlying class of bug).

## 3. SLI computation queries

These are the ground-truth queries. Anything else is a derived view.

### 3.1 Synthetic-probe success rate (last 30d)

```sql
SELECT
  job_name,
  COUNT(*) FILTER (WHERE status = 'success') AS ok,
  COUNT(*)                                   AS total,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'success')::numeric / NULLIF(COUNT(*), 0) * 100,
    3
  ) AS pct
FROM public.cron_runs
WHERE job_name = 'synthetic-probe'
  AND started_at >= now() - interval '30 days'
GROUP BY job_name;
```

### 3.2 Error log rate (last 30d)

```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) FILTER (WHERE level = 'error') AS errors,
  COUNT(*)                                AS total
FROM public.server_logs
WHERE created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### 3.3 Latency p95 from snapshot

Read from `/api/metrics?format=prometheus`, filter on
`http_request_duration_ms_bucket` with the appropriate `endpoint=` label
and apply `histogram_quantile(0.95, ...)` in Grafana.

## 4. Where this is referenced

- `/api/health/deep` returns a `cronFreshness` block that fails the
  liveness check if `synthetic-probe` is stale.
- `lib/status/internal-source.ts` consumes `cron_runs` and surfaces a
  failure run as an incident on the `app` component of `/status`.
- `docs/observability/burn-rate.md` ships the alert rule templates.
- `docs/observability/synthetic-monitoring.md` documents how the probe
  works and the promotion path to a third-party uptime checker.

## 5. Change log

| Date       | Change                                                |
| ---------- | ----------------------------------------------------- |
| 2026-04-18 | Initial publication. SLOs, budgets, burn-rate matrix. |
