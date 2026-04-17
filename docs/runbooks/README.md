# Clinipharma — Runbooks

**Propósito:** respostas executáveis a sintomas observados em produção. Cada runbook é escrito em modo **imperativo** para permitir execução sob pressão às 3h da manhã.

**Responsáveis:** on-call engineer primeiro; escalar conforme `docs/on-call.md`.

---

## Índice de runbooks

### 🔴 P1 — Incidente crítico (cliente impactado)

| Runbook                         | Sintoma disparador                              | Alerta de origem                     |
| ------------------------------- | ----------------------------------------------- | ------------------------------------ |
| `order-volume-drop.md`          | Queda abrupta de pedidos                        | `detect_order_volume_anomaly` cron   |
| `payment-confirmation-stuck.md` | Webhooks Asaas sem processar há >15 min         | SLO burn rate "payment confirmation" |
| `database-unavailable.md`       | `/api/health/ready` retornando 503 por >2 min   | UptimeRobot + Sentry                 |
| `audit-chain-tampered.md`       | `verify_audit_chain` retorna >0 inconsistências | Cron noturno                         |

### 🟠 P2 — Degradação (cliente afetado pode contornar)

| Runbook                        | Sintoma disparador                              | Alerta de origem           |
| ------------------------------ | ----------------------------------------------- | -------------------------- |
| `external-integration-down.md` | Circuit breaker aberto (Asaas/Clicksign/Resend) | `/api/health/deep`         |
| `cron-job-failing.md`          | Cron em loop de falha                           | `cron_runs` + Slack        |
| `email-deliverability-low.md`  | Taxa de bounce > 5% em 24h                      | Resend dashboard           |
| `connection-pool-exhausted.md` | Supabase pool > 80% por >5 min                  | `/api/cron/db-pool-health` |

### 🟡 P3 — Degradação silenciosa (backlog)

| Runbook                | Sintoma disparador                    |
| ---------------------- | ------------------------------------- |
| `ticket-sla-breach.md` | Tickets de suporte sem resposta > SLA |

---

## Template para novos runbooks

Use `_template.md` como base. Cada runbook deve ter:

1. **Gravidade** (P1/P2/P3)
2. **Sintomas observados** (o que o alerta mostrou)
3. **Impacto no cliente** (o que o cliente vê)
4. **Primeiros 5 minutos** (containment imediato)
5. **Diagnóstico** (queries SQL, endpoints, logs a inspecionar)
6. **Mitigação** (como estancar o sangramento)
7. **Correção** (como resolver definitivamente)
8. **Post-incident** (o que criar como issue follow-up)
9. **Links** (dashboards, Sentry, Supabase)

---

## Regras gerais

1. **Nunca** modifique dados em produção sem registro em `audit_logs` + comentário `incident:<id>`.
2. **Sempre** abra um canal `#incident-<yyyy-mm-dd>` no Slack ao iniciar um P1.
3. **Sempre** tire um "snapshot" do estado (queries de diagnóstico) **antes** de qualquer mitigação.
4. Se usar `terminate_idle_transactions()` em produção, **logue quem autorizou** em `#ops-approvals`.
5. Após resolver P1/P2, abrir post-mortem em ≤ 72h (template em `.github/ISSUE_TEMPLATE/postmortem.md`).

---

## Contatos de emergência

Ver `docs/on-call.md` para rotação vigente e contatos atuais.

| Função           | Canal primário                | Canal de fallback    |
| ---------------- | ----------------------------- | -------------------- |
| On-call engineer | PagerDuty                     | WhatsApp do fundador |
| Supabase         | Dashboard chat (plano pago)   | Discord oficial      |
| Vercel           | Dashboard support (pago)      | Status page          |
| Asaas            | email `suporte@asaas.com`     | telefone comercial   |
| Clicksign        | email `suporte@clicksign.com` | telefone comercial   |

---

_Os runbooks individuais serão criados na Sprint 11 do `docs/implementation-plan.md`._
