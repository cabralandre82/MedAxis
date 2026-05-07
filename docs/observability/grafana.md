# Grafana Cloud — pipeline de métricas

**Versão:** 1.0
**Data:** 2026-05-07
**Owner:** SRE
**Introduzido por:** Pre-Launch Onda S1 / T6

---

## 1. Visão geral

O Grafana Cloud é a camada de **dashboards + alerting de longo
prazo** sobre as métricas Prometheus emitidas pela aplicação.
Sentry continua para erros + tracing; Vercel logs continuam para
debugging ad-hoc; Grafana fecha o terceiro eixo: **trends e
burn-rates**.

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Vercel serverless isolate   │         │  Grafana Cloud (sa-east-1)   │
│                              │         │                              │
│   lib/metrics.ts (in-memory) │         │   Hosted Prometheus          │
│   ├── counters               │  push   │   ├── retention: 13 mo (free)│
│   ├── gauges               ──┼─────►───┤   ├── ingestion: 10K series  │
│   └── histograms             │  60s    │   └── data source default    │
│            │                 │         │            │                 │
│            ▼                 │         │            ▼                 │
│  /api/cron/grafana-push      │         │   Dashboard "Clinipharma"    │
│  (withCronGuard)             │         │   Alerting rules             │
└──────────────────────────────┘         └──────────────────────────────┘
```

## 2. Por que push e não pull (scrape)

Vercel serverless **não oferece um endpoint estável** para o
Grafana Cloud fazer scrape. Cada invocação do `/api/metrics`
pode acertar um isolate diferente cujo registry está em estado
diferente — counters resetam quando o isolate recicla.

**Push resolve:**

- O cron lê a snapshot do **mesmo isolate** que ele rodou.
- Cada amostra carrega timestamp do momento do push.
- Grafana agrega por janela (rate, sum) — mosaicos de pontos
  por isolate ao longo do tempo formam a série coerente.
- Counters viram "rate por minuto" no Grafana, que é o que a
  gente quer ver em alerta de qualquer jeito.

## 3. Configuração runtime

### 3.1. Env vars (Production + Preview)

| Env var                         | Descrição                                                             | Provider       |
| ------------------------------- | --------------------------------------------------------------------- | -------------- |
| `GRAFANA_REMOTE_WRITE_URL`      | Endpoint remote_write (`https://prometheus-prod-XX.../api/prom/push`) | Grafana portal |
| `GRAFANA_REMOTE_WRITE_USERNAME` | Instance ID numérico (ex: `3176618`)                                  | Grafana portal |
| `GRAFANA_REMOTE_WRITE_TOKEN`    | Cloud access policy token (`glc_eyJ...`) com scope `metrics:write`    | Grafana portal |

Rotação: Tier B (assistida). Procedimento em
`docs/runbooks/grafana-push.md` §5.A.

### 3.2. Cron entry (`vercel.json`)

```json
{ "path": "/api/cron/grafana-push", "schedule": "* * * * *" }
```

Cadência de 1 min é o padrão Prometheus. Mais lento (5 min)
perde detalhe em incidentes rápidos; mais rápido cobra mais
invocations Vercel sem ganho real.

### 3.3. Labels canônicas

Toda timeseries enviada carrega:

| Label      | Valor                                    | Origem                          |
| ---------- | ---------------------------------------- | ------------------------------- |
| `service`  | `clinipharma`                            | hard-coded em `grafana-push.ts` |
| `env`      | `production` / `preview` / `development` | `process.env.VERCEL_ENV`        |
| `region`   | `gru1` / `iad1` / etc                    | `process.env.VERCEL_REGION`     |
| `__name__` | nome da métrica                          | `lib/metrics.ts` `Metrics.*`    |

Labels emitidos no call site (ex: `outcome`, `tenant_id`,
`route`) são preservados — sanitizados para o regex Prometheus
(`[a-zA-Z_:][a-zA-Z0-9_:]*`) e truncados em 200 chars.

## 4. Cardinality budget

Estimativa atual (~2026-05-07):

- Counters: ~30 nomes × média 5 combinações de labels = **150
  séries**
- Gauges: ~10 nomes × média 1 combinação = **10 séries**
- Histograms: ~8 nomes × 5 expansões (count/sum/p50/p95/p99) ×
  3 combinações de labels = **120 séries**

Total: **~280 séries em condições normais**, bem abaixo do
limite de 10K séries do free tier Grafana Cloud.

Crescimento esperado: ~10% ao mês conforme adicionamos métricas
em features novas. Margem de 30× antes de upgrade necessário.

**Anti-padrão a evitar**: emitir `tenant_id` ou `user_id` como
label fixa em métrica de alta-cardinalidade. Já temos guardrails:
`flattenLabels` em `grafana-push.ts` trunca em 200 chars, mas
não impede explosão. Code review deve rejeitar PRs que adicionem
labels com cardinality > 100 distinct values.

## 5. Dashboard canônico — 4 painéis

Dashboard ID `clinipharma-pre-launch` (vai ser criado após
primeira push validar fluxo):

### Painel 1 — Financial Integrity

```promql
# Money drift (alerta se > 0)
sum(money_drift_total{service="clinipharma"})

# Confirm payment atomic rate (1m window)
sum(rate(atomic_rpc_total{name="confirm_payment_atomic", outcome="ok"}[1m]))

# Asaas reconcile recovered (sinal de webhook miss)
sum(rate(asaas_reconcile_recovered_total{service="clinipharma"}[5m]))
```

### Painel 2 — RLS Canary

```promql
# Violações detectadas (alerta crítico se > 0)
sum(rls_canary_violations_total{service="clinipharma"})

# Last run staleness (alerta warning se > 1h)
time() - rls_canary_last_run_ts{service="clinipharma"}
```

### Painel 3 — Asaas Reconcile

```promql
# Outcomes do cron por taxa
sum(rate(asaas_reconcile_total{service="clinipharma"}[5m])) by (outcome)

# Latência p95 do cron
histogram_quantile(0.95,
  sum(rate(asaas_reconcile_duration_ms_bucket{service="clinipharma"}[5m])) by (le)
)
```

### Painel 4 — Error Rate global

```promql
# HTTP 5xx por rota (top 5)
topk(5, sum(rate(http_request_total{status=~"5.."}[5m])) by (route))

# Cron failures
sum(rate(cron_failed_total{service="clinipharma"}[5m])) by (job_name)

# Push pipeline health (this!)
sum(rate(grafana_push_total{outcome="error"}[5m]))
```

## 6. Alerting rules sugeridas

Configurar em **Grafana Cloud → Alerting → Alert rules**:

| Alert                         | Condition                                                       | Severity |
| ----------------------------- | --------------------------------------------------------------- | -------- |
| `MoneyDrift`                  | `money_drift_total > 0` for 5m                                  | CRITICAL |
| `RLSCanaryViolation`          | `rls_canary_violations_total > 0`                               | CRITICAL |
| `AsaasReconcileRecoveredHigh` | `rate(asaas_reconcile_recovered_total[1h]) > 0.001` (≈ 1 hit/h) | WARNING  |
| `GrafanaPushError`            | `rate(grafana_push_total{outcome="error"}[5m]) > 0.05`          | WARNING  |
| `GrafanaPushStale`            | `time() - grafana_push_last_run_ts > 300` (sem run há > 5 min)  | WARNING  |
| `Http5xxSpike`                | `sum(rate(http_request_total{status=~"5.."}[5m])) > 0.5`        | WARNING  |
| `CronJobFailing`              | `rate(cron_failed_total[15m]) > 0.001`                          | WARNING  |

Cada alerta deve apontar para o runbook canônico via campo
`runbook_url`.

## 7. Como testar localmente

Para validar push sem disparar cron Vercel:

```bash
# Em desenvolvimento, NÃO setar GRAFANA_REMOTE_WRITE_TOKEN.
# A função vai retornar `outcome: skipped_no_env` — comportamento
# defensivo esperado.

# Para testar contra Grafana Cloud (cuidado! polui métricas reais):
export GRAFANA_REMOTE_WRITE_URL='https://...'
export GRAFANA_REMOTE_WRITE_USERNAME='3176618'
export GRAFANA_REMOTE_WRITE_TOKEN='glc_...'

# Forçar emissão de métricas
curl -sS http://localhost:3000/api/health/deep | head -c 500

# Forçar push
curl -sS -X POST http://localhost:3000/api/cron/grafana-push \
  -H "Authorization: Bearer $CRON_SECRET"

# Verificar no Grafana Explore: até 60s depois deve aparecer
# `{service="clinipharma", env="development"}`.
```

## 8. Referências

- Spec remote_write: <https://prometheus.io/docs/concepts/remote_write_spec/>
- Lib Node usada: <https://github.com/huksley/prometheus-remote-write>
- Grafana Cloud docs: <https://grafana.com/docs/grafana-cloud/metrics-prometheus/>
- Runbook: `docs/runbooks/grafana-push.md`
- Métricas catálogo: `docs/observability/metrics.md` §3.x (ver entradas
  `grafana_push_*`)
- Execution-log do T6: `docs/execution-log.md` (entrada
  "Pre-Launch Onda S1 — T6: Grafana Cloud")
