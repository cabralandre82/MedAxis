# SLI query catalogue — Clinipharma (Wave 11)

Every SLO listed in `docs/slos.md` has a **primary SLI query**
(drives the dashboard panel and the burn-rate calculation) plus
optional **supplementary queries** used by on-call during an
incident. Queries are Prometheus-dialect PromQL; labels follow
the emission conventions documented in `lib/metrics.ts`.

Scrape assumption: `/api/metrics` is scraped every 30 s and
re-exported under the job name `clinipharma-web`. Adjust the
`job=` label if your Grafana Agent / Vector / Logpush config
uses a different name.

Common helper:

```promql
# 30 d = 2_592_000 s — used everywhere so we can retune in one place
# Grafana: declare this in a dashboard variable called $slo_window
# = 30d
```

## SLO-01 — Checkout success ≥ 99.5 %

Primary SLI (higher is better):

```promql
sum(rate(orders_created_total{outcome="ok"}[5m]))
  /
sum(rate(orders_created_total[5m]))
```

Supplementary:

```promql
# Latency of the order → confirmation round-trip
histogram_quantile(
  0.95,
  sum by (le) (
    rate(atomic_rpc_duration_ms_bucket{rpc="confirm_payment_atomic"}[5m])
  )
)

# Which fallback path is firing?
sum by (rpc) (rate(atomic_rpc_fallback_total[1h]))
```

Burn-rate fast:

```promql
(
  1 - (
    sum(rate(orders_created_total{outcome="ok"}[5m]))
      /
    sum(rate(orders_created_total[5m]))
  )
) > (14.4 * (1 - 0.995))
```

## SLO-02 — Webhook idempotency (hard, = 0)

```promql
# Any row where the same webhook_event_id credited money twice
# Surfaced by the money reconciliation cron (Wave 8)
sum(increase(webhook_duplicate_credit_total[30d]))
```

Alert if `> 0` for any value. This is a **hard** SLO — one event
pages and starts the `webhook-duplicate-credit.md` runbook.

## SLO-03 — Auth sign-in p95 ≤ 400 ms

```promql
histogram_quantile(
  0.95,
  sum by (le) (
    rate(http_request_duration_ms_bucket{path=~"/api/auth/.*"}[5m])
  )
)
```

Burn-rate: latency SLOs use a _sliding-window boolean budget_ —
count the fraction of 5-minute windows in the last 30 d where
p95 exceeded 400 ms. Budget: ≤ 0.5 % of windows.

```promql
(
  sum_over_time(
    (histogram_quantile(0.95, sum by (le) (rate(http_request_duration_ms_bucket{path=~"/api/auth/.*"}[5m]))) > bool 400)[30d:5m]
  )
) / (30 * 24 * 12)
```

## SLO-04 — Cron freshness ≥ 99.9 %

Primary:

```promql
sum by (job) (
  rate(cron_runs_total{outcome="ok"}[1h])
)
/
sum by (job) (
  rate(cron_runs_total[1h])
)
```

Alert: per-job window 6 h, threshold < 0.999.

Supplementary — which jobs are stale?

```promql
time() - max by (job) (cron_last_success_ts)
```

## SLO-05 — Rate-limit false positives ≤ 1 %

```promql
sum by (bucket) (rate(rate_limit_denied_total[1h]))
/
sum by (bucket) (rate(rate_limit_hits_total[1h]))
```

Alerts per bucket:

- `/api/auth/forgot-password` > 1 % → investigate (may signal
  legitimate users being blocked during deploys).
- `/api/lgpd/*` > 1 % → almost always abuse; see
  `rate-limit-abuse.md`.

## SLO-06 — DSAR SLA = 0 breach

```promql
sum(increase(dsar_sla_breach_total[15d]))
```

Must be 0. Anything > 0 is reportable under LGPD Art. 48. The
related warning counter `dsar_sla_warning_total` is watched at
`> 5` for the `dsar-sla-missed.md` runbook.

## SLO-07 — Money drift = 0

```promql
sum(money_drift_total)
```

Reconciliation cron sets this to 0 at the end of each clean run.
Any non-zero value pages immediately; see `money-drift.md`.

## SLO-08 — Third-party availability ≥ 99 %

```promql
# Asaas
sum(rate(http_outbound_total{service="asaas",outcome="ok"}[5m]))
/
sum(rate(http_outbound_total{service="asaas"}[5m]))

# Clicksign
sum(rate(http_outbound_total{service="clicksign",outcome="ok"}[5m]))
/
sum(rate(http_outbound_total{service="clicksign"}[5m]))
```

Use `fetchWithTrace({ serviceName: 'asaas' })` at the call site
so the label is set — see `lib/trace.ts`.

## SLO-09 — Backup recoverability (hard)

Primary SLI (binary — either fresh or not):

```promql
# Weekly backup must be < 9 d old, monthly drill < 35 d old.
# Gauges are emitted by `/api/cron/backup-freshness` daily.
max by (label) (backup_age_seconds{kind="BACKUP"})        < (9 * 86400)
and
max by (label) (backup_age_seconds{kind="RESTORE_DRILL"}) < (35 * 86400)
```

Supplementary:

```promql
# Direct freshness signal — any stream over SLA pages P1/P2.
sum(increase(backup_freshness_breach_total[1d]))

# Chain break counter — should stay at 0.
sum(increase(backup_chain_break_total[30d]))

# Last recorded size — sudden drop > 50 % is a red flag.
backup_last_size_bytes{label="weekly"}

# Record endpoint health — a silent workflow is the #1 miss.
sum(rate(backup_record_total{kind="BACKUP",outcome="ok"}[7d]))
```

Burn-rate: SLO-09 is hard — treat any non-zero
`backup_freshness_breach_total` over a 24 h window as the error
budget exhausted.

## SLO-10 — Legal-hold preservation (hard)

Primary SLI — the counter MUST stay at zero when enforcement is ON:

```promql
# No DSAR erasure should be granted on a held subject once
# legal_hold.block_dsar_erasure is flipped ON.
sum(increase(legal_hold_blocked_dsar_total[30d]))

# No retention cron should purge held rows once
# legal_hold.block_purge is flipped ON.
sum(increase(legal_hold_blocked_purge_total[30d]))
```

Supplementary (operational health of the hold machinery itself):

```promql
# How many holds are live — if > 0 for > 7 days without a
# release event, the DPO review cadence has drifted.
legal_hold_active_count

# Rate of new holds applied, by reason.
sum by (reason_code) (rate(legal_hold_apply_total{outcome="ok"}[30d]))

# Auto-expiry counter (monthly cron). A sudden spike after a
# quiet period signals the expires_at bookkeeping worked.
sum(increase(legal_hold_expired_total[30d]))
```

Burn-rate: SLO-10 is hard. The _interpretation_ differs from
other hard SLOs — the counters are normally 0 and MUST stay 0
while enforce flags are ON. A single non-zero increment is a
P1 and must trigger the `legal-hold-received.md` runbook.

## SLO-11 — RLS tenant isolation (hard)

Primary SLI — the violation counter MUST be 0 in every 7 d window:

```promql
# Any non-zero value over the last week is a hard breach.
# Wave 14 emits this counter from /api/cron/rls-canary every
# 24 h and from any read of `rls_canary_log` via the deep health
# endpoint when violations > 0.
sum(increase(rls_canary_violations_total[7d]))
```

Supplementary (operational health of the canary itself):

```promql
# Did the cron actually run? Should be ≥ 6 in any 7 d window
# (one daily run, allowing for one missed day).
sum(increase(rls_canary_runs_total[7d]))

# Split by outcome — `error` means the canary couldn't even
# evaluate (env misconfig, JWT_SECRET missing, RPC down). Treat
# error as a soft breach: page only after 2 consecutive errors.
sum by (outcome) (increase(rls_canary_runs_total[24h]))

# How fresh is the latest successful canary? Should stay below
# the cron interval + slack (default 36 h).
rls_canary_age_seconds

# Latency of the RPC. p95 should be < 2 s; spikes hint at
# planner regression on `pg_policies` lookup.
histogram_quantile(0.95,
  sum by (le) (rate(rls_canary_duration_ms_bucket[1h])))

# How many tables the matrix exercises right now. If this drops
# without a corresponding migration, someone shrunk the canary.
rls_canary_tables_checked
```

Burn-rate: like SLO-10, hard with zero budget. A single
`rls_canary_violations_total` increment > 0 trips the
`rls-violation.md` runbook immediately. The
`rls_canary.page_on_violation` flag controls whether the alert
is P0 (PagerDuty) or P1 (e-mail) during the 30-day observation
window after first deploy.

## SLO-12 — Secret freshness (hard)

Primary SLI — every secret must be younger than its tier's max age,
and no secret may be in `never-rotated` state:

```promql
# Oldest secret across the whole manifest (seconds).
# MUST be < 90 d (Tier A/B threshold). Tier C (180 d) is still
# enforced per-secret in the cron, but the global oldest gauge
# uses the tightest bound so a stale Tier A doesn't hide.
secret_oldest_age_seconds

# Count of secrets currently overdue (any tier). Updated by the
# weekly cron and by every health-deep probe.
secret_rotation_overdue_count

# Count of secrets that exist in the manifest but have no
# successful rotation in the ledger. MUST be 0 — anything > 0
# means someone added an env var without seeding genesis.
secret_rotation_never_rotated_count
```

Supplementary (operational health of the rotation machinery itself):

```promql
# Per-secret age (seconds). Heatmap-friendly. Use for
# "which secret will be next overdue" forecasting.
secret_age_seconds

# Did the weekly cron actually run? Should be ≥ 1 every 7 d.
sum(increase(secret_rotation_runs_total[14d]))

# Split by tier+outcome.
sum by (tier, outcome) (increase(secret_rotation_runs_total[30d]))

# Failure counter — non-zero means a Vercel/provider API
# rejected our rotation. Investigate immediately.
sum by (tier, secret, reason) (increase(secret_rotation_failures_total[7d]))

# Latency of one rotation pass. Tier A auto-rotation hits Vercel
# API ~3 times per secret + 1 redeploy; p95 < 30s expected.
histogram_quantile(0.95,
  sum by (le, tier) (rate(secret_rotation_duration_ms_bucket[1h])))

# Last successful cron run timestamp. Compared against now() to
# detect stuck cron — should never be > 8 d old.
secret_rotation_last_run_ts
```

Burn-rate: SLO-12 is hard. The `secrets.rotation_enforce` flag
controls whether overdue rotations page critical (ON) or warn-only
(OFF) during the 30-day observation window after Wave 15 deploy.
Once flipped ON, the cron uses `severity=critical` for any failed
rotation OR any Tier C overdue secret — Tier C overdue means
the maintenance window was missed, which is itself an SLO breach.

## Observability meta-SLO

We also track the observability stack itself:

```promql
# Is anyone scraping /api/metrics?
sum(rate(metrics_scrape_total{outcome="ok"}[5m])) > 0

# Are we generating trace ids?
sum(rate(http_request_total[5m])) by (has_trace)
```

A sudden drop in scrape rate is usually our problem, not the
platform's — but it hides every other SLO until fixed.
