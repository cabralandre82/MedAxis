# Catálogo de Métricas

**Versão:** 1.0
**Data:** 2026-04-18
**Owner:** SRE + Eng Lead
**Próxima revisão:** a cada inclusão/renomeação de métrica
**Cobertura SOC 2:** CC4.1 (monitoring activities), CC7.1 (anomaly detection)

> Este documento é o **catálogo legível por humanos** de todas as
> métricas exportadas pela aplicação no endpoint `/api/metrics`. A
> fonte de verdade técnica é o objeto `Metrics` em
> [`lib/metrics.ts`](../../lib/metrics.ts), e a fonte de verdade dos
> "buckets" de rate-limit é o objeto `Bucket` em
> [`lib/rate-limit.ts`](../../lib/rate-limit.ts). O teste em
> [`tests/unit/lib/metrics-catalog.test.ts`](../../tests/unit/lib/metrics-catalog.test.ts)
> impede drift entre código e doc.

---

## 1. Visão geral

| Aspecto           | Valor                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Endpoint**      | `GET /api/metrics`                                                                                                       |
| **Auth**          | `Authorization: Bearer ${METRICS_SECRET}` ou `?token=${METRICS_SECRET}`                                                  |
| **Formatos**      | `text/plain; version=0.0.4` (Prometheus, default) ou `?format=json`                                                      |
| **Runtime**       | Node.js (não-Edge — usa registry in-process)                                                                             |
| **Cardinalidade** | Bounded no emit site (rotas, buckets, severidades). Scrape típico < 50 KB / < 5 ms                                       |
| **NÃO exposto**   | Identificadores pessoais (PII). Apenas hashes (`ip_hash`) ou contadores agregados                                        |
| **Granularidade** | Snapshot por instância serverless. Múltiplas instâncias warm coexistem; o agregador (Grafana / Prom federado) faz a soma |

---

## 2. Esquema de naming

Todas as métricas seguem convenção Prometheus:

- `snake_case`
- Sufixos canônicos: `_total` (counter), `_ms` (histograma de duração), `_seconds`, `_count`, `_bytes`, `_ts` (timestamp Unix)
- Labels com vocabulário pequeno (≤ 10 valores distintos por label)

Não-exemplos (proibidos):

- `userId` em label (PII)
- `error_message` em label (cardinalidade explosiva)
- `requestId` em label (cardinalidade infinita)

---

## 3. Catálogo por domínio

### 3.1 HTTP e infraestrutura

| Métrica                     | Tipo      | Labels                            | Descrição                                                                                                                                                        | Dashboard       |
| --------------------------- | --------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `http_request_total`        | counter   | `route`, `method`, `status_class` | Total de requests servidos por rota canônica                                                                                                                     | platform-health |
| `http_request_duration_ms`  | histogram | `route`, `method`                 | Latência ponta-a-ponta por rota (p50/p95/p99)                                                                                                                    | platform-health |
| `http_outbound_total`       | counter   | `provider`, `outcome`             | Calls a APIs externas (Asaas, Resend, OpenAI)                                                                                                                    | platform-health |
| `http_outbound_duration_ms` | histogram | `provider`                        | Latência de calls externas                                                                                                                                       | platform-health |
| `health_check_duration_ms`  | histogram | `check`                           | Tempo de cada check no `/api/health/deep`                                                                                                                        | platform-health |
| `status_summary_total`      | counter   | `source`, `degraded`              | Hits no endpoint público `/api/status/summary` (Wave Hardening II #7) — `source` é `internal` ou `grafana-cloud`, `degraded` reflete a flag do payload retornado | platform-health |
| `circuit_breaker_state`     | gauge     | `provider`                        | 0=closed, 1=half_open, 2=open                                                                                                                                    | platform-health |
| `metrics_scrape_total`      | counter   | `outcome`, `format`               | Auto-observação do scrape                                                                                                                                        | platform-health |

### 3.2 Segurança e autenticação

| Métrica                        | Tipo      | Labels                                     | Descrição                                                                                                                                                                                                                                                                                                                                                                      | Dashboard |
| ------------------------------ | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `csrf_blocked_total`           | counter   | `route`                                    | Requests rejeitados por CSRF                                                                                                                                                                                                                                                                                                                                                   | security  |
| `csp_violation_total`          | counter   | `directive`, `blocked_host`, `disposition` | Cada relatório do navegador em `/api/csp-report`. `directive` é o `effective-directive` (`script-src`, `style-src-elem`, …). `blocked_host` é o host de origem do recurso bloqueado, ou um keyword (`inline`, `eval`, `data`, `blob`) — cardinalidade limitada por design. `disposition` distingue `enforce` de `report` para suportar rollouts canário (Wave Hardening II #8) | security  |
| `csp_report_invalid_total`     | counter   | `reason`                                   | Relatórios CSP descartados por payload inválido (`json_parse`, `unknown_shape`, `empty_array`, `body_too_large`, `body_read_error`). Picos sustentados sugerem abuso ou bug em browser exótico                                                                                                                                                                                 | security  |
| `rbac_denied_total`            | counter   | `permission`, `actor_role`                 | Verificações RBAC negadas                                                                                                                                                                                                                                                                                                                                                      | security  |
| `rbac_rpc_errors_total`        | counter   | `permission`                               | Erros transitórios na RPC de RBAC                                                                                                                                                                                                                                                                                                                                              | security  |
| `turnstile_verify_total`       | counter   | `outcome`                                  | Verificações Cloudflare Turnstile                                                                                                                                                                                                                                                                                                                                              | security  |
| `turnstile_verify_duration_ms` | histogram | (sem labels)                               | Latência da verificação                                                                                                                                                                                                                                                                                                                                                        | security  |

### 3.3 Rate limiting (foco da Wave Hardening II #6)

| Métrica                           | Tipo      | Labels              | Descrição                                                                                     | Dashboard |
| --------------------------------- | --------- | ------------------- | --------------------------------------------------------------------------------------------- | --------- |
| `rate_limit_hits_total`           | counter   | `bucket`, `outcome` | Toda checagem (`outcome=allowed\|denied\|error`)                                              | security  |
| `rate_limit_denied_total`         | counter   | `bucket`            | Subset de hits que foram negados (deriva-se de hits, mas exposto à parte para PromQL simples) | security  |
| `rate_limit_check_duration_ms`    | histogram | `bucket`            | Latência da checagem (Redis vs in-memory)                                                     | security  |
| `rate_limit_suspicious_ips_total` | counter   | `severity`          | IPs distintos no relatório horário; emitido pelo cron `rate-limit-report`                     | security  |

**Buckets canônicos** (use sempre as constantes em `Bucket.*` — nunca strings literais):

| Constante                   | Valor                       | Janela / limite | Uso                               |
| --------------------------- | --------------------------- | --------------- | --------------------------------- |
| `Bucket.AUTH_LOGIN`         | `auth.login`                | 5 / min         | POST /api/auth/login              |
| `Bucket.AUTH_FORGOT`        | `auth.forgot_password`      | 5 / min         | POST /api/auth/forgot             |
| `Bucket.AUTH_SIGNUP`        | `auth.signup`               | 5 / min         | POST /api/auth/signup             |
| `Bucket.REGISTER_SUBMIT`    | `register.submit`           | 3 / 10 min      | POST /api/registrations           |
| `Bucket.REGISTER_DRAFT`     | `register.draft`            | 60 / min        | PATCH em rascunho                 |
| `Bucket.LGPD_DELETION`      | `lgpd.deletion_request`     | 3 / hora        | Solicitação de eliminação         |
| `Bucket.LGPD_EXPORT`        | `lgpd.export`               | 5 / hora        | Export de dados (LGPD art. 18, V) |
| `Bucket.LGPD_RECTIFICATION` | `lgpd.rectification`        | 3 / hora        | Solicitação de correção           |
| `Bucket.COUPON_ACTIVATE`    | `coupon.activate`           | 60 / min        | Ativação de cupom                 |
| `Bucket.ORDER_PRESCRIPTION` | `order.prescription_upload` | 10 / min        | Upload de receita                 |
| `Bucket.DOCUMENT_UPLOAD`    | `document.upload`           | 10 / min        | Upload genérico                   |
| `Bucket.EXPORT_GENERIC`     | `export.generic`            | 10 / min        | CSV/PDF de relatório              |

> A taxa de denials esperada em operação saudável é `< 1% / 1h` para
> buckets de uso geral e `< 5% / 1h` para auth (forçando MFA + reset).
> Acima disso, ver alert rule `RateLimitHighDenyRate` (§6).

### 3.4 Cron e jobs

| Métrica                       | Tipo      | Labels          | Descrição                                                                                                                                                                             | Dashboard       |
| ----------------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `cron_run_total`              | counter   | `job`, `status` | Cada execução de cron (`status=success\|failed\|skipped_locked`)                                                                                                                      | platform-health |
| `cron_duration_ms`            | histogram | `job`           | Tempo de cada cron                                                                                                                                                                    | platform-health |
| `cron_last_success_ts`        | gauge     | `job`           | Timestamp Unix da última execução bem-sucedida (alvo: < 26 h para crons diários)                                                                                                      | platform-health |
| `payment_reminder_sent_total` | counter   | `kind`          | Lembretes de pagamento (boleto/PIX) enviados pelo cron `payment-reminders`. `kind` ∈ `D_MINUS_3\|D_MINUS_1\|D_DAY\|OVERDUE`. Substituiu os e-mails Asaas (silenciados em 2026-04-29). | platform-health |

### 3.5 Atomic RPCs (transações de domínio)

| Métrica                                       | Tipo      | Labels                  | Descrição                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atomic_rpc_total`                            | counter   | `name`, `outcome`       | Calls a RPCs SECURITY DEFINER de domínio                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `atomic_rpc_duration_ms`                      | histogram | `name`                  | Latência da RPC                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `atomic_rpc_fallback_total`                   | counter   | `name`                  | Vezes que caímos no fallback application-level                                                                                                                                                                                                                                                                                                                                                                                                            |
| `webhook_ledger_total`                        | counter   | `outcome`               | Pre-Launch S1 / F1 — confirma ledger via webhook Asaas. `outcome` ∈ {`confirmed`, `skipped_all_processed`, `skipped_already_processed`, `skipped_stale_version`, `error_no_payment`, `error_fetch_failed`, `error_rpc_failed`}. `error_*` warrants imediato — pode indicar checkout race ou RPC quebrada                                                                                                                                                  |
| `webhook_ledger_duration_ms`                  | histogram | (sem labels)            | Latência da rotina de confirmação de ledger via webhook (alvo: p95 < 500ms)                                                                                                                                                                                                                                                                                                                                                                               |
| `asaas_reconcile_total`                       | counter   | `outcome`               | Pre-Launch S1 / F5 — cron reconcile vs Asaas. `outcome` ∈ {`scanned`, `reconciled`, `gateway_pending`, `gateway_lost`, `error_query_failed`, `error_gateway_unavailable`, `error_local_advance`}. Steady-state: `scanned > 0`, `reconciled = 0` (webhook OK). `reconciled > 0` é sinal de webhook miss — investigar                                                                                                                                       |
| `asaas_reconcile_recovered_total`             | counter   | (sem labels)            | Convenience counter = `asaas_reconcile_total{outcome=reconciled}`. Usado pelo alerta `AsaasReconcileRecoveredHigh`                                                                                                                                                                                                                                                                                                                                        |
| `asaas_reconcile_duration_ms`                 | histogram | (sem labels)            | Latência completa do cron reconcile (alvo: p95 < 30 s para 50 payments/run)                                                                                                                                                                                                                                                                                                                                                                               |
| `asaas_reconcile_last_run_ts`                 | gauge     | (sem labels)            | Unix epoch da última execução; usado pelo alerta `AsaasReconcileStale` (sem run há > 60 min ⇒ warning)                                                                                                                                                                                                                                                                                                                                                    |
| `grafana_push_total`                          | counter   | `outcome`               | Pre-Launch S1 / T6 — push de métricas para Grafana Cloud Prometheus remote_write. `outcome` ∈ {`success`, `error`, `skipped_no_env`, `skipped_empty`}. `error > 0 (5m)` warning; `error > 5 (5m)` critical (auth ou Grafana Cloud down)                                                                                                                                                                                                                   |
| `grafana_push_timeseries_count`               | gauge     | (sem labels)            | Total de timeseries enviadas no último push. Esperado: 100-500 séries (counter+gauge unique combos + 5×histogramas). Se cair pra 0 sustentado, registry está vazio (cold start prolongado) ou bug                                                                                                                                                                                                                                                         |
| `grafana_push_duration_ms`                    | histogram | `outcome`               | Latência completa do push (snapshot + protobuf + snappy + HTTP). Alvo: p95 < 2 s. Dispara `GrafanaPushSlow` se > 5 s sustentado                                                                                                                                                                                                                                                                                                                           |
| `grafana_push_last_run_ts`                    | gauge     | (sem labels)            | Unix epoch da última execução do cron `grafana-push`; alerta `GrafanaPushStale` se sem run há > 5 min (cron deveria rodar a cada 60 s)                                                                                                                                                                                                                                                                                                                    |
| `ocr_extraction_total`                        | counter   | `outcome`               | Pre-Launch S1 / T8 — distribuição de outcomes do OCR (`lib/ai.ts::extractDocumentData`). `outcome` ∈ {`high`, `medium`, `low`, `prompt_injection_suspected`, `invalid_response`, `error`}. Steady-state: maioria `high`/`medium`. Spike em `prompt_injection_suspected` = ataque ativo no onboarding (P2). Spike em `invalid_response` = modelo OpenAI mudou shape (rever prompt). Queda > 10 % em `high` após mudança de prompt = regressão de qualidade |
| `clicksign_webhook_total`                     | counter   | `outcome`               | Pre-Launch S2 / T4 — instrumentação do handler `app/api/contracts/webhook`. `outcome` ∈ {`hmac_verified`, `hmac_dev_bypass`, `hmac_failed`, `parse_error`, `processed`, `processed_skipped`, `duplicate`, `error`}. Steady-state em prod: `hmac_verified` domina; `hmac_dev_bypass = 0` (qualquer valor > 0 = `CLICKSIGN_WEBHOOK_SECRET` caiu — P2); `hmac_failed > 5/h` sustentado = ataque ou config drift (P2)                                         |
| `clicksign_webhook_received_count_24h`        | gauge     | (sem labels)            | Pre-Launch S2 / T4 — populado pelo cron `clicksign-webhook-watch` (15-min cadence). Volume de deliveries Clicksign nas últimas 24h. Combinado com `clicksign_pending_contracts_aged > 0` é o sinal forte de canal silencioso                                                                                                                                                                                                                              |
| `clicksign_webhook_received_count_7d`         | gauge     | (sem labels)            | Volume nos últimos 7 dias — usado para baseline manual (não há alerta automático ainda; ROI baixo em pre-launch)                                                                                                                                                                                                                                                                                                                                          |
| `clicksign_webhook_last_received_age_seconds` | gauge     | (sem labels)            | Idade em segundos do último delivery Clicksign na tabela `webhook_events`. Sentinel: `-1` quando nunca houve delivery (distingue de `0` = acabou de chegar). Usado pelo alerta `ClicksignWebhookSilent`                                                                                                                                                                                                                                                   |
| `clicksign_pending_contracts_aged`            | gauge     | (sem labels)            | Quantidade de contratos com `status ∈ {SENT, VIEWED}` aguardando assinatura há > 6h. É o gatilho contra-baseline do alerta `ClicksignWebhookSilent` — sem isso, "0 webhooks 24h" em pre-launch seria normal e geraria falso positivo                                                                                                                                                                                                                      |
| `clicksign_pending_contracts_total`           | gauge     | (sem labels)            | Total de contratos em `status ∈ {SENT, VIEWED}` (não apenas envelhecidos). Usado para distinguir "fluxo silente sem volume" (zero) de "fluxo silente com volume" (> 0)                                                                                                                                                                                                                                                                                    |
| `clicksign_watch_last_run_ts`                 | gauge     | (sem labels)            | Unix epoch da última execução do cron `clicksign-webhook-watch`. Alerta `ClicksignWatchStale` se sem run há > 30 min (cron deveria rodar a cada 15 min)                                                                                                                                                                                                                                                                                                   |
| `orders_created_total`                        | counter   | `outcome`, `buyer_type` | Emitido por `createOrderAtomic` — base do SLO-01 (checkout end-to-end)                                                                                                                                                                                                                                                                                                                                                                                    |
| `audit_chain_verify_total`                    | counter   | `outcome`               | Cada verificação noturna da hash chain (`outcome=ok\|tampered`)                                                                                                                                                                                                                                                                                                                                                                                           |
| `audit_chain_break_total`                     | counter   | (sem labels)            | Linhas inconsistentes detectadas no `verify-audit-chain` (CRITICAL — paginar)                                                                                                                                                                                                                                                                                                                                                                             |
| `audit_chain_last_verify_ts`                  | gauge     | (sem labels)            | Timestamp Unix da última verificação concluída                                                                                                                                                                                                                                                                                                                                                                                                            |

### 3.6 Webhooks e idempotência

| Métrica                   | Tipo    | Labels                | Descrição                                                                                                                                                                                          |
| ------------------------- | ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook_claim_total`     | counter | `provider`, `outcome` | Claim do dedup-key na tabela `webhook_events`                                                                                                                                                      |
| `webhook_duplicate_total` | counter | `provider`            | Duplicates detectados (idempotência funcionando)                                                                                                                                                   |
| `sms_status_event_total`  | counter | `channel`, `status`   | Evento de delivery-status recebido no webhook Zenvia (`app/api/notifications/zenvia`). `channel=sms`, `status` ∈ `SENT\|DELIVERED\|NOT_DELIVERED\|REJECTED\|...`. Base para SLO de entrega de SMS. |

### 3.7 Conciliação financeira

| Métrica                                   | Tipo      | Labels       | Descrição                                                                                            | Dashboard      |
| ----------------------------------------- | --------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------------- |
| `money_drift_total`                       | counter   | `entity`     | Diferenças encontradas na reconciliação                                                              | money-and-dsar |
| `money_reconcile_duration_ms`             | histogram | (sem labels) | Latência do cron de reconciliação                                                                    | money-and-dsar |
| `money_reconcile_last_run_ts`             | gauge     | (sem labels) | Timestamp Unix da última execução                                                                    | money-and-dsar |
| `platform_revenue_recon_duration_ms`      | histogram | (sem labels) | Latência do cron `reconcile-platform-revenue` (varredura da view `platform_revenue_view`)            | money-and-dsar |
| `platform_revenue_recon_last_run_ts`      | gauge     | (sem labels) | Timestamp Unix da última execução do cron de reconciliação                                           | money-and-dsar |
| `platform_revenue_recon_gap_total`        | counter   | `severity`   | Pedidos com `\|recon_gap\| ≥ threshold` encontrados na varredura. Steady-state = 0; > 0 abre runbook | money-and-dsar |
| `platform_revenue_recon_gap_amount_cents` | gauge     | (sem labels) | Soma absoluta do gap em centavos no último run; ajuda dimensionar exposição financeira               | money-and-dsar |

### 3.7.1 Pricing engine (PR-E de ADR-001)

Observabilidade do motor de preços por tier (`compute_unit_price`,
RPC `/api/pricing/preview`, cron `pricing-health-check`). Os
contadores `*_cap_total` mostram quantas vezes os invariantes INV-2
(coupon discount cap) e INV-4 (consultor ≤ plataforma) foram
acionados — sinal operacional de que algum profile / cupom está
batendo na borda da margem mínima.

| Métrica                           | Tipo      | Labels                           | Descrição                                                                                                                                                                                                   | Dashboard      |
| --------------------------------- | --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `pricing_preview_total`           | counter   | `outcome`, `has_coupon`, `actor` | Cada chamada a `/api/pricing/preview`. `outcome` ∈ `success\|no_active_profile\|no_tier_for_quantity\|invalid_quantity\|rpc_unavailable\|rate_limited\|unauthorized\|bad_request`. `actor` ∈ `admin\|buyer` | money-and-dsar |
| `pricing_preview_duration_ms`     | histogram | `outcome`                        | Latência fim-a-fim do `/api/pricing/preview` (auth + DB scope + RPC). Use p95/p99 para SLO do simulador                                                                                                     | money-and-dsar |
| `pricing_inv2_cap_total`          | counter   | `product_id`                     | Coupon clamping (INV-2) acionado num preview — o desconto teria empurrado a plataforma abaixo do floor; foi clampado. Sinal de cupom mais agressivo que a margem mínima                                     | money-and-dsar |
| `pricing_inv4_cap_total`          | counter   | `product_id`                     | Consultant clamping (INV-4) acionado — comissão do consultor teria excedido a receita unitária da plataforma; foi clampada para não ultrapassar                                                             | money-and-dsar |
| `pricing_profile_missing_total`   | counter   | `product_id`                     | Cada call a `/api/pricing/preview` que respondeu `no_active_profile`. Por-produto: cardinality limitada pelo catálogo. Roll-up para alerta no cron `pricing-health-check`                                   | money-and-dsar |
| `pricing_health_run_total`        | counter   | `outcome`                        | Cada execução do cron `pricing-health-check`. `outcome` ∈ `success\|missing_detected`                                                                                                                       | money-and-dsar |
| `pricing_health_last_success_ts`  | gauge     | (sem labels)                     | Timestamp Unix da última execução do cron `pricing-health-check`                                                                                                                                            | money-and-dsar |
| `pricing_health_profiles_missing` | gauge     | (sem labels)                     | Quantidade de produtos `pricing_mode='TIERED_PROFILE'` sem profile ativo na última varredura. Steady-state = 0                                                                                              | money-and-dsar |
| `pricing_health_duration_ms`      | histogram | (sem labels)                     | Latência do cron `pricing-health-check`                                                                                                                                                                     | money-and-dsar |

### 3.8 DSAR (LGPD art. 18)

| Métrica                       | Tipo      | Labels         | Descrição                                                                                             | Dashboard      |
| ----------------------------- | --------- | -------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| `dsar_opened_total`           | counter   | `kind`         | Solicitações abertas (`EXPORT` / `ERASURE` / `RECTIFICATION`)                                         | money-and-dsar |
| `dsar_duplicate_open_total`   | counter   | `kind`         | Tentativas de duplicata bloqueadas                                                                    | money-and-dsar |
| `dsar_transition_total`       | counter   | `to`           | Transições de estado da máquina DSAR (rotuladas pelo estado de destino)                               | money-and-dsar |
| `dsar_transition_error_total` | counter   | `reason`, `to` | Transições recusadas pelo RPC `dsar_transition()` (ex.: `invalid_transition`, `reject_code_required`) | money-and-dsar |
| `dsar_transition_duration_ms` | histogram | (sem labels)   | Latência do RPC `dsar_transition()`                                                                   | money-and-dsar |
| `dsar_sla_breach_total`       | counter   | `kind`         | DSAR que estourou o SLA de 15 dias                                                                    | money-and-dsar |
| `dsar_sla_warning_total`      | counter   | `kind`         | DSAR dentro da janela `DSAR_SLA_WARNING_DAYS` (default 3d) antes do SLA                               | money-and-dsar |
| `dsar_expired_total`          | counter   | `via`          | DSAR auto-expirados pelo cron (`via="cron"`) após 30d de graça                                        | money-and-dsar |

### 3.9 Backups e recuperação

| Métrica                         | Tipo      | Labels       | Descrição                                        |
| ------------------------------- | --------- | ------------ | ------------------------------------------------ |
| `backup_record_total`           | counter   | `outcome`    | Registros de backup processados                  |
| `backup_record_duration_ms`     | histogram | (sem labels) | Latência do registro                             |
| `backup_last_success_ts`        | gauge     | (sem labels) | Timestamp Unix do último backup bem-sucedido     |
| `backup_last_size_bytes`        | gauge     | (sem labels) | Tamanho do último backup                         |
| `backup_age_seconds`            | gauge     | (sem labels) | Idade do último backup (alvo: < 25 h)            |
| `backup_freshness_breach_total` | counter   | (sem labels) | Vezes que `backup_age_seconds` estourou o limite |
| `backup_chain_break_total`      | counter   | (sem labels) | Detecções de quebra na cadeia de hash            |
| `restore_drill_last_success_ts` | gauge     | (sem labels) | Timestamp do último DR drill bem-sucedido        |
| `restore_drill_age_seconds`     | gauge     | (sem labels) | Idade do último drill (alvo: < 180 d)            |

### 3.10 Legal hold (Wave 13)

| Métrica                          | Tipo    | Labels         | Descrição                                |
| -------------------------------- | ------- | -------------- | ---------------------------------------- |
| `legal_hold_apply_total`         | counter | `subject_type` | Holds aplicados                          |
| `legal_hold_release_total`       | counter | `subject_type` | Holds liberados                          |
| `legal_hold_active_count`        | gauge   | (sem labels)   | Holds ativos no momento                  |
| `legal_hold_blocked_purge_total` | counter | `cron`         | Linhas bloqueadas no `enforce-retention` |
| `legal_hold_blocked_dsar_total`  | counter | `kind`         | Operações DSAR bloqueadas por hold       |
| `legal_hold_expired_total`       | counter | (sem labels)   | Holds que expiraram automaticamente      |

### 3.11 RLS canary (Wave 14)

| Métrica                        | Tipo      | Labels       | Descrição                                 |
| ------------------------------ | --------- | ------------ | ----------------------------------------- |
| `rls_canary_runs_total`        | counter   | `outcome`    | Runs do canário                           |
| `rls_canary_violations_total`  | counter   | `table`      | Violações detectadas (CRITICAL — paginar) |
| `rls_canary_tables_checked`    | gauge     | (sem labels) | Tabelas verificadas no último run         |
| `rls_canary_last_success_ts`   | gauge     | (sem labels) | Timestamp do último run sem violação      |
| `rls_canary_last_violation_ts` | gauge     | (sem labels) | Timestamp da última violação              |
| `rls_canary_age_seconds`       | gauge     | (sem labels) | Idade do último canary (alvo: < 26 h)     |
| `rls_canary_duration_ms`       | histogram | (sem labels) | Tempo do canário                          |

### 3.12 Rotação de segredos (Wave 15 / Hardening II #4)

| Métrica                               | Tipo      | Labels            | Descrição                     |
| ------------------------------------- | --------- | ----------------- | ----------------------------- |
| `secret_rotation_runs_total`          | counter   | `outcome`, `tier` | Rotações executadas           |
| `secret_rotation_failures_total`      | counter   | `tier`, `secret`  | Falhas durante rotação        |
| `secret_rotation_overdue_count`       | gauge     | `tier`            | Segredos vencidos no momento  |
| `secret_rotation_never_rotated_count` | gauge     | `tier`            | Segredos sem ledger           |
| `secret_age_seconds`                  | gauge     | `name`, `tier`    | Idade de cada segredo         |
| `secret_oldest_age_seconds`           | gauge     | `tier`            | Idade do mais antigo por tier |
| `secret_rotation_duration_ms`         | histogram | `tier`            | Latência da rotação           |
| `secret_rotation_last_run_ts`         | gauge     | (sem labels)      | Última execução do cron       |

### 3.13 Chaos engineering (Wave Hardening II #9)

| Métrica                      | Tipo      | Labels                      | Descrição                                                                                                                                                                                                                                                                                               |
| ---------------------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chaos_injection_total`      | counter   | `kind`, `service`, `action` | Cada injeção realizada pelo chaos toolkit. `kind` ∈ {`outbound`, `db`, `redis`}; `service` é o nome do alvo (`asaas`, `orders`, …); `action` ∈ {`latency`, `latency_zero`, `error_network`, `error_timeout`}. Cardinalidade limitada por `CHAOS_TARGETS` (operador escolhe explicitamente o que armar). |
| `chaos_injection_latency_ms` | histogram | `kind`, `service`           | Distribuição dos atrasos sintéticos efetivamente aplicados. Útil para validar que o `CHAOS_LATENCY_MS_MIN/MAX` produziu a curva esperada durante o game-day.                                                                                                                                            |

Quando o chaos está desarmado (default), **nenhum** dos contadores acima é emitido — `chaosTick()` retorna em sub-microssegundos sem tocar no registro de métricas. Veja `docs/runbooks/chaos.md` para vocabulário completo de configuração e fluxo de game-day.

---

## 4. PromQL — receitas úteis

### 4.1 Taxa de erro HTTP por rota

```promql
sum by (route) (
  rate(http_request_total{status_class="5xx"}[5m])
)
/ clamp_min(sum by (route) (rate(http_request_total[5m])), 1e-9)
```

### 4.2 Latência p95 por rota

```promql
histogram_quantile(
  0.95,
  sum by (route, le) (rate(http_request_duration_ms_bucket[5m]))
)
```

> **Nota:** o registry atual emite p50/p95/p99 pré-calculados via
> `metricsText()` (ver §5), pois o reservatório por instância é
> bounded. Quando ativarmos um agregador externo (Mimir/Cortex)
> trocaremos para o `_bucket` nativo.

### 4.3 Deny rate de rate-limit por bucket (último 1h)

```promql
sum by (bucket) (rate(rate_limit_denied_total[1h]))
/ clamp_min(sum by (bucket) (rate(rate_limit_hits_total[1h])), 1e-9)
```

### 4.4 IPs suspeitos por severidade (15 min)

```promql
sum by (severity) (increase(rate_limit_suspicious_ips_total[15m]))
```

### 4.5 Backups frescos?

```promql
backup_age_seconds > 25 * 3600
```

### 4.6 DR drill recente?

```promql
restore_drill_age_seconds > 180 * 86400
```

---

## 5. Formato de exposição

A função `metricsText()` em `lib/metrics.ts` produz uma forma
**simplificada** do exposition format do Prometheus que serve dois
propósitos:

1. **Scrape direto por scraper compatível** (Vector, Grafana Agent,
   Cloudflare Logpush) — todos toleram a ausência das linhas `# HELP`
   e `# TYPE` desde que os nomes sigam o naming canônico.
2. **Inspeção humana via `curl`** — útil em incidentes.

Para histogramas, em vez do clássico `_bucket{le="..."}`, emitimos:

```
metric_count <count>
metric_sum   <sum>
metric_p50   <p50>
metric_p95   <p95>
metric_p99   <p99>
```

Isso é uma escolha consciente: o serverless do Vercel não permite
manter um reservatório significativo entre invocations, então
exportar buckets seria enganoso. Quando movermos para um agregador
externo, este shim será trocado pela exposição nativa
(`prom-client.collectDefaultMetrics` ou equivalente) sem mudar o
contrato dos painéis.

---

## 6. Alert rules

As regras de alerta vivem em
[`monitoring/prometheus/alerts.yml`](../../monitoring/prometheus/alerts.yml)
e são alinhadas a SLOs internos. Toda entrada dessa tabela é
verificada por [`scripts/claims/check-alert-coverage.mjs`](../../scripts/claims/check-alert-coverage.mjs),
que falha o CI se um alerta for renomeado sem atualizar a doc, se
um runbook citado não existir, ou se uma métrica "must-page"
(sufixo `_chain_break_total`, `_violations_total`, `_drift_total`,
`_breach_total`, `_tampered_total`) não tiver cobertura por regra.

### 6.1 Rate limit e abuso

| Alerta                           | Severidade | Trigger                                               | Runbook                             |
| -------------------------------- | ---------- | ----------------------------------------------------- | ----------------------------------- |
| `RateLimitHighDenyRate`          | warning    | `> 5%` deny rate em 1 bucket por 15 min               | `docs/runbooks/rate-limit-abuse.md` |
| `RateLimitSuspiciousIpsCritical` | critical   | `> 50` IPs em 15 min OU `> 5` buckets por IP          | `docs/runbooks/rate-limit-abuse.md` |
| `RateLimitSuspiciousIpsWarning`  | warning    | `>= 10` IPs em 15 min                                 | `docs/runbooks/rate-limit-abuse.md` |
| `RateLimitCheckSlow`             | warning    | p95 de `rate_limit_check_duration_ms` > 200ms por 10m | `docs/runbooks/rate-limit-abuse.md` |

### 6.2 Observability e pipeline de métricas

| Alerta                      | Severidade | Trigger                                              | Runbook                              |
| --------------------------- | ---------- | ---------------------------------------------------- | ------------------------------------ |
| `MetricsScrapeFailing`      | warning    | `metrics_scrape_total{outcome="ok"}` zero por 10 min | `docs/runbooks/secret-rotation.md`   |
| `MetricsScrapeUnauthorized` | warning    | `> 5` tentativas `outcome="unauthorized"` em 10 min  | `docs/runbooks/secret-compromise.md` |

### 6.3 HTTP e disponibilidade

| Alerta               | Severidade | Trigger                                               | Runbook                              |
| -------------------- | ---------- | ----------------------------------------------------- | ------------------------------------ |
| `HttpHighErrorRate`  | critical   | `> 5%` de 5xx por rota por 10 min                     | `docs/runbooks/incident-response.md` |
| `HttpLatencyP95High` | warning    | p95 de `http_request_duration_ms` > 1500ms por 15 min | `docs/runbooks/slow-requests.md`     |
| `CircuitBreakerOpen` | warning    | `circuit_breaker_state == 2` por 5 min                | `docs/runbooks/circuit-breaker.md`   |

### 6.4 Cron e jobs

| Alerta           | Severidade | Trigger                                          | Runbook                             |
| ---------------- | ---------- | ------------------------------------------------ | ----------------------------------- |
| `CronJobFailing` | warning    | `>= 2` falhas consecutivas em 30 min sem sucesso | `docs/runbooks/cron-job-failing.md` |
| `CronJobMissing` | warning    | nenhuma execução de `job` em 24 h                | `docs/runbooks/cron-job-failing.md` |

### 6.5 Backups e DR

| Alerta                  | Severidade | Trigger                                           | Runbook                             |
| ----------------------- | ---------- | ------------------------------------------------- | ----------------------------------- |
| `BackupStale`           | critical   | `backup_age_seconds > 25 * 3600`                  | `docs/runbooks/backup-missing.md`   |
| `BackupFreshnessBreach` | warning    | `increase(backup_freshness_breach_total[1h]) > 0` | `docs/runbooks/backup-missing.md`   |
| `BackupChainBreak`      | critical   | `increase(backup_chain_break_total[1h]) > 0`      | `docs/runbooks/backup-missing.md`   |
| `RestoreDrillStale`     | warning    | `restore_drill_age_seconds > 180 * 86400`         | `docs/runbooks/dr-drill-2026-04.md` |

### 6.6 Audit chain

| Alerta                  | Severidade | Trigger                                           | Runbook                                 |
| ----------------------- | ---------- | ------------------------------------------------- | --------------------------------------- |
| `AuditChainTampered`    | critical   | `increase(audit_chain_break_total[15m]) > 0`      | `docs/runbooks/audit-chain-tampered.md` |
| `AuditChainVerifyStale` | warning    | `time() - audit_chain_last_verify_ts > 26 * 3600` | `docs/runbooks/audit-chain-tampered.md` |

### 6.7 Content Security Policy

| Alerta                   | Severidade | Trigger                                                                         | Runbook                |
| ------------------------ | ---------- | ------------------------------------------------------------------------------- | ---------------------- |
| `CspViolationSpike`      | warning    | `> 50` violações enforce-mode em 1 directive em 15 min                          | `docs/security/csp.md` |
| `CspInlineScriptBlocked` | critical   | qualquer inline script bloqueado em enforce-mode (canary de XSS real) em 10 min | `docs/security/csp.md` |
| `CspReportInvalidFlood`  | warning    | `> 200` payloads inválidos em `csp_report_invalid_total` em 10 min              | `docs/security/csp.md` |

### 6.8 RLS canary

| Alerta               | Severidade | Trigger                                          | Runbook                          |
| -------------------- | ---------- | ------------------------------------------------ | -------------------------------- |
| `RlsCanaryViolation` | critical   | `increase(rls_canary_violations_total[15m]) > 0` | `docs/runbooks/rls-violation.md` |
| `RlsCanaryStale`     | warning    | `rls_canary_age_seconds > 26 * 3600`             | `docs/runbooks/rls-violation.md` |

### 6.9 Secret rotation

| Alerta                  | Severidade | Trigger                                            | Runbook                            |
| ----------------------- | ---------- | -------------------------------------------------- | ---------------------------------- |
| `SecretRotationOverdue` | warning    | `secret_rotation_overdue_count > 0` por 24 h       | `docs/runbooks/secret-rotation.md` |
| `SecretRotationFailure` | critical   | `increase(secret_rotation_failures_total[1h]) > 0` | `docs/runbooks/secret-rotation.md` |

### 6.10 Legal hold e DSAR

| Alerta                | Severidade | Trigger                                                                | Runbook                                |
| --------------------- | ---------- | ---------------------------------------------------------------------- | -------------------------------------- |
| `LegalHoldStuckPurge` | warning    | `> 0` linhas bloqueadas em `legal_hold_blocked_purge_total` por > 30 d | `docs/runbooks/legal-hold-received.md` |
| `DsarSlaBreach`       | critical   | `increase(dsar_sla_breach_total[1h]) > 0`                              | `docs/runbooks/dsar-sla-missed.md`     |
| `DsarSlaWarning`      | warning    | `increase(dsar_sla_warning_total[15m]) > 0`                            | `docs/runbooks/dsar-sla-missed.md`     |

### 6.11 Conciliação financeira

| Alerta                      | Severidade | Trigger                                                                | Runbook                                            |
| --------------------------- | ---------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `MoneyDrift`                | critical   | `increase(money_drift_total[1h]) > 0`                                  | `docs/runbooks/money-drift.md`                     |
| `MoneyReconcileStale`       | warning    | `time() - money_reconcile_last_run_ts > 3600` por 5 min                | `docs/runbooks/money-drift.md`                     |
| `PlatformRevenueRecon`      | warning    | `increase(platform_revenue_recon_gap_total[24h]) > 0`                  | `docs/runbooks/platform-revenue-reconciliation.md` |
| `PlatformRevenueReconStale` | warning    | `time() - platform_revenue_recon_last_run_ts > 86400 + 3600` por 5 min | `docs/runbooks/platform-revenue-reconciliation.md` |

### 6.12 Pricing engine (PR-E de ADR-001)

| Alerta                         | Severidade | Trigger                                                                        | Runbook                           |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------ | --------------------------------- |
| `PricingProfilesMissing`       | warning    | `pricing_health_profiles_missing > 0` por 30 min                               | `docs/runbooks/pricing-health.md` |
| `PricingHealthCheckStale`      | warning    | `time() - pricing_health_last_success_ts > 26h` por 5 min                      | `docs/runbooks/pricing-health.md` |
| `PricingINV4CapBurst`          | warning    | `increase(pricing_inv4_cap_total{product_id}[1h]) > 20` por 15 min             | `docs/runbooks/pricing-health.md` |
| `PricingINV2CapBurst`          | warning    | `increase(pricing_inv2_cap_total{product_id}[1h]) > 20` por 15 min             | `docs/runbooks/pricing-health.md` |
| `PricingPreviewErrorRate`      | warning    | error-rate (excluindo auth/429/400) de `pricing_preview_total` > 5% por 15 min | `docs/runbooks/pricing-health.md` |
| `PricingPreviewLatencyP95High` | warning    | p95 de `pricing_preview_duration_ms` > 1500 ms por 15 min                      | `docs/runbooks/pricing-health.md` |

> **Invariante:** toda linha acima tem um `- alert:` correspondente
> em `monitoring/prometheus/alerts.yml` com o mesmo nome, severidade
> igual ou mais alta, e o runbook citado existe no repositório.
> `scripts/claims/check-alert-coverage.mjs` verifica isso a cada push.

---

## 7. Onboarding de uma nova métrica

1. Adicione a constante a `Metrics` em `lib/metrics.ts` (snake_case + sufixo correto).
2. Use SOMENTE counters / gauges / histograms — nunca strings ou listas livres.
3. Limite o vocabulário de cada label (≤ 10 valores em condição normal).
4. Documente a métrica neste catálogo (§3) com tipo, labels, descrição.
5. Adicione um painel ao dashboard apropriado (`monitoring/grafana/*.json`).
6. Se for um sinal acionável, acrescente alert rule a `monitoring/prometheus/alerts.yml`.
7. Rode `npm test -- metrics-catalog` — o teste de invariantes valida
   que toda constante exposta é citada neste documento.

---

## 8. Histórico de versões

| Versão | Data       | Mudança                                                                  |
| ------ | ---------- | ------------------------------------------------------------------------ |
| 1.0    | 2026-04-18 | Criação — 50+ métricas catalogadas, alert rules formalizadas, drift test |
