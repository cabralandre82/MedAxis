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

_Wave 11 concluída (2026-04-17): observabilidade ponta-a-ponta — novo módulo `lib/trace.ts` server-only com parser/emitter W3C `traceparent` (rejeita all-zero), `fetchWithTrace()` drop-in wrapper injetando `traceparent` (span filho fresco) + `x-request-id` em todo outbound (+ counter `http_outbound_total{service,method,outcome}` + histogram `http_outbound_duration_ms{service,method,status}` + timeout AbortController default 10s + classificação `ok/error_4xx/error_5xx/error_network/error_timeout`), `enrichSentryScope()` usando Sentry v8 `getCurrentScope()` para stampar `request_id`/`trace_id`/`span_id`/`path`/`method`/`userId`; `middleware.ts` passa a honrar inbound `traceparent` W3C (ou mintar com UUID compactado quando ausente) e propaga tanto no request header (forward para Node) quanto no response header; `lib/logger/wrap.ts::withRouteContext` agora lê `traceparent` e popula `traceId`/`spanId` no AsyncLocalStorage (garantia: toda log line dentro de handler tem trace id); 5 novas métricas em `lib/metrics.ts` (`HTTP_OUTBOUND_TOTAL`, `HTTP_OUTBOUND_DURATION_MS`, `HTTP_REQUEST_DURATION_MS`, `HTTP_REQUEST_TOTAL`, `METRICS_SCRAPE_TOTAL`); novo endpoint `/api/metrics` (Node runtime, `force-dynamic`, added to middleware `PUBLIC_ROUTES`) protegido por `METRICS_SECRET` via `Authorization: Bearer` ou `?token=` com `safeEqualString` time-safe — retorna 500 quando secret ausente em prod-like (`VERCEL_ENV=production|preview`), 401 em mismatch, 200 `text/plain; version=0.0.4` default ou JSON via `?format=json`, aberto em dev com warn único; **`docs/slos.md`** publica 8 SLOs (checkout ≥99.5%, webhook idempotency 100% hard, auth p95 ≤400ms, cron freshness ≥99.9% hard, rate-limit FP ≤1%, DSAR SLA 0-breach hard/legal, money drift 0 hard/financial, 3rd-party ≥99%) com classificação hard/soft, error budgets 30d, ownership por SLO e política burn-rate multi-window (fast 14.4× / slow 6×); **`docs/sli-queries.md`** catálogo PromQL executável 1:1 com as queries; **`monitoring/grafana/*.json`** 3 dashboards JSON-as-code (22 painéis, sem plugins, compatível Grafana 10+) — `platform-health.json` (SLO-01/03/04/08), `security.json` (SLO-05 + CSRF + Turnstile + suspicious IPs + audit chain), `money-and-dsar.json` (SLO-02/06/07 + atomic RPC outcomes + DSAR pipeline + fallback usage) + `README.md` com instruções de import por `curl` e config de scrape em Vector; runbook `observability-gap.md` (P2) com triagem <5min, ground-truth checks (deploy, CF WAF, log volume, Sentry sampling, trace id correlation), mitigação em 4 cenários (500 em prod, dashboards vazios, ALS sem trace id, Sentry silente) e quick reference; **25 unit tests novos** (17 `lib/trace` + 8 `api/metrics-endpoint`) elevando total para **1407 passing**._

_Última atualização: 2026-04-19 — Wave 8 concluída (integer-cents em todo o caminho P&L: migration 050 aplicada em staging+prod com 14 colunas `*_cents BIGINT` espelhando `numeric(x,2)` em 7 tabelas (`orders`, `order_items`, `payments`, `commissions`, `transfers`, `consultant_commissions`, `consultant_transfers`), 7 triggers BEFORE sincronizando bidirecionalmente numeric ↔ cents com `RAISE EXCEPTION P0001` quando writer discorda dos dois, função IMMUTABLE `_money_to_cents(numeric)`, view `public.money_drift_view` listando linhas com drift > 1 cent, e flag `money.cents_read` (default OFF) gating dual-read; `lib/money.ts` com primitivos inteiros `toCents`/`fromCents`/`sumCents`/`mulCentsByQty`/`percentBpsCents`/`percentDecimalCents`/`driftCents`/`formatCents`/`readMoneyField` validados contra os pitfalls clássicos `0.1 + 0.2` e `2.36 * 100`; `lib/money-format.ts` server-only como adapter gated no flag com fail-closed; cron novo `/api/cron/money-reconcile` (every 30 min via `vercel.json`) emitindo counters `money_drift_total{table,field}` + alerta P2 deduplicado com runbook inline; RPCs atômicos (W7) continuam escrevendo apenas numeric e cents são preenchidos automaticamente via trigger — nenhuma mudança nos contratos W7; 60 unit tests novos (42 money + 13 format + 5 cron) levando o total para 1292 passing; runbook `money-drift.md` com árvore de decisão por padrão de drift, queries de diagnóstico e 3 mitigações)._

_Wave 10 concluída: migration 052 aplicada em staging+prod criando `public.rate_limit_violations` (minute-bucketed aggregation table, `ip_hash = sha256(ip||salt)` LGPD-safe, PK via unique index `(bucket, ip_hash, bucket_minute)`) + view `public.rate_limit_report_view` (last-hour rollup with top-offender ordering) + RPCs SECURITY DEFINER `rate_limit_record(text, text, uuid, jsonb)` (upsert com `hits=hits+1` em conflito) e `rate_limit_purge_old(int)` (30-day retention) + flag `security.turnstile_enforce` (default OFF); upgrade de `lib/rate-limit.ts` adicionando `guard(req, limiter, bucket)` com persistence via RPC (void — fire-and-forget), `X-RateLimit-*` + `Retry-After` headers, RFC 7807 problem+json body, fail-open em erro do limiter, counter `rate_limit_hits_total{bucket,outcome}` + histogram `rate_limit_check_duration_ms{bucket}` + counter `rate_limit_denied_total{bucket}`, `extractClientIp()` (XFF leftmost) e `hashIp()` (SHA-256 com `RATE_LIMIT_IP_SALT` + warn-once em missing), + 6 pre-configured limiters novos (`lgpdFormLimiter 3/h`, `lgpdExportLimiter 5/h`, além dos existentes `authLimiter`/`apiLimiter`/`registrationLimiter`/`exportLimiter`), + `Bucket` constants (`LGPD_DELETION`, `LGPD_EXPORT`, `AUTH_FORGOT`, `REGISTER_SUBMIT`, etc.); novo módulo `lib/turnstile.ts` com `verifyTurnstile({token, remoteIp, bucket, required})` (fail-open quando flag OFF, fail-closed quando flag ON + secret missing, 5s AbortController timeout, timeout-or-duplicate mapeado como `softFailure`, counters `turnstile_verify_total{bucket,outcome}` + histogram `turnstile_verify_duration_ms`) e `extractTurnstileToken(req)` suportando header `x-turnstile-token`, JSON `{turnstileToken|cf-turnstile-response}`, e form-data `cf-turnstile-response`; rotas `lgpd/deletion-request` (3/h per-user), `lgpd/export` (5/h per-user), `auth/forgot-password` (5/min per-IP) e `registration/submit` (3/10min per-IP) promovidas ao `guard()` + `verifyTurnstile` (role OFF durante rollout); novo cron `/api/cron/rate-limit-report` (every 15 min via `vercel.json`) com severity ladder P3 info / P2 warn (≥10 IPs OR >100 hits/IP) / P1 crit (≥50 IPs OR >500 hits/IP OR >5 buckets/IP credential-stuffing signal), dedup keys `rate-limit:spike:crit` e `rate-limit:spike:warn`, retention via `rate_limit_purge_old(30)` a cada run (best-effort), counter `rate_limit_suspicious_ips_total{severity}` e `classifyReport()` puro exportado para teste; 46 unit tests novos (16 `lib/rate-limit-guard` + 16 `lib/turnstile` + 14 `api/rate-limit-report`) levando total para 1382 passing; runbook `rate-limit-abuse.md` com tabela de padrões (single-IP vs many-IP, credential-stuffing vs form-spam), 3 mitigações (Cloudflare WAF block, Turnstile enforce, bucket budget lowering), queries de diagnóstico, ground-truth false-positive checks, escalation path para Security em 30 min em P1 com credential-stuffing signature._

_Wave 9 concluída: migration 051 aplicada em staging+prod, criando `public.dsar_requests` (queue com state-machine validated via trigger) + `public.dsar_audit` (append-only hash-chained) + `profiles.anonymized_at` / `anonymized_by` + RPCs SECURITY DEFINER `dsar_transition(uuid, text, jsonb)` e `dsar_expire_stale(int)`; `lib/dsar.ts` server-only com `createDsarRequest`/`transitionDsarRequest`/`hashCanonicalBundle`/`signCanonicalBundle`/`verifyCanonicalBundle` (HMAC-SHA256 sobre canonical JSON, timingSafeEqual na verificação); `lib/audit::logPiiView()` helper emitindo `action='VIEW_PII'` com scope; rotas `lgpd/deletion-request` e `lgpd/export` promovidas ao DSAR queue (export agora assinado com `X-LGPD-Export-Signature: sha256=<hex>`); `admin/lgpd/anonymize` agora popula `anonymized_at` + fecha a ERASURE DSAR com `delivery_hash`; cron novo `/api/cron/dsar-sla-check` (hourly, `0 * * * *`) com severity-ladder P1 (flag ON + breach) / P2 (breach sem flag OU warning-only), dedup keys `lgpd:dsar:sla:breach` e `lgpd:dsar:sla:warning`, auto-expire via `dsar_expire_stale(30)` só com `dsar.sla_enforce` = true; 8 métricas novas (`dsar_opened_total`, `dsar_transition_total`, `dsar_transition_error_total`, `dsar_transition_duration_ms`, `dsar_sla_breach_total`, `dsar_sla_warning_total`, `dsar_expired_total`, `dsar_duplicate_open_total`); 44 unit tests novos (31 `lib/dsar` + 8 `cron/dsar-sla-check` + 5 `logPiiView`) levando o total para 1336 passing; runbook `dsar-sla-missed.md` com árvore de decisão por tamanho de backlog, 4 estratégias de mitigação (fulfill manual / reject com código legal / kill-switch / recovery de erasure parcial), tabela de reject_codes (`NFSE_10Y`, `RDC_22_2014`, `ART_37_LGPD`) e playbook de escalação para ANPD conforme Art. 48._
