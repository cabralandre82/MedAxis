# Grafana dashboards — Clinipharma (Wave 11)

Three dashboards, all JSON-as-code, version-controlled with the
application. Any panel change ships through a PR.

| File                   | Audience       | SLOs covered                   |
| ---------------------- | -------------- | ------------------------------ |
| `platform-health.json` | SRE on-call    | SLO-01, SLO-03, SLO-04, SLO-08 |
| `security.json`        | Security + DPO | SLO-05 (+ CSRF, Turnstile)     |
| `money-and-dsar.json`  | Finance + DPO  | SLO-02, SLO-06, SLO-07         |

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
