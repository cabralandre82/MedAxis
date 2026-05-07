# Runbook — `grafana-push`

**Gravidade:** 🟡 P3 (sem impacto direto ao usuário) · 🟠 P2 se sustentado > 1 h (cegueira operacional)
**Alerta de origem:** cron `* * * * *` em `/api/cron/grafana-push`
**SLO:** triage < 1 h · resolution < 4 h
**Owner:** on-call engineer / SRE
**Introduzido por:** Pre-Launch Onda S1 / T6 (2026-05-07)

---

## 0. Companion skill

Não há skill dedicado — runbook curto. Se virar tema recorrente,
abrir `.cursor/skills/grafana-push/SKILL.md`.

---

## 1. Sintomas observados

O cron `grafana-push` é a **última camada de observabilidade** —
fecha o blind spot de "métricas Prometheus precisam de dashboard
externo". Falha aqui não derruba a plataforma; **derruba a nossa
capacidade de ver burn-rates e tendências em tempo real**.

Sintomas que disparam este runbook:

- Log `[grafana-push] push failed — Grafana rejected` com
  `httpStatus` específico em qualquer execução.
- Métrica `grafana_push_total{outcome="error"} > 0` em janela
  de 5 min.
- Métrica `grafana_push_total{outcome="error"} > 5` em 5 min →
  **CRITICAL** (auth quebrada ou Grafana Cloud em incidente).
- Métrica `grafana_push_last_run_ts` parada há > 5 min — cron
  parou de rodar (Vercel cron quota? Lock travado?).
- Dashboard Grafana mostra "no data" em painéis que normalmente
  têm fluxo.

**Sintomas que NÃO disparam este runbook:**

- `outcome="skipped_no_env"` → env vars não configuradas. Esperado
  em Development; verificar Vercel envs em Preview/Production.
- `outcome="skipped_empty"` → registry vazio. Normal em cold
  start de isolate, depois de < 1 min volta ao normal.

---

## 2. Impacto no cliente

- **Cliente final:** zero. Os dados em `lib/metrics.ts` continuam
  sendo emitidos (Sentry breadcrumbs, deep-health snapshot, ZAP
  scrape autenticado).
- **Operador:** parcial. Dashboards Grafana ficam com gap. Sentry
  - Vercel logs continuam funcionando — você não fica cego.

**Não acionar pager fora do horário comercial** a menos que outro
incidente esteja em curso e você queira o Grafana on-line para
ajudar a triagem dele.

---

## 3. Containment imediato

| Cenário                                                 | Ação imediata                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `error` por `httpStatus=401`                            | Token Grafana inválido / revogado. Pular para 5.A — rotation.                                                            |
| `error` por `httpStatus=429`                            | Free tier rate limit. Aumentar cadência cron `* * * * *` → `*/2 * * * *` em `vercel.json`. Hot-fix pull request, deploy. |
| `error` por `httpStatus=5xx` ou network                 | Grafana Cloud incidente. Verificar https://status.grafana.com/. Aguardar.                                                |
| `last_run_ts` parou (sem outcome)                       | Cron lock wedged. Pular para 5.B — lock release.                                                                         |
| Dashboard sem dados mas `outcome=success` repetidamente | Dashboard query errada / labels mudaram. Pular para 5.C — query audit.                                                   |

---

## 4. Diagnóstico

### 4.A. Verificar última execução

```bash
# logs Vercel filtrando o cron
gh run list --workflow=ci.yml --limit=1
vercel logs --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" | grep grafana-push | tail -20
```

ou via SQL:

```sql
SELECT job_name, run_id, started_at, finished_at, status, error_text
  FROM public.cron_runs
 WHERE job_name = 'grafana-push'
 ORDER BY started_at DESC
 LIMIT 10;
```

### 4.B. Verificar token + URL no Vercel

```bash
npx vercel env ls --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" \
  | grep GRAFANA_REMOTE_WRITE
```

Devem aparecer 3 entradas em Production e 3 em Preview.

### 4.C. Smoke test manual contra Grafana Cloud

```bash
# Substitua pelos valores reais — NUNCA cole token em chat
URL='https://prometheus-prod-40-prod-sa-east-1.grafana.net/api/prom/push'
USER='3176618'
TOKEN='glc_...'

# Teste de credencial — endpoint base retorna info se auth válido
curl -sS -u "$USER:$TOKEN" "${URL%/push}/api/v1/labels?match[]=up" | head -c 500
```

- HTTP 200 com lista de labels → token e URL válidos. Problema é
  outro (cron, código).
- HTTP 401/403 → token revogado ou expirado. Ir para 5.A.
- HTTP 5xx ou timeout → Grafana Cloud com problema. Aguardar
  status.grafana.com.

---

## 5. Mitigação

### 5.A. Rotacionar token Grafana

Procedimento (Tier B no manifest, mig 085-style):

1. **Sentry portal** → wait — wrong portal. Use **grafana.com/orgs/<org>/access-policies**.
2. Criar nova access policy:
   - **Name**: `clinipharma-vercel-cron-rotate-YYYYMMDD`
   - **Scopes**: `metrics:write`
3. Generate token. Copiar o `glc_eyJ...` único.
4. Atualizar Vercel:
   ```bash
   curl -X POST "https://api.vercel.com/v10/projects/clinipharma/env?teamId=$VERCEL_ORG_ID" \
     -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"key\":\"GRAFANA_REMOTE_WRITE_TOKEN\",\"value\":\"<new>\",\"type\":\"encrypted\",\"target\":[\"production\"]}"
   ```
5. Idem para `preview`.
6. Forçar redeploy: `vercel --prod` ou push de qualquer commit.
7. Aguardar 2 ciclos do cron (~2 min) e verificar
   `grafana_push_total{outcome="success"}` > 0.
8. Revogar a access policy antiga em grafana.com.
9. Registrar a rotação no manifest (futuro: cron `rotate-secrets`
   vai fazer automaticamente quando mig 085 + entrada `SENTRY_AUTH_TOKEN`
   forem aplicadas e vier a versão 086 com `GRAFANA_REMOTE_WRITE_TOKEN`).

### 5.B. Liberar cron lock travado

Mesmo padrão de qualquer cron com `withCronGuard`:

```sql
SELECT * FROM public.cron_runs
 WHERE job_name = 'grafana-push' AND status = 'running'
 ORDER BY started_at DESC LIMIT 5;
```

Se `started_at` > 5 min atrás, lock wedged. Limpar:

```sql
UPDATE public.cron_runs
   SET status = 'failed',
       error_text = 'manually cleared (lock wedged)',
       finished_at = now()
 WHERE job_name = 'grafana-push' AND status = 'running'
   AND started_at < now() - interval '5 minutes';
```

(Mig 069 / `cron_try_lock` cuida disso automaticamente após 60s,
então este é cinto-e-suspensório.)

### 5.C. Auditar queries do dashboard

Não é um sintoma em código nosso; é um sintoma de configuração
do dashboard no Grafana. Abrir cada painel → Query inspector →
verificar se as labels que ele filtra (`{service="clinipharma",
env="production"}`) batem com os emitidos. Veja
`docs/observability/grafana.md` para o set canônico.

---

## 6. Verificação pós-mitigação

Esperar 5 ciclos do cron (~5 min) e confirmar:

```promql
# No próprio dashboard Grafana ou via Explore:
sum(rate(grafana_push_total{outcome="success"}[5m]))
# Esperado: ~0.0167 (1/60s)

sum(rate(grafana_push_total{outcome="error"}[5m]))
# Esperado: 0

(time() - grafana_push_last_run_ts) < 120
# Esperado: true (último push há < 2 min)
```

Se as 3 condições passam por 10 min consecutivos, incidente
resolvido. Atualizar incident issue + close.

---

## 7. Post-mortem triggers

Abrir post-mortem se:

- `error` rate > 10% por mais de 1 h (degradação contínua).
- Token foi rotacionado por compromise (não rotina) — coordenar
  com `secret-compromise` runbook.
- Grafana Cloud decretou outage > 4 h e nosso plano de
  observabilidade ficou cego nesse período (avaliar cobertura
  alternativa: Datadog free tier, BetterStack, etc.).

Templates: `docs/runbooks/_postmortem-template.md`.

---

## 8. Prevenção

| Mitigação                                         | Status                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Rotação de token agendada (Tier B 90 d)           | Pendente — adicionar `GRAFANA_REMOTE_WRITE_TOKEN` ao manifest em mig 086 (follow-up T6)    |
| Cardinality budget enforcement                    | Em código: `slice(0, 200)` em label values + sanitização de keys (Prometheus regex)        |
| Skip silent quando env ausente                    | Em código: `outcome=skipped_no_env` previne falha em Development / token rotado mid-deploy |
| Latência bound (timeout 10 s no `pushTimeseries`) | Em código: lib opt `timeout: 10_000`                                                       |
| Lock distribuído (cron_try_lock TTL 60 s)         | Em código: `withCronGuard('grafana-push', ..., { ttlSeconds: 60 })`                        |

---

## 9. Histórico de incidentes

Vazio (este runbook foi criado em 2026-05-07 antes do primeiro deploy).
