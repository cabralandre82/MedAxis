# Clinipharma — Runbooks

**Propósito:** respostas executáveis a sintomas observados em produção. Cada runbook é escrito em modo **imperativo** para permitir execução sob pressão às 3h da manhã.

**Responsáveis:** on-call engineer primeiro; escalar conforme `docs/on-call.md`.

> **Companion skills:** para os runbooks mais críticos e recorrentes,
> existem skills executáveis (compactas, com checklist + SQL pronto
> para copiar) em [`.cursor/skills/`](../../.cursor/skills/README.md).
> Use o skill na emergência; leia o runbook para entender o "por quê".

---

## Índice de runbooks

### 🔴 P1 — Incidente crítico (cliente impactado)

| Runbook                         | Sintoma disparador                                                                                                | Alerta de origem                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `order-volume-drop.md`          | Queda abrupta de pedidos                                                                                          | `detect_order_volume_anomaly` cron       |
| `payment-confirmation-stuck.md` | Webhooks Asaas sem processar há >15 min                                                                           | SLO burn rate "payment confirmation"     |
| `database-unavailable.md`       | `/api/health/ready` retornando 503 por >2 min                                                                     | UptimeRobot + Sentry                     |
| `audit-chain-tampered.md`       | `verify_audit_chain` retorna >0 inconsistências                                                                   | Cron noturno                             |
| `rls-violation.md`              | Canário diário detecta vazamento de tenant ou erro de RLS (Wave 14) — P0 quando `rls_canary.page_on_violation` ON | `rls_canary_violations_total` + cron     |
| `secret-compromise.md`          | Suspeita ou confirmação de leak de qualquer secret rastreado pelo manifesto Wave 15                               | DPO/Security + ledger `secret_rotations` |

### 🟠 P2 — Degradação (cliente afetado pode contornar)

| Runbook                        | Sintoma disparador                                                          | Alerta de origem                         |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `external-integration-down.md` | Circuit breaker aberto (Asaas/Clicksign/Resend)                             | `/api/health/deep`                       |
| `cron-job-failing.md`          | Cron em loop de falha                                                       | `cron_runs` + email                      |
| `cron-double-run.md`           | Cron `skipped_locked` repetido ou lock órfão                                | `cron_runs` + `cron_locks`               |
| `webhook-replay.md`            | `webhook_events.status=failed` acumulando ou sender-loop                    | Sentry + `webhook_events`                |
| `email-deliverability-low.md`  | Taxa de bounce > 5% em 24h                                                  | Resend dashboard                         |
| `connection-pool-exhausted.md` | Supabase pool > 80% por >5 min                                              | Supabase Dashboard + `/api/health/ready` |
| `rbac-permission-denied.md`    | Spike de `permission denied` após ativação de `rbac.fine_grained`           | `server_logs` + painel flags             |
| `csrf-block-surge.md`          | Spike de `csrf_blocked` em `/api/**` após Wave 5                            | `server_logs` + 403 rate                 |
| `health-check-failing.md`      | `/api/health/ready` ou `/deep` retornando `degraded` por >5 min             | UptimeRobot + Sentry                     |
| `alerts-noisy.md`              | Enxurrada de emails / páginas de `lib/alerts` fora de incidente             | PagerDuty + `OPS_ALERT_EMAIL`            |
| `atomic-rpc-mismatch.md`       | Divergência ou spike de erros nas RPCs atômicas (Wave 7)                    | `atomic_rpc_total` + logs                |
| `money-drift.md`               | `money_drift_view` não vazia: cents ≠ numeric por > 1 cent (Wave 8)         | `money_drift_total` + cron               |
| `dsar-sla-missed.md`           | LGPD DSAR > 15 dias sem fulfill/reject (Wave 9)                             | `dsar_sla_breach_total` + cron           |
| `rate-limit-abuse.md`          | Spike de HTTP 429 > 10 IPs/h ou credential stuffing (Wave 10)               | `rate_limit_suspicious_ips_total` + cron |
| `observability-gap.md`         | Dashboards vazios ou `/api/metrics` sem coleta por >15 min (Wave 11)        | Synthetic scrape + deep health           |
| `backup-missing.md`            | Backup fresco > 9 d ou restore drill > 35 d ou chain break (Wave 12)        | `backup_freshness_breach_total` + cron   |
| `legal-hold-received.md`       | Recepção de ordem ANPD/CDC/judicial ou suspeita de purge indevido (Wave 13) | DPO + `legal_hold_blocked_*`             |

### 🟡 P3 — Degradação silenciosa (backlog)

| Runbook                | Sintoma disparador                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `ticket-sla-breach.md` | Tickets de suporte sem resposta > SLA                                                                |
| `vercel-cron-quota.md` | Deploys silenciosamente rejeitados por `cron_jobs_limits_reached` (Hobby plan ↔ sub-daily schedules) |

---

## Runbooks com skill dedicado (fast-path para agentes)

| Runbook                   | Skill dedicado                                                               | Quando usar                                                |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| _Qualquer P1/P2_          | [`incident-open`](../../.cursor/skills/incident-open/SKILL.md)               | **Ponto de entrada** — use ANTES do runbook específico     |
| `dsar-sla-missed.md`      | [`dsar-fulfill`](../../.cursor/skills/dsar-fulfill/SKILL.md)                 | Processar DSAR EXPORT / ERASURE / CORRECTION / PORTABILITY |
| `legal-hold-received.md`  | [`legal-hold-apply`](../../.cursor/skills/legal-hold-apply/SKILL.md)         | Ordem ANPD / PROCON / judicial recebida                    |
| `audit-chain-tampered.md` | [`audit-chain-verify`](../../.cursor/skills/audit-chain-verify/SKILL.md)     | Cron `verify-audit-chain` falhou                           |
| `secret-compromise.md`    | [`secret-compromise`](../../.cursor/skills/secret-compromise/SKILL.md)       | Leak confirmado ou suspeito                                |
| `secret-rotation.md`      | [`secret-rotate`](../../.cursor/skills/secret-rotate/SKILL.md)               | Rotação programada 90d / 180d                              |
| `rls-violation.md`        | [`rls-violation-triage`](../../.cursor/skills/rls-violation-triage/SKILL.md) | Canário RLS violation                                      |
| `backup-missing.md`       | [`backup-verify`](../../.cursor/skills/backup-verify/SKILL.md)               | Freshness / restore drill / chain break                    |
| `money-drift.md`          | [`money-drift`](../../.cursor/skills/money-drift/SKILL.md)                   | `money_drift_view` não-vazio; cents ≠ numeric              |
| `health-check-failing.md` | [`health-check-triage`](../../.cursor/skills/health-check-triage/SKILL.md)   | `/api/health/*` degraded; ponto de entrada para sub-skills |
| `rate-limit-abuse.md`     | [`rate-limit-abuse`](../../.cursor/skills/rate-limit-abuse/SKILL.md)         | Spike de HTTP 429; credential stuffing; form spam          |

Os skills são lidos automaticamente pelo agente quando o trigger da
descrição bate com a solicitação do operador (`"processar DSAR"`,
`"secret vazou"`, `"backup stale"`, etc.). Eles contêm checklist +
comandos prontos; para o contexto completo (regulatório, histórico,
decisões passadas), o runbook é a fonte canônica.

Skills novos seguem o guia em `.cursor/skills/README.md` §"Writing a new skill".

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
2. **Sempre** abra uma issue no GitHub com label `incident` ao iniciar um P1 — comentários cronológicos substituem o canal de chat.
3. **Sempre** tire um "snapshot" do estado (queries de diagnóstico) **antes** de qualquer mitigação.
4. Se usar `terminate_idle_transactions()` em produção, **registre quem autorizou** como comentário na issue de incidente.
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
