# Grafana dashboards — Clinipharma (Wave 11 + Hardening II #6)

Three dashboards, all JSON-as-code, version-controlled with the
application. Any panel change ships through a PR.

| File                   | Audience       | SLOs covered                           |
| ---------------------- | -------------- | -------------------------------------- |
| `platform-health.json` | SRE on-call    | SLO-01, SLO-03, SLO-04, SLO-08         |
| `security.json`        | Security + DPO | SLO-05 (+ CSRF, Turnstile, Rate-limit) |
| `money-and-dsar.json`  | Finance + DPO  | SLO-02, SLO-06, SLO-07                 |

## Related artifacts

- **Metric catalog (humans):** [`docs/observability/metrics.md`](../../docs/observability/metrics.md) —
  every metric documented with type, labels, PromQL recipes.
- **Alert rules:** [`monitoring/prometheus/alerts.yml`](../prometheus/alerts.yml) —
  13 rule groups, severity-tagged, runbook-annotated. Compatible
  with vanilla Prometheus, Prometheus Operator (PrometheusRule
  CRD), and Grafana Cloud Alerting (file-based provisioning).
- **Source-of-truth (code):** [`lib/metrics.ts`](../../lib/metrics.ts)
  (`Metrics` const) and [`lib/rate-limit.ts`](../../lib/rate-limit.ts)
  (`Bucket` const). Drift between these two and the dashboards/alerts
  is blocked by [`tests/unit/lib/metrics-catalog.test.ts`](../../tests/unit/lib/metrics-catalog.test.ts).
- **Public status page:** [`docs/observability/status-page.md`](../../docs/observability/status-page.md) —
  architecture and Grafana Cloud setup for the `/status` page that
  ships with the app (Wave Hardening II #7). The same Mimir tenant
  used by these dashboards can drive the public page once the
  `GRAFANA_CLOUD_*` envs are set.

## Import

```bash
# per dashboard
curl -s -XPOST "$GRAFANA_URL/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson d "$(cat monitoring/grafana/platform-health.json)" '{dashboard:$d, overwrite:true, folderId:0}')"
```

A GitHub Action should sync these automatically on main — until
that lands, run the loop manually after merging a change.

## Datasource

All dashboards expect a Prometheus-compatible datasource. If you
scrape `/api/metrics` via Grafana Agent, Vector, or Cloudflare
Logpush → Prometheus, the `$DS_PROM` variable binds to whatever
you named the datasource in Grafana.

## Scrape config (Vector example)

```toml
[sources.clinipharma_metrics]
type = "prometheus_scrape"
endpoints = ["https://clinipharma.vercel.app/api/metrics"]
scrape_interval_secs = 30
[sources.clinipharma_metrics.auth]
strategy = "bearer"
token = "${METRICS_SECRET}"
```

## Change log

- **2026-04-17** — Wave 11 initial set. 3 dashboards, 22 panels.
- **2026-04-18** — Hardening II #6: added `monitoring/prometheus/alerts.yml`
  (13 rule groups), `docs/observability/metrics.md` (metric catalog),
  drift test (`tests/unit/lib/metrics-catalog.test.ts`). Closed 3
  silent metrics that dashboards referenced but no code emitted
  (`orders_created_total`, `cron_last_success_ts`, `audit_chain_break_total`).
