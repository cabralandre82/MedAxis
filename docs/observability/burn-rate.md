# Burn-Rate Alerts — Operator Guide

| Field         | Value                        |
| ------------- | ---------------------------- |
| Owner         | Engineering / SRE            |
| Last reviewed | 2026-04-18                   |
| Pairs with    | `docs/observability/slos.md` |

## What is a burn rate?

If your SLO is `99.9 %` over 30 days, you can spend **0.1 %** of the
window before customers feel the SLA broken. That's your **error
budget**: 43 m 12 s of downtime per month.

The **burn rate** is how fast you're spending that budget _right now_
relative to the rate that would consume it exactly over the SLO window:

```
burn_rate = (current_error_rate) / (1 − SLO)

# example: SLO 99.9 % → 1 − SLO = 0.001 (0.1 %)
# observed error rate over the last hour = 1.44 % (144× baseline)
# burn rate = 0.0144 / 0.001 = 14.4 ×
```

A burn rate of `14.4 ×` means at this pace you'd consume the entire
30-day budget in `30 d / 14.4 ≈ 2 d`. That's an emergency; we page.

## Two-window confirmation

Single-window alerts are noisy: a 60-second blip can spike the rate to
the moon. The Google SRE handbook recommends pairing two windows where
**both** must be above the threshold to fire. We adopt the same.

For our 99.9 % live SLO:

| Severity | Long | Short | Burn  | Time to consume budget | Page?  |
| -------- | ---- | ----- | ----- | ---------------------- | ------ |
| **P1**   | 1h   | 5m    | 14.4× | 2 d                    | YES    |
| **P1**   | 6h   | 30m   | 6×    | 5 d                    | YES    |
| **P2**   | 24h  | 2h    | 3×    | 10 d                   | ticket |
| **P2**   | 72h  | 6h    | 1×    | 30 d                   | ticket |

## Alert rules — copy/paste templates

The data lives in two places: `cron_runs` (synthetic-probe) and
`server_logs` (5xx). Pick the one that matches your monitoring stack.

### Sentry rule (server_logs path)

Sentry alerts on issue rate, not raw counts. Use this:

```yaml
# rule: Burn 14.4× — last 1h vs last 5m
event_frequency:
  comparison_type: 'count'
  value: 7 # 14.4× × baseline (1.44 events/h at 99.9%) ≈ 21
  interval: '1h'
trigger_actions:
  - send PagerDuty 'p1' to the on-call schedule
```

Tune `value` to match the actual baseline error rate observed during the
hardening sprint (recompute monthly).

### Grafana / PromQL (synthetic-probe path)

Assuming the histogram counter is exported via `/api/metrics`:

```promql
# 1h burn rate
1 - sum(rate(synthetic_probe_total{status="ok"}[1h]))
  / sum(rate(synthetic_probe_total[1h]))

# 5m burn rate
1 - sum(rate(synthetic_probe_total{status="ok"}[5m]))
  / sum(rate(synthetic_probe_total[5m]))

# Page when both > 14.4 × (1 − 0.999) = 0.0144
( ... 1h expr ... ) > 0.0144
and ( ... 5m expr ... ) > 0.0144
```

Same shape for the 6h/30m, 24h/2h, 72h/6h pairs — substitute the
windows.

### Internal data-source path (no external alerter wired)

Until external alerting is wired we rely on the existing
`/api/health/deep` cronFreshness check, which already fails when
`synthetic-probe` has not produced a successful row inside its SLA
window (15 min — see the SLA table in `app/api/health/deep/route.ts`).
That goes hand-in-hand with the public `/status` board which surfaces
failed cron runs as `app` incidents within ~60 s.

This is intentionally redundant: even with no Sentry, no Grafana, no
PagerDuty wired, an operator looking at the public status page sees
the outage within one minute of the synthetic probe failing.

## Routing

| Severity | Channel                               | Initial responder    |
| -------- | ------------------------------------- | -------------------- |
| **P1**   | PagerDuty `clinipharma-prod` schedule | On-call eng (24/7)   |
| **P2**   | Slack `#ops-alerts` + email digest    | Eng owner of the day |
| **P3**   | GitHub issue auto-opened by ops-bot   | Triaged in standup   |

P1 means "someone wakes up". Don't promote a P2 to a P1 without a
specific incident-commander decision.

## Validating the alerts

Quarterly we run a **fire drill**: deliberately fail the synthetic
probe (set `SYNTHETIC_PROBE_BASE_URL` to a sinkhole), confirm both
the 1h/5m alert fires AND the public status page degrades. Document
the drill in `docs/runbooks/fire-drill-YYYY-MM.md`.

## Change log

| Date       | Change                                                                       |
| ---------- | ---------------------------------------------------------------------------- |
| 2026-04-18 | Initial publication. Two-window burn-rate matrix + Sentry/Grafana templates. |
