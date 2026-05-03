# Launch Baseline — 2026-05-02

> **Marco**: ponto em que a plataforma é considerada **pronta para mercado**
> pelo operador (André), antes do primeiro pedido pago real de cliente externo.
> A partir daqui, qualquer regressão tem ponto de comparação inequívoco e
> ponto de rollback claro.

---

## 1. Identidade do baseline

| Campo                 | Valor                                                   |
| --------------------- | ------------------------------------------------------- |
| Tag git               | `v1.0.0-launch-ready`                                   |
| Commit                | `c2b3f53`                                               |
| Data                  | 2026-05-02 (sábado)                                     |
| Operador              | solo-ops (André)                                        |
| Última migration      | `083_coupons_relax_discount_value_for_tier_upgrade.sql` |
| Total migrations      | 83 (001..083)                                           |
| Backup snapshot label | `pre-launch-baseline-2026-05-02` (R2 offsite)           |
| Workflow run          | `gh run view 25265494982`                               |
| Domínio prod          | https://clinipharma.com.br                              |
| Domínio staging       | https://staging.clinipharma.com.br                      |

---

## 2. Features estáveis no baseline

> Lista usada para validar que uma regressão **regrediu algo que estava
> funcionando**. Se uma feature aparece aqui e quebra depois, é regressão
> automática (P1) — não "comportamento esperado de feature em desenvolvimento".

### Pricing engine

- [x] **Modo FIXED legado** — todos os produtos não-tiered continuam usando
      `products.price_current` como antes.
- [x] **Modo TIERED_PROFILE (ADR-001)** — profile ativo + tiers escalonados
      por quantidade, com piso de plataforma absoluto **e** percentual
      (greater-of), buyer override opcional.
- [x] **Sincronização de campos legados** — ao publicar profile, `products.price_current`
      e `products.pharmacy_cost` refletem tier 1 + custo de farmácia
      (mig 082, retroativo via backfill).
- [x] **Simulador interativo na catalog page** — buyer escolhe quantidade e vê
      preço unitário + total + desconto de cupom em tempo real.
- [x] **Matriz de impacto de cupom** (super-admin) — preview cruzado de
      cupom × quantidade × buyer override.
- [x] **Invariantes financeiros INV-1..INV-4** validados em prod via shake-down
      manual (2026-04-30).

### Cupons

- [x] `PERCENT` e `FIXED` (legado).
- [x] `FIRST_UNIT_DISCOUNT`, `TIER_UPGRADE`, `MIN_QTY_PERCENT` (ADR-002),
      restritos a produtos `pricing_mode = TIERED_PROFILE` por guard
      em `services/coupons.ts` + `RAISE EXCEPTION` na trigger
      `freeze_order_item_price` (mig 080).
- [x] **Auto-replace atômico** (ADR-003) — RPC `replace_active_coupon`
      desativa cupom anterior e insere novo na mesma transação,
      com modal de confirmação no admin panel.

### Pagamento + Contratos

- [x] **Asaas prod**: `ASAAS_API_URL=https://www.asaas.com/api/v3`,
      `ASAAS_API_KEY` validada via `GET /myAccount` (200 OK,
      `ALC INTERMEDIACAO E REPRESENTACAO LTDA`).
- [x] **Asaas webhook**: `ASAAS_WEBHOOK_SECRET` configurado, validação
      via `safeEqualString`.
- [x] **Clicksign prod**: `CLICKSIGN_ACCESS_TOKEN` configurado.
- [x] **Clicksign webhook**: `CLICKSIGN_WEBHOOK_SECRET` configurado,
      validação HMAC SHA-256.

### Auth + RBAC

- [x] Login Clínica/Médico/Farmácia/Super-Admin.
- [x] Tenant isolation provado diariamente via `/cron/rls-canary` (rodando single-fire).
- [x] CSRF double-submit cookie (`__Host-csrf`) em todas as mutações
      exceto exempt prefixes (lista em `lib/security/csrf.ts`).

### Compliance

- [x] Audit chain hash-encadeada (mig 046), verificada nightly via
      `/cron/verify-audit-chain`.
- [x] DSAR com SLA de 15 dias (mig 051) + cron `expire-doc-deadlines`.
- [x] Retention policies (`lib/retention/policies.ts`) + cron `enforce-retention`.
- [x] Legal hold vence retention (mig 054).
- [x] Encryption AES-256-GCM com key rotation tier (`lib/crypto.ts`).

### Observabilidade

- [x] Sentry (erros + traces) com scrubbing de PII.
- [x] Logger estruturado + Prometheus-style metrics (`/api/metrics`).
- [x] Server logs UI (`/server-logs`) com banner de saúde, janela
      temporal e marcador de "histórico residual".
- [x] Synthetic monitoring 3 camadas (5min/30min/3h).
- [x] UptimeRobot externo + Sentry alerts + Slack-equivalent (email).
- [x] SLOs definidos em `docs/observability/slos.md`.

### Infra

- [x] Vercel `clinipharma` ativo, `b2b-med-platform` em quarentena
      (deploys e crons neutralizados — ver `docs/infra/vercel-projects-topology.md`).
- [x] Supabase staging provisionado (mig 001..083) e validado com
      k6 smoke + health + realistic-workload.
- [x] Cloudflare R2 offsite backup semanal + restore drill funcional.
- [x] Upstash Redis rate-limit + cron lock distribuído.

---

## 3. Garantias contra regressão (estado em 2026-05-02)

### Bloqueia merge (CI)

- `unit-tests` (Vitest + cobertura)
- `lint` (ESLint + `tsc --noEmit`)
- `e2e-smoke` (Playwright contra staging ou local com Supabase staging)
- `Security Scan` (gitleaks, trivy, codeql, npm audit, license, sbom)

### Detecta após merge (cron)

- `verify-audit-chain` (03:45 UTC) — tampering em `audit_logs`
- `money-reconcile` — drift `*_cents` vs `numeric`
- `rls-canary` — tenant isolation
- `backup-freshness` — backup há mais de 8 dias
- `enforce-retention`, `expire-doc-deadlines`, `expire-legal-holds`
- `synthetic-probe` (5 min) — disponibilidade básica de prod
- `external-probe` (30 min) — TLS, DNS, headers de segurança
- `schema-drift` (diário) — divergência migrations ↔ DB

### Mutation testing (security surface)

- Stryker rodando em `lib/crypto.ts`, `lib/security/**`
- Threshold mínimo: **84%**

---

## 4. Lacunas reconhecidas (próximo passo após v1.0.0)

Decididas conscientemente como **fora do escopo do baseline** mas
**dentro do escopo da próxima iteração**:

1. **Golden-path E2E end-to-end** (clinic login → tiered → pedido → pagamento
   → confirmação) — hoje cada etapa tem teste isolado, mas o caminho
   completo não tem assert único bloqueante.
2. **Smoke pós-deploy automatizado** — Vercel deploy é detectado por
   sentry/cron, não por pipeline reativo dedicado.
3. **Inventário de kill-switches** — existem (`money.cents_read`,
   `csp_report_only`) mas não estão indexados em um único doc, nem
   há kill-switch para tiered pricing nem para coupon types novos.

> **Update 2026-05-02 (mesma sessão)**: os 3 itens foram parcialmente
> entregues junto com a tag:
>
> - Trilho B → `tests/e2e/golden-path.test.ts` + `npm run test:e2e:bloqueante`
>   adicionados ao step `e2e-smoke` do CI (bloqueia merge).
> - Trilho C → `.github/workflows/post-deploy-smoke.yml` dispara após
>   CI verde em main, roda golden-path contra prod, abre issue P1
>   automática se falhar (runbook em `docs/runbooks/post-deploy-smoke-failed.md`).
> - Trilho D → `docs/operations/kill-switches.md` consolida flags
>   existentes e identifica gaps (asaas, clicksign, tiered, novos
>   cupons). Implementação dos gaps fica para próxima iteração.

---

## 5. Como usar este baseline

### Cenário A — algo regrediu em prod, suspeito-do-que

1. `git diff v1.0.0-launch-ready..HEAD -- <area suspeita>` para ver
   o delta desde o baseline.
2. Se a regressão estiver dentro do delta, é candidata a `git revert`
   pontual.
3. Se a regressão **não** está no delta de código, é regressão de
   dados/config externa (Vercel env, Supabase row, secret, DNS).

### Cenário B — preciso restaurar prod ao estado v1.0.0

1. **Código**: `git checkout v1.0.0-launch-ready` + redeploy Vercel.
2. **DB**: restaurar do snapshot R2 `pre-launch-baseline-2026-05-02.tar.age`
   seguindo `docs/runbooks/database-restore.md`.
3. **Crons**: já estavam corretos em v1.0.0 — sem ação.
4. **Envs Vercel**: comparar com `docs/security/secrets-manifest.json`
   (commit do baseline) e reaplicar diferenças.

### Cenário C — vou fazer mudança grande, quero proteger o baseline

1. Não delete a tag.
2. Antes do merge da mudança grande, dispare backup manual com label
   `pre-<feature>-yyyy-mm-dd`.
3. Mantenha kill-switch da nova feature em `app_settings` para reverter
   sem deploy.

---

## 6. Próximas tags planejadas

| Tag                    | Quando                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `v1.0.1-golden-path`   | Após Trilho B (golden-path E2E bloqueante)                          |
| `v1.0.2-post-deploy`   | Após Trilho C (smoke pós-deploy)                                    |
| `v1.0.3-killswitches`  | Após Trilho D (inventário + gaps de kill-switches)                  |
| `v1.1.0-first-revenue` | Após o **primeiro pedido pago real** de cliente externo (não-teste) |

---

## Procedimento de manutenção deste documento

- **NÃO edite** as seções 1, 2, 3 — são snapshot histórico imutável.
- **PODE atualizar** seção 4 conforme as lacunas viram features.
- **DEVE atualizar** seção 6 conforme tags forem criadas.
- Quando criar `v1.1.0-first-revenue`, copie este doc inteiro para
  `docs/launch-baseline-v1.1.0-yyyy-mm-dd.md` e mantenha ambos.
