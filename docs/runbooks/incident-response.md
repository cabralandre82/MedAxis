# Runbook — Incident response (generic HTTP 5xx surge)

**Gravidade:** 🔴 P1 quando `HttpHighErrorRate` firing (> 5% 5xx por rota por 10 min).
**Alerta de origem:** `HttpHighErrorRate` em `monitoring/prometheus/alerts.yml`;
fallback para qualquer alerta sem runbook mais específico.
**SLO:** triage < 10 min · containment < 30 min · resolution < 2 h.
**Owner:** on-call engineer → backend lead → CTO.

> Este é o runbook de **entrada** para qualquer incidente de disponibilidade.
> Se o alerta tem runbook dedicado (`backup-missing.md`, `dsar-sla-missed.md`,
> `rls-violation.md`, etc.), siga aquele primeiro. Use este aqui quando nenhum
> runbook específico se aplica ou você ainda está no 1° minuto de triage.

---

## 1. Sintomas observados

- Alerta Prometheus `HttpHighErrorRate` com `route=<X>` > 5% de 5xx por 10 min.
- Painel `platform-health` em Grafana: linha vermelha em `http_request_total{status_class="5xx"}`.
- `/api/health/deep` pode retornar `degraded` ou `unhealthy` (mas nem sempre —
  um erro específico de rota pode não afetar os checks).
- Sentry: tag `route:<X>` com um issue crescente.

---

## 2. Impacto no cliente

- **Usuário final:** checkout falha, login bloqueado, upload de receita dá erro.
- **B2B:** farmácias não conseguem processar pedidos novos; clínicas não
  conseguem prescrever. Contratos SLA podem disparar se > 15 min contínuos.
- **Compliance:** se a rota afetada for `/api/lgpd/*`, `/api/auth/*` ou
  `/api/orders/*`, acione também `data-breach-72h.md` preventivamente — não
  espere o pós-mortem para decidir se é incidente LGPD.

---

## 3. Primeiros 5 minutos (containment)

1. **Confirmar escala:**

   ```promql
   # Rotas afetadas agora
   sum by (route) (rate(http_request_total{status_class="5xx"}[5m]))
   ```

   Se só 1 rota → incidente localizado. Se ≥ 3 rotas → incidente sistêmico
   (banco, Redis, provedor externo).

2. **Checar dependências externas:**
   - Supabase status: https://status.supabase.com
   - Vercel status: https://www.vercel-status.com
   - Upstash (Redis) status: https://status.upstash.com
   - Asaas, Resend, OpenAI — status pages dos providers críticos.

3. **Snapshot dos últimos deploys:**

   ```bash
   gh run list --limit 10
   git log --oneline -n 20
   ```

   Se o pico começou dentro de 30 min do último deploy → suspeite de regressão.

4. **Abrir issue:**

   ```bash
   gh issue create \
     --title "P1 — HTTP 5xx surge on <rota>" \
     --label "incident,severity:p1,availability" \
     --body "Alerta HttpHighErrorRate firing desde <timestamp>. Rotas: <X,Y>."
   ```

5. **Não faça:** rollback cego sem antes capturar o stack trace do Sentry.
   Rollback perde a evidência; capture primeiro.

---

## 4. Diagnóstico

### 4.1 — Regressão de deploy

```bash
# Comparar último deploy ok com o deploy do incidente
git log --since="2h ago" --oneline
```

Se o commit que introduziu o bug é identificável → §5.A (rollback).

### 4.2 — Banco de dados saturado

```promql
# Latência de http subiu junto com a de RPCs?
histogram_quantile(0.95, sum by (name, le) (rate(atomic_rpc_duration_ms_bucket[5m])))
```

Se sim → verificar Supabase dashboard → §5.B.

### 4.3 — Provedor externo caiu

```promql
sum by (provider, outcome) (rate(http_outbound_total[5m]))
```

Se `outcome=error` spikou em 1 provider → circuit breaker já deveria abrir
(ver `circuit-breaker.md`). Se não abriu → §5.C.

### Decision tree

```
deploy recente + regression  → 5.A (rollback)
atomic_rpc lento + 5xx       → 5.B (DB/Redis)
outbound errors em 1 provider → 5.C (kill-switch provider)
nada acima                    → escalar
```

---

## 5. Mitigação

### 5.A — Rollback

```bash
# Via Vercel dashboard: Deployments → Previous → "Promote to Production"
# Via CLI:
vercel rollback <deployment-url>
```

Reversível: sim. Tempo: ~2 min.

### 5.B — Reduzir carga

- Turn on `rate_limit.strict_mode` se o problema for tráfego.
- Scale up Supabase compute (dashboard → Settings → Infrastructure).

### 5.C — Kill-switch de provider externo

Hoje **não existe** feature flag por-provider para Asaas/Resend/OpenAI — o
controle é via circuit breaker automático. Se o breaker não abriu (ainda),
opções manuais:

- Revogar a API key do provider (quebra chamadas intencionalmente e força
  o breaker a abrir em 5 falhas consecutivas).
- Envs de deploy: re-deploy sem `ASAAS_API_KEY` definido faz o service
  retornar 503 imediato.

Roadmap: adicionar `feature_flags` por-provider (`integration.asaas.enabled`,
etc.) para kill-switch em hot path sem redeploy — ver `docs/decisions/`.

---

## 6. Verificação pós-mitigação

- [ ] `http_request_total{status_class="5xx"}` voltou < 1% por rota.
- [ ] `/api/health/deep` responde 200 OK.
- [ ] Nenhum issue novo no Sentry nos últimos 10 min.
- [ ] Alerta `HttpHighErrorRate` auto-resolveu.

---

## 7. Post-mortem

**Obrigatório para P1.** Template em `.github/ISSUE_TEMPLATE/postmortem.md`.

---

## 8. Prevenção

- Novo teste de regressão cobrindo o caminho que quebrou.
- Canary deploy? (hoje não temos — tarefa roadmap SRE).
- Alerta mais sensível se o incidente levou > 15 min para ser detectado.

---

## Links

- Alert rules: `monitoring/prometheus/alerts.yml` (`HttpHighErrorRate`).
- Métricas: `docs/observability/metrics.md` §3.1.
- Runbooks específicos: `backup-missing.md`, `dsar-sla-missed.md`,
  `rls-violation.md`, `money-drift.md`, `circuit-breaker.md`.

---

_Runbook version: 2026-04-18 · Owner: backend on-call_
