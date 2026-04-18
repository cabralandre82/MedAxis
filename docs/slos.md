# Clinipharma — Service Level Objectives (SLOs)

**Versão:** 2.0 (Wave 11) | **Data:** 2026-04-17
**Revisão:** Trimestral (seções 1-6) / mensal (seção 7 SLO-as-code)

---

> Seção 7 abaixo (“**SLO-as-code**”) é a fonte-da-verdade de
> produção a partir da Wave 11. As seções 1-6 permanecem como
> contexto de alto nível e contato operacional — qualquer
> conflito numérico, a seção 7 prevalece.

---

## 1. SLOs de Plataforma

| SLO                 | Objetivo  | Janela                                   | Medição                              |
| ------------------- | --------- | ---------------------------------------- | ------------------------------------ |
| **Disponibilidade** | ≥ 99,5%   | Mensal (rolling 30 dias)                 | Uptime monitor em `/api/health`      |
| **Latência p95**    | < 800ms   | Por hora (horário comercial 08h–20h BRT) | Vercel Analytics + logs estruturados |
| **Latência p99**    | < 2.000ms | Por hora                                 | Vercel Analytics                     |
| **Taxa de erro**    | < 0,5%    | Por hora                                 | Sentry error rate                    |

### Error Budget

- **Disponibilidade:** Budget mensal = 0,5% × 30 dias × 24h = ~3,6 horas de downtime permitido
- **Taxa de erro:** Máximo 0,5% das requests podem retornar 5xx

---

## 2. SLOs por Rota Crítica

| Rota                               | p95     | p99     | Taxa de erro |
| ---------------------------------- | ------- | ------- | ------------ |
| `POST /api/auth/login`             | < 500ms | < 1s    | < 0,1%       |
| `GET /api/orders` (listagem)       | < 800ms | < 1,5s  | < 0,5%       |
| `POST /api/orders` (criação)       | < 1,5s  | < 3s    | < 0,5%       |
| `POST /api/payments/asaas/webhook` | < 200ms | < 500ms | < 0,1%       |
| `GET /api/health`                  | < 100ms | < 300ms | 0%           |
| `GET /api/export` (CSV)            | < 10s   | < 30s   | < 1%         |

---

## 3. Alertas de Negócio

### 3.1 Configurados no Sentry (Custom Alerts)

| Alerta                                 | Condição                                         | Ação                                     |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| **Zero pedidos em 4h**                 | Nenhum evento `createOrder` em horário comercial | Notificar SUPER_ADMIN + Sentry alert     |
| **Circuit breaker aberto**             | `/api/health` retorna `degraded` por > 5 min     | PagerDuty / WhatsApp responsável técnico |
| **Taxa de erro pagamento > 10%**       | Mais de 10% dos webhooks Asaas com erro em 1h    | Notificar imediatamente                  |
| **Webhook Clicksign silencioso > 48h** | Nenhum evento de contrato em 48h (horário útil)  | Verificar integração Clicksign           |

### 3.2 Como Configurar no Sentry

```
Sentry Dashboard → Alerts → Create Alert Rule
→ Type: Error / Performance / Custom Metric
→ Trigger: quando condição exceder threshold
→ Action: Notificar via e-mail / webhook
```

---

## 4. Monitoramento

| Ferramenta                     | O que monitora                           | Configuração                |
| ------------------------------ | ---------------------------------------- | --------------------------- |
| **Sentry**                     | Erros, performance, alertas customizados | DSN configurado em produção |
| **Vercel Analytics**           | Latência por rota, Web Vitals            | Automático em produção      |
| **`/api/health`**              | DB, circuit breakers, env vars           | Polling externo recomendado |
| **UptimeRobot** (a configurar) | Disponibilidade 24/7 a cada 1 min        | Grátis até 50 monitores     |

### Setup UptimeRobot (a fazer)

```
1. Acessar https://uptimerobot.com
2. Create Monitor → HTTP(s)
3. URL: https://clinipharma.com.br/api/health
4. Interval: 1 minute
5. Alert contact: cabralandre@yahoo.com.br
6. Keyword check: "ok" (status field)
```

---

## 5. Incident Response

| Severidade       | Critério                                     | Tempo de resposta | Responsável                       |
| ---------------- | -------------------------------------------- | ----------------- | --------------------------------- |
| **P1 — Crítico** | Plataforma fora do ar ou 0 pedidos possíveis | < 30 min          | Responsável técnico imediatamente |
| **P2 — Alto**    | Feature principal quebrada (ex: pagamento)   | < 2h              | Responsável técnico no mesmo dia  |
| **P3 — Médio**   | Feature secundária degradada                 | < 24h             | Próximo dia útil                  |
| **P4 — Baixo**   | UX/estética, non-blocking bug                | < 7 dias          | Sprint planning                   |

Ver procedimento completo em `docs/disaster-recovery.md`.

---

## 6. Resultados (atualizar mensalmente)

| Mês | Disponibilidade | p95 medido | Taxa de erro | Budget consumido |
| --- | --------------- | ---------- | ------------ | ---------------- |
| —   | —               | —          | —            | —                |

_Preencher após primeira execução em produção._

---

## 7. SLO-as-code (Wave 11)

Esta seção é **código**: cada target abaixo tem (1) uma query
PromQL primária em `docs/sli-queries.md` e (2) um painel em
`monitoring/grafana/*.json`. Qualquer alteração em número
aqui requer PR sincronizado nos três arquivos — caso
contrário as regras de burn-rate divergem do contrato.

Fonte de medição: registry in-memory exposto por
`GET /api/metrics` (Prometheus text, scrape 30 s). Error
budgets computados sobre janela móvel **30 dias**; burn-rate
via multi-window / multi-burn-rate (Google SRE, Cap. 5).

| Ref    | Flow                            | SLI                                                | Target                  | Error budget (30d) |
| ------ | ------------------------------- | -------------------------------------------------- | ----------------------- | ------------------ |
| SLO-01 | Checkout end-to-end             | `orders_created_total{outcome=ok}` / total         | ≥ 99,5 %                | ~216 min downtime  |
| SLO-02 | Payment webhook idempotency     | 0 duplicate credits per `webhook_event.id`         | 100 % (hard)            | 0                  |
| SLO-03 | Auth sign-in p95 latency        | p95 `http_request_duration_ms{path=~/api/auth/..}` | ≤ 400 ms                | latency SLO        |
| SLO-04 | Cron freshness                  | every cron succeeds within SLA window              | ≥ 99,9 % on-time runs   | ~43 runs/mês       |
| SLO-05 | Rate-limit false-positive rate  | `rate_limit_denied_total / rate_limit_hits_total`  | ≤ 1 %                   | ratio SLO          |
| SLO-06 | LGPD DSAR SLA                   | `dsar_sla_breach_total` = 0 em 15 d                | 100 % (hard, legal)     | 0                  |
| SLO-07 | Money drift                     | `money_drift_total` = 0                            | 100 % (hard, financial) | 0                  |
| SLO-08 | Outbound 3rd-party availability | Asaas / Clicksign / Resend success rate (30 d)     | ≥ 99,0 %                | 7,2 h/mês          |
| SLO-09 | Backup + restore recoverability | Weekly backup idade ≤ 9 d E monthly drill ≤ 35 d   | 100 % (hard, DR)        | 0                  |

Classificação de severidade em resposta:

| Ref    | Classe | Razão operacional                                    |
| ------ | ------ | ---------------------------------------------------- |
| SLO-01 | soft   | Carrinho sobrevive; re-order é aceitável             |
| SLO-02 | hard   | Double-charge é reportável LGPD + CDC                |
| SLO-03 | soft   | Latência degrada UX, não correção                    |
| SLO-04 | hard   | Cron miss cascateia (audit chain, offsite backup, …) |
| SLO-05 | soft   | Ruído sinaliza tuning                                |
| SLO-06 | hard   | Deadline legal — ANPD reportável acima de 15 d       |
| SLO-07 | hard   | Cents ≠ numeric é perda de verdade financeira        |
| SLO-08 | soft   | Retry + circuit breaker já compensam                 |
| SLO-09 | hard   | Sem restore comprovado, RPO/RTO = indefinido         |

### 7.1 Política burn-rate

Duas tiers, ambas contra budget de 30 d:

| Tier | Janelas (curta / longa) | Burn rate | Ação           |
| ---- | ----------------------- | --------- | -------------- |
| Fast | 5 min / 1 h             | > 14.4 ×  | P1 → PagerDuty |
| Slow | 30 min / 6 h            | > 6 ×     | P2 → email     |

Um `14.4 ×` significa que o budget mensal seria gasto em 2 d
se o incidente persistisse — tier fast, acorda o on-call.

### 7.2 Ownership

| Ref    | Owner          | Cadência de review | Última revisão |
| ------ | -------------- | ------------------ | -------------- |
| SLO-01 | Growth + SRE   | mensal             | 2026-04-17     |
| SLO-02 | Finance + SRE  | semanal            | 2026-04-17     |
| SLO-03 | Frontend + SRE | mensal             | 2026-04-17     |
| SLO-04 | SRE            | semanal            | 2026-04-17     |
| SLO-05 | Security + SRE | semanal            | 2026-04-17     |
| SLO-06 | DPO + Legal    | semanal            | 2026-04-17     |
| SLO-07 | Finance + SRE  | diária             | 2026-04-17     |
| SLO-08 | Integrations   | semanal            | 2026-04-17     |
| SLO-09 | Platform + SRE | diária             | 2026-04-17     |

### 7.3 Changelog

- **2026-04-17** — Wave 11 baseline. 8 SLOs publicados com
  queries PromQL, burn-rate policy e ownership. Sentry custom
  alerts legados (seção 3) passam a ser suplementares, não a
  fonte primária.
- **2026-04-17** — Wave 12 adiciona SLO-09 (backup + restore
  recoverability) lastreado em `backup_runs` (migração 053) e
  no cron `/api/cron/backup-freshness`. Hard SLO: qualquer
  breach é DR-critical.
