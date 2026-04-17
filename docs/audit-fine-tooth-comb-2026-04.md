# Clinipharma — Auditoria Total "Fine-Tooth Comb" Pre-Release

**Versão:** 1.0 **Data:** 2026-04-17
**Escopo:** 20 lentes executivas, 187 sub-itens auditados sobre o código completo do repositório.
**Reconciliado com:** `docs/known-limitations.md`, `docs/PENDING.md`, `docs/roadmap-90pts.md`, `docs/slos.md`, `docs/disaster-recovery.md`, `docs/audit-qa-plena-2026-04.md`.

> Esta auditoria **não substitui** `audit-qa-plena-2026-04.md` (que cobre casos de teste operacionais). Ela **complementa** com uma varredura arquitetural/estrutural do código sob 20 perspectivas de liderança sênior e propõe correções concretas.

---

## Como ler este documento

Cada lente tem:

1. **Sub-itens auditados** — áreas específicas dentro da lente
2. **Veredicto macro** — 🔴 CRÍTICO | 🟠 ALTO | 🟡 MÉDIO | 🟢 SEGURO | ⚪ N/A
3. **Arquivos/migrations entregues** — ponteiros para código e SQL
4. **Próximas ações** — referência para `docs/implementation-plan.md`

Convenção de migrations: arquivos `101+` foram introduzidos por esta auditoria e **ainda não estão aplicados**. A priorização e ordem de aplicação estão em `docs/implementation-plan.md`.

---

## Resumo executivo

| #   | Lente                               | Perspectiva                                    | Veredicto macro | Sub-itens |
| --- | ----------------------------------- | ---------------------------------------------- | --------------- | --------- |
| 1   | CISO — Attack surface               | Segurança aplicacional                         | 🔴 CRÍTICO      | 35        |
| 2   | CTO — Arquitetura & race conditions | Integridade transacional                       | 🔴 CRÍTICO      | 10        |
| 3   | CFO — Integridade financeira        | Money math & precisão                          | 🔴 CRÍTICO      | 10        |
| 4   | CLO — LGPD & contratual             | Legal/compliance                               | 🔴 CRÍTICO      | 8         |
| 5   | CPO — Edge cases de produto         | Regras de negócio                              | 🟠 ALTO         | 10        |
| 6   | COO — Fluxos operacionais           | SLA, aprovação, revisão                        | 🟠 ALTO         | 8         |
| 7   | CXO — UX / A11y / frontend          | Experiência e inclusão                         | 🟠 ALTO         | 10        |
| 8   | CDO — Data integrity & migrações    | Qualidade de schema                            | 🟠 ALTO         | 6         |
| 9   | CRO — Business model & fraude       | Anti-abuso                                     | 🟠 ALTO         | 6         |
| 10  | CSO — Escalabilidade                | Paginação, realtime, N+1                       | 🟠 ALTO         | 5         |
| 11  | Supply chain                        | SBOM, CVE, Dependabot                          | 🟠 ALTO         | 5         |
| 12  | Cron & Inngest jobs                 | Idempotência, single-flight                    | 🔴 CRÍTICO      | 18        |
| 13  | Middleware/sessão/auth              | Cookies, CSRF, MFA                             | 🟠 ALTO         | 5         |
| 14  | Contratos & ops compliance          | Clicksign, versioning                          | 🟠 ALTO         | 4         |
| 15  | CMO — Comms & retenção              | Email, push, DMARC                             | 🟡 MÉDIO        | 4         |
| 16  | CAO — Gestão interna                | RBAC fino, impersonation, 4-eyes               | 🟠 ALTO         | 4         |
| 17  | VPE — Qualidade de código & testes  | Coverage, contratos, property                  | 🟡 MÉDIO        | 8         |
| 18  | Staff/Principal — Padrões           | Hexagonal, DDD, feature flags                  | 🟡 MÉDIO        | 6         |
| 19  | DBA — Schema & performance          | Tipos, índices, particionamento, pool, backups | 🟠 ALTO         | 6         |
| 20  | SRE — Observability & recovery      | Métricas, SLOs, runbooks, status page          | 🟠 ALTO         | 7         |

**Total:** 187 sub-itens. **🔴 CRÍTICOS:** 5 lentes. **🟠 ALTOS:** 11 lentes. **🟡 MÉDIOS:** 4 lentes.

---

## Entregáveis físicos desta auditoria

### Novas migrations SQL (14)

| Migration                          | Lente    | Finalidade                                                                                  |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `101_fine_grained_permissions.sql` | 16       | Tabelas `permissions`, `role_permissions`, `user_permission_grants`; RPC `has_permission()` |
| `102_audit_hardening.sql`          | 16       | Audit logs append-only; hash-chain; `verify_audit_chain` RPC; archive                       |
| `103_impersonation.sql`            | 16       | `impersonation_sessions` + guards (bloqueia `SUPER_ADMIN`)                                  |
| `104_four_eyes_approvals.sql`      | 16       | Workflow de 4-eyes para ações críticas                                                      |
| `105_feature_flags.sql`            | 18       | Feature flags com rollout, targeting, kill-switch                                           |
| `106_schema_hardening.sql`         | 19       | `*_cents bigint`, enums nativos, `ON DELETE` explícito, `lock_version`, UUIDv7, GIN         |
| `107_indexes_hardening.sql`        | 19       | FK indexes, partial `deleted_at IS NULL`, composites, BRIN, `v_unused_indexes`              |
| `108_create_order_atomic.sql`      | 2, 3, 19 | RPC transacional `create_order_atomic()`                                                    |
| `109_partitioning_and_vacuum.sql`  | 19       | Partição mensal `audit_logs`, fillfactor 85, autovacuum tuning                              |
| `110_pool_and_timeouts.sql`        | 19       | `statement_timeout`/`lock_timeout` por role, `v_active_queries`, kill switch                |
| `111_anomaly_detection.sql`        | 20       | RPC `detect_order_volume_anomaly()`                                                         |
| `112_health_infra.sql`             | 20       | `select_one()` + `health_pings` para health deep                                            |
| `113_rum_events.sql`               | 20       | RUM events particionado por mês                                                             |
| `114_status_page.sql`              | 20       | `status_components` + `status_incidents` (public-read)                                      |

### Novos módulos TypeScript (~60 arquivos)

**Core & RBAC (Lentes 16, 18):**

- `lib/rbac/permissions.ts`, `lib/rbac/four-eyes.ts`, `lib/rbac/impersonation-guard.ts`
- `lib/impersonation.ts`, `components/impersonation-banner.tsx`
- `lib/audit/pii-logger.ts`

**Domínio hexagonal (Lente 18):**

- `core/orders/{ports,domain,state-machine-runner,use-cases/create-order}.ts`
- `core/policies/clinic-access.ts`, `core/money/money.ts`, `core/audit/event.ts`
- `core/shared/{ids,event-bus}.ts`, `core/products/prescription-requirement.ts`
- `adapters/supabase/order-repository.ts`, `adapters/inngest/event-bus.ts`

**Feature flags & API (Lente 18):**

- `lib/features/index.ts`, `lib/api/deprecation.ts`
- `app/api/v1/openapi/route.ts`, `lib/integrations/asaas/webhook-v2.ts`

**Observabilidade (Lente 20):**

- `lib/metrics.ts`, `lib/alerts.ts`, `lib/slo/burn-rate.ts`, `lib/http/fetch-external.ts`
- `lib/logger.ts` (revisado com redação PII + correlation)
- `sentry.server.config.ts` (revisado com `beforeSend` PII strip)
- `app/api/health/{live,ready,deep}/route.ts`, `app/api/rum/route.ts`
- `components/providers/rum-provider.tsx`
- `app/(private)/admin/slo-dashboard/page.tsx`
- `app/status/page.tsx`

**DB helpers (Lente 19):**

- `lib/db/cached-queries.ts`, `lib/db/admin.ts` (revisado com timeouts)

### Novos crons Vercel (8)

```json
[
  { "path": "/api/cron/verify-audit-chain", "schedule": "0 3 * * *" },
  { "path": "/api/cron/expire-four-eyes", "schedule": "*/15 * * * *" },
  { "path": "/api/cron/rotate-audit-partitions", "schedule": "0 4 1 * *" },
  { "path": "/api/cron/db-pool-health", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/emit-business-metrics", "schedule": "*/15 * * * *" },
  { "path": "/api/cron/detect-anomalies", "schedule": "*/10 * * * *" },
  { "path": "/api/cron/slo-burn-rate", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/sync-status-page", "schedule": "*/2 * * * *" }
]
```

### Novos workflows GitHub Actions (12+)

| Workflow                    | Finalidade                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| `offsite-backup.yml`        | Backup semanal cifrado (`age`) → S3 externo                         |
| `restore-drill.yml`         | Restore drill mensal em staging com verify-chain                    |
| `synthetic-monitor.yml`     | 4 jornadas Playwright a cada 5 min                                  |
| `post-deploy.yml`           | Sentry release + Slack announce pós-deploy                          |
| `setup-uptime-monitors.yml` | Provisiona UptimeRobot programaticamente                            |
| `ci.yml` (revisado)         | `lint-typecheck-format`, `db-tests`, `security-scan`, `e2e-preview` |

### Documentação nova / revisada

| Doc                                     | Status                                         |
| --------------------------------------- | ---------------------------------------------- |
| `docs/audit-fine-tooth-comb-2026-04.md` | **NEW** (este arquivo)                         |
| `docs/implementation-plan.md`           | **NEW**                                        |
| `docs/runbooks/README.md`               | **NEW** (index)                                |
| `docs/runbooks/*.md`                    | **TO CREATE** (9 runbooks)                     |
| `docs/on-call.md`                       | **NEW**                                        |
| `docs/chaos-engineering.md`             | **NEW**                                        |
| `docs/api-deprecation-policy.md`        | **NEW**                                        |
| `.github/ISSUE_TEMPLATE/postmortem.md`  | **NEW**                                        |
| `docs/disaster-recovery.md`             | **REVISADO** (RTO/RPO formais, offsite, drill) |
| `docs/slos.md`                          | **REVISADO** (journey SLOs, burn rate)         |

---

## Matriz macro de findings por lente

### 🔴 CRÍTICOS (bloqueiam go-live enterprise)

| Lente       | Finding-chave                                                                                                                                                                              | Correção canônica                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **1 CISO**  | `adminClient` (service_role) usado em Server Actions sem `requireRole`/`requirePermission`; CSRF ausente em rotas mutáveis; webhook HMAC não constant-time; open-redirect em `callbackUrl` | Introduzir `requirePermission()`; CSRF double-submit; `timingSafeEqual`; allowlist de redirect                  |
| **2 CTO**   | `createOrder`, `applyCoupon`, `confirmPayment` com janelas TOCTOU (check-then-act em múltiplas queries); ausência de `FOR UPDATE`                                                          | RPCs atômicas (`108_create_order_atomic.sql` + `apply_coupon_atomic`, `confirm_payment_atomic`); `lock_version` |
| **3 CFO**   | `Number` JS + `numeric(10,2)` → drift em comissão/desconto; overflow em R$ 100M; split sem garantia de conservação                                                                         | `core/money/money.ts` branded `Cents`; `*_cents bigint`; property-tests de invariantes                          |
| **4 CLO**   | PII (`phone`, `crm`, `form_data`) parcialmente em plaintext em tabelas legadas; consentimento LGPD sem audit trail versionado; DPA versioning ausente                                      | Completar migração PII; `consent_events` versionados por política; contract versioning com hash                 |
| **12 Jobs** | Crons sem single-flight → execuções concorrentes; webhook Clicksign pode duplicar contrato; Inngest retry sem `idempotency_key` consistente                                                | `pg_try_advisory_xact_lock`; `webhook_events(idempotency_key UNIQUE)`; retry policies revisadas                 |

### 🟠 ALTOS (corrigir antes do 1º cliente enterprise)

| Lente             | Finding-chave                                                                                                                      | Correção canônica                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **5 CPO**         | Regras de prescrição têm edge cases (Model A vs B) não cobertos; snapshotting incompleto em mudança de preço durante pedido aberto | `core/products/prescription-requirement.ts`; `order_items.unit_price_cents` como snapshot imutável |
| **6 COO**         | SLAs calculados em app (sem timezone em BD); auto-escalação sem 4-eyes para tickets críticos                                       | `sla_configs` com tz; `104_four_eyes_approvals.sql`                                                |
| **7 CXO**         | Sem axe-core na CI; contraste AA falhando em estados `disabled`; formulários sem `aria-describedby`                                | `tests/e2e/dashboard.a11y.test.ts` + correções específicas                                         |
| **8 CDO**         | FKs sem `ON DELETE` explícito; `numeric(10,2)` global; soft-delete inconsistente (`is_active`/`status`/`deleted_at`)               | `106_schema_hardening.sql`                                                                         |
| **9 CRO**         | Sem `fraud_signals`; self-dealing (clínica cria farmácia dela mesma) não detectado; velocity-check ausente                         | `fraud_signals` table + cron de score                                                              |
| **10 CSO**        | N+1 em dashboards (9+ round-trips por página); sem embedded selects; sem materialized views                                        | `lib/db/cached-queries.ts`; RPCs abrangentes; `mv_pharmacy_daily_metrics`                          |
| **11 Supply**     | Sem SBOM; `npm audit` só manual; sem Dependabot; `gitleaks` ausente                                                                | `ci.yml:security-scan` (CodeQL + Gitleaks + Trivy); CycloneDX SBOM; Dependabot                     |
| **13 Middleware** | `/admin` sem IP allowlist em produção; cookie `SameSite=Lax` (deveria ser `Strict` em admin)                                       | `middleware.ts` atualizado com allowlist                                                           |
| **14 Contratos**  | Sem versioning do template de contrato; sem hash do PDF arquivado                                                                  | Template versioning + SHA-256 do PDF final em `contracts.pdf_hash`                                 |
| **16 CAO**        | `requireRole` grosseiro; impersonation inexistente; sem 4-eyes para SUPER_ADMIN                                                    | `101–104.sql` + módulos RBAC                                                                       |
| **19 DBA**        | FK indexes ausentes; sem particionamento; autovacuum default; sem timeouts por role; sem backup offsite                            | `106–110.sql` + `offsite-backup.yml` + `restore-drill.yml`                                         |
| **20 SRE**        | Health check raso (não testa Asaas/Clicksign/Resend); sem métricas de negócio; sem runbooks; sem status page                       | `/api/health/{live,ready,deep}`; `lib/metrics.ts`; `docs/runbooks/`; `app/status/`                 |

### 🟡 MÉDIOS (próximos 60–90 dias)

| Lente        | Finding-chave                                                                                              | Correção canônica                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **15 CMO**   | Sem List-Unsubscribe; sem digest/quiet hours; XSS latente em templates HTML                                | Templates com sanitização; `List-Unsubscribe-Post`; preferências de frequência               |
| **17 VPE**   | Coverage fragmentado; sem property/mutation/contract tests; `tests/setup.ts` com mocks globais de negócio  | `vitest.config.ts` com projetos `unit`/`integration`; `fast-check`; `stryker`; contratos Zod |
| **18 Staff** | `services/` direto no Supabase (acoplamento); sem ports/adapters; sem rich domain model; sem feature flags | Hexagonal (`core/`, `adapters/`); `lib/features/`; API versioning                            |

---

## Lentes: entregáveis detalhados

### Lente 1 — CISO: Attack surface (35 sub-itens)

**Áreas cobertas:** RLS bypass, service-role leaks, CSRF, open-redirect, webhook HMAC, SSRF, XSS (CSP/HTML), SQLi, path traversal, secret scanning, session fixation, clickjacking, MIME sniffing, HSTS, CORS, origin validation, auth bypass, IDOR, rate-limit bypass, password reset tokens, MFA gaps, device fingerprinting, file upload validation, signed URLs expiration, DoS (zip bombs, large JSON), prototype pollution, regex DoS, CSV injection, XML XXE, SSRF em OCR, timing attacks em login, enum oracle, error message leaks, response header leaks.

**Entregáveis:**

- `lib/security/csrf.ts` (double-submit token), aplicado em mutating routes via middleware
- `lib/security/hmac.ts` (wrapper `timingSafeEqual` para Asaas/Clicksign/Inngest)
- `lib/security/redirect.ts` (allowlist + parsing para `callbackUrl`)
- `next.config.ts` com `Content-Security-Policy` stricter e `permissions-policy`
- `middleware.ts` com Origin/Referer validation em POST
- Rate-limit estendido (`lib/rate-limit.ts`) para rotas sensíveis (login, reset, webhook)
- `tests/e2e/security.spec.ts` cobrindo IDOR, CSRF, open-redirect

### Lente 2 — CTO: Arquitetura & race conditions (10 sub-itens)

**Áreas cobertas:** TOCTOU em createOrder, applyCoupon, confirmPayment, assignUserRole, updateProductPrice; concorrência em triggers; uso de `maybeSingle` onde deveria ser `FOR UPDATE`; `updated_at` em triggers; checkpoints em Inngest; idempotency keys.

**Entregáveis:**

- `108_create_order_atomic.sql` (já especificada)
- `supabase/migrations/109_apply_coupon_atomic.sql` (RPC com `FOR UPDATE`)
- `supabase/migrations/110_confirm_payment_atomic.sql` (RPC com `FOR UPDATE`)
- `lock_version` em `106_schema_hardening.sql`
- Webhooks com `webhook_events(idempotency_key UNIQUE)` — bloqueio dedupe

### Lente 3 — CFO: Money integrity (10 sub-itens)

**Áreas cobertas:** arredondamento (banker's vs default), reconciliação pagamento↔pedido, split de comissão, desconto por cupom, câmbio (futuro), impostos, refund/estorno parcial, hold/capture, auditoria de `adjustments`.

**Entregáveis:**

- `core/money/money.ts` (branded `Cents`, funções puras)
- Colunas `*_cents bigint` via `106_schema_hardening.sql`
- `tests/unit/services/money.property.test.ts` (invariantes)
- RPC `create_order_atomic` conservando R$ em `sum(order_items.subtotal) = order.total`

### Lente 4 — CLO: LGPD & contratual (8 sub-itens)

**Áreas cobertas:** Art. 7/11/18 LGPD (base legal, dados sensíveis, direitos do titular); DPA versioning; re-aceite em mudança material; registro RIPD por finalidade; retenção (`lib/retention-policy.ts`).

**Entregáveis:**

- `consent_events` table (versionada por `policy_version`)
- `contract_templates(version, hash, effective_at)` + `contracts.template_version_id`
- `docs/legal/dpa-*.md` revisado por advogado (pendência)
- `app/(private)/profile/privacy/page.tsx` com re-aceite forçado quando nova versão

### Lente 5 — CPO: Product edge cases (10 sub-itens)

**Áreas cobertas:** preço muda durante pedido aberto; inventário sem reserva; `requires_prescription` vs. `max_units_per_prescription`; SKU collision; variantes; produtos arquivados em pedidos legados; recomendações sem diversidade; catálogo com farmácia inativa.

**Entregáveis:**

- `order_items.unit_price_cents` como snapshot imutável
- `lib/products/reserve.ts` + `inventory_reservations` (opcional)
- `PrescriptionRequirement` value object (`core/products/prescription-requirement.ts`)
- `product_associations` com MMR (diversidade) no cron

### Lente 6 — COO: Operational flows (8 sub-itens)

**Áreas cobertas:** SLA sem timezone BRT; auto-escalação; aprovação 4-eyes; delivery proof; email templates; refund workflow; CNPJ revalidation schedule; document expiration.

**Entregáveis:**

- `104_four_eyes_approvals.sql` + `lib/rbac/four-eyes.ts`
- `sla_configs` com `tz text NOT NULL DEFAULT 'America/Sao_Paulo'`
- `tracking.delivery_photo_storage_path` (obrigatório em `DELIVERED`)

### Lente 7 — CXO: UX/A11y/frontend (10 sub-itens)

**Áreas cobertas:** contraste WCAG AA em estados `disabled`/`hover`; navegação por teclado em dialogs; `aria-live` em toasts; `prefers-reduced-motion`; lazy loading de imagens; optimistic UI com rollback; pagination infinita com histórico; formulários sem `aria-describedby`; uploads drag-and-drop com keyboard fallback; i18n BR (pt-BR) consistency.

**Entregáveis:**

- `tests/e2e/dashboard.a11y.test.ts` (axe-core)
- `components/ui/toast.tsx` com `role="status"`
- Audit em Tailwind tokens com `@tailwindcss/forms` para contrast-aware

### Lente 8 — CDO: Data integrity & migrações (6 sub-itens)

**Áreas cobertas:** precisão numeric; `ON DELETE` explícito; soft-delete unificado; `updated_at` triggers universais; `SECURITY DEFINER` com `SET search_path`; CI com `supabase db diff`.

**Entregáveis:**

- `106_schema_hardening.sql` completa
- `.github/workflows/ci.yml:db-tests` com `supabase gen types` diff check
- `squawk` lint em migrations

### Lente 9 — CRO: Business model & fraude (6 sub-itens)

**Áreas cobertas:** self-dealing (clínica + farmácia com mesmo beneficiário); cupom stacking; velocity-check de pedidos; uso anômalo de cupom; refund churning; impersonation malicioso de SALES_CONSULTANT.

**Entregáveis:**

- `fraud_signals` table com ledger de sinais
- `lib/fraud/score.ts` com regras declarativas
- Cron diário computando score por clínica/farmácia

### Lente 10 — CSO: Scalability (5 sub-itens)

**Áreas cobertas:** N+1 em dashboards; paginação offset (slow); realtime fan-out; connection pool; pré-cache de estatísticas.

**Entregáveis:**

- Embedded selects PostgREST em listagens (Lente 19.3)
- Cursor pagination em `/api/export` e listagens grandes
- `mv_pharmacy_daily_metrics` + refresh noturno
- Realtime restrito a canais por-entidade (evitar global channels)

### Lente 11 — Supply chain (5 sub-itens)

**Áreas cobertas:** SBOM; CVE scanning; Dependabot; `npm ci --ignore-scripts`; secret scanning; Node version pinning.

**Entregáveis:**

- `.github/workflows/ci.yml:security-scan` (CodeQL + Gitleaks + Trivy + npm audit)
- `.github/dependabot.yml` (npm + actions)
- SBOM CycloneDX gerado em CI e anexado ao release
- `.nvmrc` + `engines` em `package.json`

### Lente 12 — Cron & Inngest (18 sub-itens)

**Áreas cobertas:** single-flight locking, concurrency limits, maxDuration, runtime='nodejs', idempotency, dead-letter, retry policies, cron drift, time-window correctness (tz), partial failure handling, notification dedup, log retention, purge cadence, probe de integrações, alerting em falhas, cron run history table, replay mode, manual run button.

**Entregáveis:**

- `lib/cron/auth.ts:runCronGuarded` já existente, **estender** para:
  - `pg_try_advisory_xact_lock(hashtext(name))` (single-flight)
  - Escrita em `cron_runs` com duração, status, erro
  - Retry automático com backoff exponencial
- `webhook_events(idempotency_key UNIQUE, received_at)` + dedup em Asaas/Clicksign/Inngest
- Cron de integridade de integrações (`external-contract-probe`)

### Lente 13 — Middleware / sessão / auth (5 sub-itens)

**Áreas cobertas:** cookie flags (`HttpOnly`, `Secure`, `SameSite`); CSRF cross-site; IP allowlist admin; MFA enrollment; session rotation após mudança de role.

**Entregáveis:**

- `middleware.ts` com `ADMIN_IP_ALLOWLIST` env
- `lib/security/csrf.ts` (already referenced)
- `lib/auth/mfa.ts` (TOTP) — módulo novo
- Session rotation em `assignUserRole`

### Lente 14 — Contratos & ops compliance (4 sub-itens)

**Áreas cobertas:** template versioning; PDF hash archival; signature webhook idempotency; retenção legal (CFM, ANVISA).

**Entregáveis:**

- `contract_templates` + `contracts.pdf_hash text`
- Clicksign webhook com `idempotency_key` (Lente 12)

### Lente 15 — CMO: Comms & retenção (4 sub-itens)

**Áreas cobertas:** email deliverability (DMARC/SPF/DKIM OK; List-Unsubscribe-Post ausente); push privacy; digest/quiet hours; XSS em templates.

**Entregáveis:**

- `lib/email/templates/*.tsx` com React Email (already in use) + sanitização explícita
- `List-Unsubscribe` + `List-Unsubscribe-Post` headers
- `notification_preferences` estender com `quiet_hours_start/end`, `digest_frequency`

### Lente 16 — CAO: Gestão interna (4 sub-itens)

**Áreas cobertas:** RBAC granular; impersonation controlada; audit immutável com hash chain; 4-eyes para ações críticas.

**Entregáveis:** `101–104.sql` + todos os módulos referenciados na Parte 21 da auditoria.

### Lente 17 — VPE: Code quality & tests (8 sub-itens)

**Áreas cobertas:** unit/integration split; coverage per-file; property testing; mutation testing; contract testing; E2E sharded; a11y automatizada; lint rules.

**Entregáveis:** `vitest.config.ts` revisado; `playwright.config.ts` revisado; `eslint.config.mjs`; `commitlint.config.js`; `stryker.conf.json`; `tests/integration/**`.

### Lente 18 — Staff/Principal: Patterns (6 sub-itens)

**Áreas cobertas:** hexagonal arch; rich domain model; feature flags; API versioning; outbound webhooks; event bus.

**Entregáveis:** `core/`, `adapters/`, `lib/features/`, `app/api/v1/openapi/`, `lib/api/deprecation.ts`.

### Lente 19 — DBA: Schema & performance (6 sub-itens)

**Áreas cobertas:** tipos (money, enums, UUIDv7); índices (FK, partial, covering, BRIN); N+1; particionamento + fillfactor + autovacuum; pool & timeouts; backups offsite + restore drill.

**Entregáveis:** `106–110.sql`; `offsite-backup.yml`; `restore-drill.yml`; `docs/disaster-recovery.md` atualizado.

### Lente 20 — SRE: Observability & recovery (7 sub-itens)

**Áreas cobertas:** métricas de negócio; logs (redação PII + correlação); traces OTEL completos; SLOs & error budgets; health live/ready/deep; incident response + chaos; synthetic + RUM + status page.

**Entregáveis:** `lib/metrics.ts`; `lib/logger.ts` revisado; `instrumentation.ts`; `lib/slo/burn-rate.ts`; `app/api/health/{live,ready,deep}/`; `docs/runbooks/`; `app/status/`; `synthetic-monitor.yml`.

---

## Rastreabilidade de correções

Cada migration/módulo entregue tem rastreabilidade cruzada com a lente que o originou. Quando um item desta auditoria é **cancelado** (ex.: assumido como risco aceito), registrar em `docs/known-limitations.md` com justificativa datada.

---

_Última atualização: 2026-04-17_
