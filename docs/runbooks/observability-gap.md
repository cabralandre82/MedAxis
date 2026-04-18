# Runbook — observability gap

**Severity: P2 (no customer impact — we just can't _see_ customer impact)**

Purpose: restore visibility when dashboards go dark or scrape
metrics vanish. This runbook is the "eyes before hands" step
— investigate the monitoring pipeline _before_ investigating
the platform.

## When this fires

- Grafana panels show _No data_ or _N/A_ for > 15 min on the
  `clinipharma-*` dashboards.
- Alertmanager (or the internal alert dispatcher in
  `lib/alerts.ts`) stops emitting _any_ alerts for > 30 min.
- `metrics_scrape_total{outcome="ok"}` rate drops to 0 for
  > 5 min according to the logs-derived SLI.
- A trace id reported by the customer cannot be found in logs
  _or_ in Sentry.

## Triage (< 5 min)

1. **Is the app up?** Hit `GET /api/health/live` — should be 200
   with `{ "status": "ok" }`. If 5xx, this is not an
   observability problem; escalate to the relevant platform
   runbook.
2. **Can _you_ scrape metrics?**

   ```bash
   curl -sS -H "Authorization: Bearer $METRICS_SECRET" \
     https://app.clinipharma.com.br/api/metrics | head -30
   ```

   - 200 + non-empty Prometheus text → the app is emitting, the
     scraper is broken. Jump to step 4.
   - 401 → secret drift; check Vercel → Project → Settings →
     Environment variables.
   - 500 → `METRICS_SECRET` missing in that env; set it and
     redeploy (no code change needed).

3. **Is the deep health endpoint happy?**

   ```bash
   curl -sS -H "x-cron-secret: $CRON_SECRET" \
     https://app.clinipharma.com.br/api/health/deep | jq .summary
   ```

   Look for `checks.metrics.status`. `degraded` means the
   in-memory registry was reset recently (likely a cold start).
   `fail` means the counters/gauges we expect never appeared —
   likely a deploy regression in a metric emit site.

4. **Check the scraper** (Grafana Agent / Vector / Logpush):
   - Grafana Cloud → _Metrics_ → _Agents_ → status per target.
   - Vector instance → `systemctl status vector` or equivalent.
   - Logpush → Cloudflare dash → Analytics → Logs → last push
     timestamp.

## Ground-truth checks (< 10 min)

| Signal                           | How to check                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy at fault?                 | `vercel --prod list --limit 5` — any deploy in the last 30 min? Roll back if so.                           |
| Cloudflare WAF blocking scraper? | CF dash → Security → Events → filter by source IP; false-positive WAF rules are common after a WAF update. |
| Log volume sudden drop?          | Grafana → Loki / Datadog → `{app="clinipharma"}                                                            | rate()` → expect < 20 % drop.                                                                                                                        |
| Sentry sampling collapse?        | Sentry → Performance → _Sample rate_ → expect `tracesSampleRate` setting from `sentry.server.config.ts`.   |
| Trace id reported by user        | Loki query: `{app="clinipharma"}                                                                           | = "<trace id>"`. No hits → id was forged OR our middleware failed to seed the ALS — check the `withRouteContext` wrapper is applied on that handler. |

## Mitigation

### 1. Metrics endpoint returns 500 in prod

`METRICS_SECRET` is not set in the environment. Setting it
requires a redeploy (the env var is read at request time but
Next caches the module on cold start). Workaround while you
wait for the deploy: temporarily scrape from a preview URL
that has the secret configured.

### 2. Metrics endpoint returns data but dashboards are empty

Scrape pipeline issue — the app is healthy. Priority:

1. Restart the Grafana Agent / Vector instance.
2. If that doesn't help, rotate the bearer token on both sides
   (Grafana variable + Vercel env).
3. Escalate to the Cloudflare / Logpush owner if traffic egress
   is the bottleneck.

### 3. Logs exist but trace ids are not joined

The ALS context is missing its `traceId`. Likely one of:

- A handler _not_ wrapped by `withRouteContext` (the wrapper is
  what seeds the trace id after the Edge middleware hands off).
- A background job not wrapped by `withCronContext` /
  `withWebhookContext` / `withInngestContext`.

Grep for the handler in code; add the wrapper. Until the fix is
deployed, operators can still correlate via `x-request-id` which
the middleware _does_ propagate unconditionally.

### 4. Sentry silent on known errors

- Check `NEXT_PUBLIC_SENTRY_DSN` is set in the environment.
- In Sentry dashboard, check _Inbound Filters_ — a bad filter
  rule can silently drop events.
- `tracesSampleRate` is set to 10 % in prod; low-volume errors
  may _look_ absent but show up at the next scrape. Confirm by
  checking the `Issues` tab, not `Performance`.

## Post-incident

- Add a synthetic monitor that scrapes `/api/metrics` every
  minute from outside the platform (e.g. Cloudflare Health
  Checks) and pages when the content size drops > 50 %.
- If the gap lasted > 30 min, file an SLO waiver for _this
  very dashboard_ — you can't credit a miss against a platform
  SLO when the platform's own health telemetry was broken.
- Update `docs/slos.md` if a new gap surfaced an unmeasured
  flow.

## Quick reference

```bash
# Prometheus scrape from terminal
curl -sS -H "Authorization: Bearer $METRICS_SECRET" \
  https://app.clinipharma.com.br/api/metrics

# JSON snapshot for human inspection
curl -sS -H "Authorization: Bearer $METRICS_SECRET" \
  "https://app.clinipharma.com.br/api/metrics?format=json" | jq

# Request id → log search (Loki)
logcli query '{app="clinipharma"} |= "REQ-12345-6789"'

# Trace id → log search
logcli query '{app="clinipharma"} |= "4bf92f3577b34da6a3ce929d0e0e4736"'
```

## Related runbooks

- `metrics-endpoint-unauthorized.md` _(future W12 — not yet written)_
- `rate-limit-abuse.md` — relevant when metrics show rate-limit
  surges but dashboards claim everything is fine.
