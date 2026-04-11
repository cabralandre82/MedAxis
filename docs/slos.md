# Clinipharma — Service Level Objectives (SLOs)

**Versão:** 1.0 | **Data:** 2026-04-08
**Revisão:** Trimestral

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
→ Action: Notificar via e-mail / Slack / webhook
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
