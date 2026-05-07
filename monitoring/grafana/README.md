# Grafana dashboards — Clinipharma (Wave 11 + Hardening II #6 + Pre-Launch S1 / T6)

Four dashboards, all JSON-as-code, version-controlled with the
application. Any panel change ships through a PR.

| File                        | Audience       | Cobertura                                                              |
| --------------------------- | -------------- | ---------------------------------------------------------------------- |
| `clinipharma-overview.json` | Solo operator  | Pre-launch overview — financial, RLS, Asaas reconcile, error rate (T6) |
| `platform-health.json`      | SRE on-call    | SLO-01, SLO-03, SLO-04, SLO-08                                         |
| `security.json`             | Security + DPO | SLO-05 (+ CSRF, Turnstile, Rate-limit)                                 |
| `money-and-dsar.json`       | Finance + DPO  | SLO-02, SLO-06, SLO-07                                                 |

> **Recomendado no dia-a-dia:** abrir só `clinipharma-overview.json`
> como tab fixa. Os outros 3 são "drill-down" quando o overview
> sinalizar problema.

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

### Opção A — UI (recomendado, sem service-account com `dashboards:write`)

1. Abra o stack do Grafana Cloud → **Dashboards → New → Import**.
2. Em "Upload JSON file", escolha `monitoring/grafana/<file>.json`
   (ou cole o conteúdo bruto). O dashboard usa `uid` estável — re-importar
   atualiza in-place sem duplicar.
3. Em "Select a Prometheus data source", escolha o data source default
   do stack (geralmente nome igual ao prefix do hosted-prom, p.ex.
   `grafanacloud-1626197-prom`). A variable `$DS_PROM` binda nele.
4. Click **Import**. Pronto.

### Opção B — API (requer token com `dashboards:write`)

```bash
# per dashboard
curl -s -XPOST "$GRAFANA_URL/api/dashboards/db" \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson d "$(cat monitoring/grafana/clinipharma-overview.json)" '{dashboard:$d, overwrite:true, folderId:0}')"
```

GitHub Action de sync ainda não existe — a expectativa é que mudanças
em produção venham via PR no JSON e re-import manual no stack.

## Pipeline de métricas (atualizado em T6)

Vercel é serverless e in-memory: scrape pull em `/api/metrics`
veria registry frio na maioria dos invocations (só o lambda quente
acumulou contadores). A solução: **push** via cron de 60s.

```
Next.js handlers → lib/metrics.ts (in-memory registry)
                           │
                           ▼
              cron a cada 60s (Vercel scheduler)
                           │
                  /api/cron/grafana-push
                           │
              snapshotMetrics() → Timeseries[] (protobuf + snappy)
                           │
                           ▼
            Grafana Cloud Mimir (remote_write API)
                           │
                           ▼
                    $DS_PROM em todas as dashboards
```

Documentação completa: [`docs/observability/grafana.md`](../../docs/observability/grafana.md).
Runbook: [`docs/runbooks/grafana-push.md`](../../docs/runbooks/grafana-push.md).

> **Caveat importante:** `lib/metrics.ts` calcula percentis **localmente**
> (`p50`/`p95`/`p99`) e exporta como séries fixas — não emite buckets
> nativos. Logo, `histogram_quantile()` clássico **não funciona** na nossa
> stack. Use `*_p95` direto (como o overview faz) em vez de
> `histogram_quantile(0.95, *_bucket)`. Os 3 dashboards Wave 11 usam
> `histogram_quantile`/`_bucket` por terem sido escritos assumindo scrape
> tradicional — eles vão funcionar parcialmente até o sync ser
> retrabalhado para `_p95`/`_p99`.

## Datasource

Todas as dashboards usam a variable `$DS_PROM` (default: `Prometheus`).
A variable é resolvida no momento do import — não precisa editar JSON.

## Change log

- **2026-04-17** — Wave 11 initial set. 3 dashboards, 22 panels.
- **2026-04-18** — Hardening II #6: added `monitoring/prometheus/alerts.yml`
  (13 rule groups), `docs/observability/metrics.md` (metric catalog),
  drift test (`tests/unit/lib/metrics-catalog.test.ts`). Closed 3
  silent metrics that dashboards referenced but no code emitted
  (`orders_created_total`, `cron_last_success_ts`, `audit_chain_break_total`).
- **2026-05-07** — Pre-Launch Onda S1 / T6: adicionado
  `clinipharma-overview.json` (4 grupos × 14 painéis: Financial Integrity,
  RLS Canary, Asaas Reconcile, Error Rate). Pipeline de métricas mudou
  para push via `/api/cron/grafana-push` a cada 60s — documentado acima.
