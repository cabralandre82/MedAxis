# Runbook — Slow requests (HttpLatencyP95High)

**Gravidade:** 🟠 P2 (latência degradada, sem falhas hard).
**Alerta de origem:** `HttpLatencyP95High` em
`monitoring/prometheus/alerts.yml` — p95 > 1.5s por rota por 15 min.
**SLO:** triage < 20 min · containment < 2 h · resolution < 8 h.
**Owner:** on-call engineer → backend lead.

---

## 1. Sintomas observados

- Prometheus: `histogram_quantile(0.95, ...) > 1500` por rota canônica.
- Usuários reportam "app lento" sem erro de servidor.
- `http_request_total{status_class="5xx"}` NÃO está inflado — se estiver,
  siga `incident-response.md` primeiro; a latência é sintoma, não causa.
- Sentry tag `slow_request` com evidência `Performance` issues.

---

## 2. Impacto no cliente

- **Usuário final:** fricção — abandono de checkout, timeout de upload.
- **B2B:** throughput cai; prescrições demoram. SLO de UX (p95 < 1.5s no
  fluxo de checkout) é um soft-commitment interno.
- **Compliance:** nenhum direto, mas DSAR/export podem timeoutar se
  afetam rotas `/api/lgpd/*` — se aplicável, escale para P1.

---

## 3. Primeiros 5 minutos

1. **Confirmar qual rota e quão ruim:**

   ```promql
   histogram_quantile(
     0.95,
     sum by (route, le) (rate(http_request_duration_ms_bucket[5m]))
   )
   ```

2. **Cruzar com outbound:**

   ```promql
   histogram_quantile(0.95, sum by (provider, le) (rate(http_outbound_duration_ms_bucket[5m])))
   ```

   Se p95 de `http_outbound_duration_ms` subiu para `provider=X` →
   origem é externa; circuit breaker ainda não abriu pq não estamos em erro.

3. **Verificar atomic RPCs:**

   ```promql
   histogram_quantile(0.95, sum by (name, le) (rate(atomic_rpc_duration_ms_bucket[5m])))
   ```

   p95 de RPC > 500ms → origem é banco (plano de execução, índice ausente,
   saturação).

---

## 4. Diagnóstico

### 4.1 — Dependência externa lenta (Asaas, Resend, OpenAI)

Ver `http_outbound_duration_ms` por provider. Se o provider está realmente
lento, você não tem controle direto — considere circuit breaker explícito,
cache, timeout mais agressivo.

### 4.2 — Query lenta no banco

```sql
-- Supabase dashboard → SQL Editor
select query, calls, mean_exec_time, rows
from pg_stat_statements
where mean_exec_time > 500
order by mean_exec_time desc
limit 20;
```

Índice ausente? Plano ruim? Escalar para DBA ou owner da migration.

### 4.3 — Rate limiter lento (Upstash Redis degradado)

```promql
histogram_quantile(0.95, sum by (bucket, le) (rate(rate_limit_check_duration_ms_bucket[5m])))
```

p95 > 200ms → ver `RateLimitCheckSlow` que já alerta isso. Fail-open
path kicks in; latência alta mas sem 429 falso.

### Decision tree

```
outbound_duration_ms alto em 1 provider → 5.A
atomic_rpc_duration_ms alto              → 5.B
rate_limit_check_duration_ms alto        → 5.C
nada específico                           → profiling (APM trace)
```

---

## 5. Mitigação

### 5.A — Provider externo lento

- Se não-crítico (ex.: Resend email transacional) → aceitar fila + retry.
- Se crítico (Asaas checkout) → considerar kill-switch (`asaas.enabled=false`)
  e mensagem de manutenção no front.

### 5.B — Query lenta no banco

```sql
-- Criar índice de emergência (em produção, use CONCURRENTLY):
create index concurrently if not exists idx_<name> on public.<table>(<col>);
```

**Atenção:** não use `create index` sem `concurrently` em tabelas grandes
— bloqueia writes.

### 5.C — Redis degradado

- Verificar Upstash dashboard.
- O fail-open já está ativo — operação continua, limiter efetivo cai.
- Considerar trocar de região temporariamente (migration do conector).

---

## 6. Verificação pós-mitigação

- [ ] p95 de `http_request_duration_ms` voltou para < 1500ms por rota.
- [ ] Alerta `HttpLatencyP95High` auto-resolveu.
- [ ] Nenhum pico correspondente em `http_outbound_duration_ms`.

---

## 7. Post-mortem

P2: opcional mas recomendado se a latência > 3h.

---

## 8. Prevenção

- Índice novo permanente em migration (se §5.B resolveu).
- Query slow-log no CI (teste de regressão de performance).
- APM trace tool (roadmap — avaliar Sentry Performance ou Grafana Tempo).

---

## Links

- Alert: `monitoring/prometheus/alerts.yml` → `HttpLatencyP95High`.
- Métricas: `docs/observability/metrics.md` §3.1.
- Runbooks relacionados: `incident-response.md`, `circuit-breaker.md`,
  `database-unavailable.md`.

---

_Runbook version: 2026-04-18 · Owner: backend on-call_
