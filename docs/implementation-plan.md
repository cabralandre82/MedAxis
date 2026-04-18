# Clinipharma — Plano de Implementação (Auditoria 2026-04)

**Fonte:** `docs/audit-fine-tooth-comb-2026-04.md` (20 lentes, 187 sub-itens)
**Status:** Em execução — o agente é o executor, aprovador humano faz review de cada PR.
**Log de execução:** `docs/execution-log.md`
**Data:** 2026-04-17

> Plano organizado em **waves** (PR-por-wave) em vez de sprints. Cada wave é independentemente deployável, testada, documentada e reversível via feature flag. O **pentest externo foi explicitamente removido** deste ciclo; compensamos com scanners automatizados (CodeQL + Gitleaks + Trivy + npm audit) + E2E de segurança + DAST opcional.

---

## Modelo de execução

### Princípios

1. **1 wave = 1 PR mergeável.** Main sempre verde. Rollback = revert do commit.
2. **Migration antes do código.** SQL aplicado em staging → validado → prod → depois o código que consome é mergeado.
3. **Feature flag para tudo arriscado.** Kill-switch em 10 segundos se algo explodir.
4. **Dual-write / dual-read em schema sensível.** Troca de tipo (ex.: money → cents) acontece em 2 PRs: aditivo, depois cutover.
5. **Gate humano antes de aplicar migration em prod.** Agente prepara, humano aprova e mergeia.
6. **Cada wave atualiza `docs/execution-log.md`** com timestamps, commits, testes e evidências.

### Checklist "Done" de cada wave

- [ ] Migration (se houver) idempotente, commentada, com rollback documentado
- [ ] Código com teste unitário + teste de integração quando aplicável
- [ ] Cobertura não regride (threshold global mantido em `vitest.config.ts`)
- [ ] `npm run lint` + `npx tsc --noEmit` sem erros
- [ ] `npm run test` verde
- [ ] E2E smoke verde em staging após deploy
- [ ] `docs/execution-log.md` atualizado
- [ ] Runbook/documentação associada atualizada
- [ ] Feature flag inicializada em `OFF` quando aplicável

---

## Waves

### Fase 0 — Safety net

**Wave 0 — Fundações (em execução)**

| Item | Entrega                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Feature flags infra — `supabase/migrations/044_feature_flags.sql`, `lib/features/index.ts`, testes                    |
| 0.2  | `ci.yml:security-scan` (CodeQL + Gitleaks + Trivy + npm audit)                                                        |
| 0.3  | `CODEOWNERS` + `.github/dependabot.yml` + doc de branch protection                                                    |
| 0.4  | `.github/workflows/offsite-backup.yml` + `.github/workflows/restore-drill.yml` + `docs/disaster-recovery.md` revisado |
| 0.5  | `docs/implementation-plan.md` (este arquivo) + `docs/execution-log.md` inicializado                                   |

### Fase 1 — Observabilidade + perímetro de segurança

Cada wave abaixo é independente, mas a ordem maximiza ganho cumulativo.

| Wave | Entrega                                                                                                                                                                       | Pré-req |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1    | Logger com redação PII + correlação (request-id/trace-id/span-id)                                                                                                             | W0      |
| 2    | Webhook dedup (`webhook_events(idempotency_key)`) + `runCronGuarded` com `pg_try_advisory_xact_lock` + `cron_runs`                                                            | W0      |
| 3    | Audit append-only + hash chain + `verify_audit_chain` RPC + cron noturno                                                                                                      | W2      |
| 4    | RBAC granular: `permissions`/`role_permissions`/`user_permission_grants` + `lib/rbac/permissions.ts`, migração gradual de `requireRole` → `requirePermission` feature-flagged | W3      |
| 5    | CSRF double-submit + HMAC `timingSafeEqual` + open-redirect allowlist + E2E de ataque                                                                                         | W1      |
| 6    | Health 3 camadas (`/live`, `/ready`, `/deep`) + `lib/metrics.ts` + `lib/alerts.ts` (email + PagerDuty)                                                                        | W1      |
| 7    | SLO burn rate multi-window + OTEL completo (`instrumentation.ts`, `fetchExternal`) + admin SLO dashboard                                                                      | W6      |

### Fase 2 — Correção transacional + schema

**Sequência crítica — não pode ser paralelizada.**

| Wave | Entrega                                                                                          | Pré-req              |
| ---- | ------------------------------------------------------------------------------------------------ | -------------------- |
| 8    | Money cents **phase 1** — colunas aditivas `*_cents bigint` + dual-write em services             | W0                   |
| 9    | Money cents **phase 2** — backfill + switch reads para cents + property tests de invariantes     | W8 (≥7 dias estável) |
| 10   | RPC `create_order_atomic` — substitui fluxo N+1 em `services/orders.ts`                          | W9                   |
| 11   | RPCs `apply_coupon_atomic` + `confirm_payment_atomic` + `lock_version` em aggregates             | W10                  |
| 12   | Schema hardening remainder — enums nativos, `ON DELETE RESTRICT`, UUIDv7, `deleted_at` unificado | W11                  |
| 13   | Index hardening (`CREATE INDEX CONCURRENTLY`) — FK, partial, covering, BRIN                      | W12                  |
| 14   | Pool/timeouts por role (`statement_timeout`, `lock_timeout`, `idle_in_transaction`)              | W13                  |

### Fase 3 — Capacidade e qualidade

| Wave | Entrega                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 15   | Particionamento `audit_logs` por mês + autovacuum tuning + BRIN                                                          |
| 16   | N+1 elimination — `lib/db/cached-queries.ts` + embedded selects + `mv_pharmacy_daily_metrics`                            |
| 17   | `fraud_signals` + self-dealing + velocity-check                                                                          |
| 18   | A11y — axe-core E2E + correções de contraste/ARIA                                                                        |
| 19   | Email — `List-Unsubscribe-Post` + quiet hours + digest + sanitização templates                                           |
| 20   | Testing infra — vitest projects (`unit`/`integration`) + property (`fast-check`) + contract tests + mutation (`stryker`) |

### Fase 4 — Operação madura

| Wave | Entrega                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 21   | Four-eyes workflow + impersonation controlada                                                          |
| 22   | Status page pública + synthetic monitor (Playwright GH Actions) + RUM                                  |
| 23   | Hexagonal para `orders` — `core/` + `adapters/` + `services/orders.ts` orquestrador fino               |
| 24   | API versioning `/v1/` + OpenAPI gerada de Zod + deprecation headers (RFC 8594)                         |
| 25   | 9 runbooks em `docs/runbooks/` + `docs/on-call.md` + `docs/chaos-engineering.md` + postmortem template |

---

## Dependências

```
W0 ── W1 ── W5 (perímetro)
  │     └─── W6 ── W7
  │
  ├── W2 ── W3 ── W4
  │               │
  ├── W8 ── W9 ── W10 ── W11 ── W12 ── W13 ── W14
  │                                            │
  │                                            └── W15
  │
  └── W16..W25 (podem iniciar em paralelo após respectivos pré-reqs)
```

---

## Numeração de migrations

Migrations existentes vão até `043_server_logs.sql`. As novas continuam a partir de `044`:

| Migration | Wave | Finalidade                                                        |
| --------- | ---- | ----------------------------------------------------------------- |
| 044       | W0   | Feature flags                                                     |
| 045       | W2   | `webhook_events` + `cron_runs`                                    |
| 046       | W3   | Audit hardening (hash chain)                                      |
| 047       | W4   | Fine-grained permissions                                          |
| 048       | W8   | Money cents — colunas aditivas                                    |
| 049       | W9   | Money cents — cutover (drop numeric)                              |
| 050       | W10  | `create_order_atomic`                                             |
| 051       | W11  | `apply_coupon_atomic` + `confirm_payment_atomic` + `lock_version` |
| 052       | W12  | Schema hardening (enums, FKs, UUIDv7, soft-delete)                |
| 053       | W13  | Index hardening                                                   |
| 054       | W14  | Pool & timeouts                                                   |
| 055       | W15  | `audit_logs` partitioning                                         |
| 056       | W16  | Materialized views                                                |
| 057       | W17  | `fraud_signals`                                                   |
| 058       | W21  | Four-eyes + impersonation                                         |
| 059       | W22  | Status page + RUM                                                 |

---

## Budget e governança

- **Pentest externo:** removido deste ciclo (decisão 2026-04-17). Substituído por scanners automáticos + E2E security.
- **PagerDuty:** starter plan a provisionar quando W6 estiver pronta (~$21/user/mês).
- **S3 offsite:** Cloudflare R2 (custo próximo a zero no volume atual) a configurar em W0.4.
- **Codecov / UptimeRobot:** free tier.

### Review por wave

- Agente abre PR, marca reviewer (humano aprovador).
- Humano revisa, aprova ou pede ajuste.
- Humano mergeia após aprovação (ou agente mergeia se configurado auto-merge).
- Agente monitora deploy em staging por tempo definido em `docs/execution-log.md`.
- Somente após estabilidade confirmada em staging, migration é aplicada em prod e código promovido.

---

_Para detalhes técnicos de cada correção ver `docs/audit-fine-tooth-comb-2026-04.md`._
_Última atualização: 2026-04-19 — Wave 7 concluída (RPCs atômicas em 3 caminhos críticos: `public.create_order_atomic(jsonb)` / `public.apply_coupon_atomic(text, uuid)` / `public.confirm_payment_atomic(uuid, jsonb)`; colunas `lock_version` em `orders` e `payments` para optimistic locking; migration 049 aplicada em staging+prod seedando `orders.atomic_rpc` / `coupons.atomic_rpc` / `payments.atomic_confirm` (shadow mode, todos OFF); `lib/services/atomic.server.ts` como wrapper dual-path (flag decide RPC vs legacy, `rpc_unavailable` → fallback automático); 3 serviços pilotos migrados (`services/orders.ts::createOrder`, `services/coupons.ts::activateCoupon`, `services/payments.ts::confirmPayment`) preservando comportamento quando flag OFF; primeiro client mutante (`notification-preferences.tsx`) migrado para `fetchWithCsrf` fechando o círculo CSRF; métricas novas `atomic_rpc_total` / `atomic_rpc_duration_ms` / `atomic_rpc_fallback_total`; 27 unit tests novos (cobrindo wrapper + simulação de race double-activation/double-confirm); runbook `atomic-rpc-mismatch.md`)._
