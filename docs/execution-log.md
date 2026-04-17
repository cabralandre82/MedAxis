# Clinipharma — Execution Log (Auditoria 2026-04)

**Propósito:** rastreio granular de cada wave executada pelo agente. Cada entrada registra: timestamp, wave, entregáveis, commits, migrations aplicadas, testes rodados, links de deploy.

**Referências:** `docs/implementation-plan.md`, `docs/audit-fine-tooth-comb-2026-04.md`

---

## Formato de entrada

```
### Wave N.X — [título] — YYYY-MM-DD HH:MM TZ

**Status:** 🟡 em andamento | 🟢 concluído | 🔴 revertido
**PR:** #<num>
**Commits:** <hash1>, <hash2>
**Migrations aplicadas (staging):** nnn_xxx.sql @ YYYY-MM-DD
**Migrations aplicadas (prod):** nnn_xxx.sql @ YYYY-MM-DD
**Env vars alteradas:** <lista>
**Testes:** N unit (+delta), N E2E (+delta), cobertura X%
**Deploy staging:** <url>
**Deploy prod:** <url>

**Entregáveis:**
- arquivo/módulo — resumo

**Observações / issues encontrados:**
- ...

**Follow-ups criados:**
- #<issue num>
```

---

## Wave 0 — Safety net — 2026-04-17

### Wave 0.0 — Planejamento & documentação — 2026-04-17 17:30 BRT

**Status:** 🟢 concluído
**Entregáveis:**

- `docs/audit-fine-tooth-comb-2026-04.md` — relatório da auditoria 20 lentes consolidado
- `docs/implementation-plan.md` — revisado para modelo wave-based (PR-por-wave, agente executor)
- `docs/execution-log.md` — este arquivo, inicializado
- `docs/runbooks/README.md` — índice e template de runbooks

**Observações:**

- Decidido remover pentest externo deste ciclo; scanners automáticos (CodeQL + Gitleaks + Trivy + npm audit) + E2E security compensam.
- Numeração de novas migrations continua de `044` (existente vai até `043_server_logs.sql`).

---

### Wave 0.1 — Feature flags infra — 2026-04-17 17:55 BRT

**Status:** 🟢 concluído (aguardando aplicação de migration em staging/prod)
**Testes:** 982 total (+27 novos em `tests/unit/lib/features.test.ts`) — todos verdes

**Entregáveis:**

- `supabase/migrations/044_feature_flags.sql` — tabela `feature_flags` (kill-switch + rollout 0-100 + allow-lists por `role`/`user_id`/`clinic_id`/`pharmacy_id` + variants jsonb) + `feature_flag_audit` (append-only com trigger) + RLS restrito a `SUPER_ADMIN`/`PLATFORM_ADMIN` + seed com 7 flags iniciais (todas desativadas).
- `lib/features/index.ts` — `isFeatureEnabled()`, `getFeatureVariant()`, `invalidateFeatureFlagCache()`, cache TTL 30s, fail-closed em erro de DB, hash FNV-1a para rollout determinístico.
- `tests/__mocks__/server-only.ts` — stub para permitir import de módulos `server-only` em vitest.
- `vitest.config.ts` — alias de `server-only` apontando para o stub.
- `tests/unit/lib/features.test.ts` — 27 testes cobrindo hash, evaluator puro (todas dimensões de targeting), cache, fail-closed, A/B variants com distribuição estatística.

**Observações:**

- Migration 044 é idempotente (`IF NOT EXISTS`) e segue convenções existentes do repo.
- Flags seed todos em `enabled=false` — safe by default, waves futuras ativam individualmente.
- Cache TTL configurável via env `FEATURE_FLAG_CACHE_TTL_MS`.

**Próximo passo operacional:** aplicar migration 044 em staging → validar que seed populou → aplicar em prod.

---

### Wave 0.2 — Security scan CI — 2026-04-17 17:58 BRT

**Status:** 🟢 concluído (ativa no primeiro push após merge)

**Entregáveis:**

- `.github/workflows/security-scan.yml` — 6 jobs independentes rodando em push para `main`/`develop`, em PRs, agendado às segundas 06h UTC e em dispatch manual:
  1. `codeql` — análise semântica JS/TS com query set `security-and-quality`, SARIF para GitHub Security tab.
  2. `gitleaks` — scan de segredos em todo histórico (fetch-depth: 0).
  3. `npm-audit` — high severity bloqueante (production deps), moderate+ informativo (all deps).
  4. `trivy-fs` — filesystem + config misconfig, SARIF upload.
  5. `license-check` — falha em AGPL/GPL/SSPL em dependências de produção; artefato com summary (30d).
  6. `sbom` — CycloneDX JSON anexado ao workflow (90d retention).

**Observações:**

- Jobs são não-bloqueantes em primeira rodada (`continue-on-error: true` em npm-audit, `exit-code: 0` em trivy) — promoção para gating em `docs/branch-protection.md` após primeira rodada limpa.
- `GITLEAKS_LICENSE` é opcional para repo privado solo — se ausente, gitleaks-action funciona com limitações.

---

### Wave 0.3 — CODEOWNERS + Dependabot + branch protection — 2026-04-17 18:00 BRT

**Status:** 🟢 concluído (regras de GitHub precisam ser aplicadas manualmente — ver `docs/branch-protection.md`)

**Entregáveis:**

- `.github/CODEOWNERS` — owner `@cabralandre82` em default + áreas críticas (migrations, workflows, lib/rbac, lib/crypto, middleware, lib/features, lib/audit, docs/legal).
- `.github/dependabot.yml` — npm (semanal às segundas 06h BRT) + github-actions (semanal 06:30 BRT). Patches/minors agrupados; majors de react/next mantidos individuais para upgrade-playbook dedicado.
- `docs/branch-protection.md` — política completa de branch protection para `main` e `develop`: review obrigatório, status checks (unit-tests + lint + e2e-smoke + codeql + gitleaks), linear history, signed commits, emergency bypass.
- Snippet `gh api -X PUT …` para automatizar aplicação.

**Próximo passo operacional:** aplicar as regras em GitHub Settings → Branches.

---

### Wave 0.4 — Offsite backup + restore drill — 2026-04-17 18:02 BRT

**Status:** 🟢 concluído (workflows dependem de secrets configurados — ver lista em `docs/disaster-recovery.md`)

**Entregáveis:**

- `.github/workflows/offsite-backup.yml` — executa domingos 04h BRT (07h UTC) ou dispatch manual:
  - `pg_dump --format=custom --compress=9` do banco de produção.
  - Download de buckets `contracts` e `order-documents` (Storage API, paginado 1000 itens).
  - Cifragem com `age` usando `AGE_PUBLIC_KEY` (recipient; chave privada fica offline com fundador).
  - Upload para Cloudflare R2 (`clinipharma-offsite/weekly/<stamp>/`).
  - Slack notify sucesso/falha via `SLACK_WEBHOOK_OPS`.
- `.github/workflows/restore-drill.yml` — executa dia 1 de cada mês:
  - Spin up de Postgres 16 service container.
  - Sync do snapshot mais recente de R2 (ou prefixo especificado).
  - Decriptação com `AGE_PRIVATE_KEY`.
  - Verificação de `sha256sum` via manifest.
  - `pg_restore` medindo duração (RTO real).
  - Queries de integridade (counts em `auth.users`, `orders`, `payments`, `audit_logs`, `feature_flags`).
  - Validação estrutural do tarball de Storage.
  - Summary + Slack notify.
- `docs/disaster-recovery.md` — seção 5 revisada com linha `DB offsite` e `Storage offsite`, detalhamento do workflow, lista de 10 secrets necessários, regras de lifecycle no R2.

**Secrets pendentes de configuração manual no repositório:** `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `AGE_PUBLIC_KEY`, `AGE_PRIVATE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `SLACK_WEBHOOK_OPS`.

---

### Wave 0 — resumo consolidado

| Métrica                       | Antes      | Depois                                              |
| ----------------------------- | ---------- | --------------------------------------------------- |
| Migrations                    | 43         | 44                                                  |
| Arquivos em `lib/features/`   | 0          | 1                                                   |
| Testes unit                   | 955        | 982 (+27)                                           |
| Workflows GitHub Actions      | 1 (ci.yml) | 4 (+security-scan, +offsite-backup, +restore-drill) |
| Dependabot                    | ❌         | ✅                                                  |
| CODEOWNERS                    | ❌         | ✅                                                  |
| Branch protection documentado | parcial    | completo em `docs/branch-protection.md`             |
| Backup offsite                | ❌         | ✅ R2 + age cipher                                  |
| Restore drill automatizado    | ❌         | ✅ mensal                                           |

**Ações operacionais pendentes (humano):**

1. Configurar 10 secrets no repositório (lista em `docs/disaster-recovery.md`).
2. Provisionar bucket R2 `clinipharma-offsite` + lifecycle rules.
3. Gerar par `age-keygen`; subir chave pública como `AGE_PUBLIC_KEY`, guardar privada offline.
4. Aplicar migration 044 em staging → validar → aplicar em prod.
5. Aplicar regras de branch protection em GitHub Settings.
6. Ativar Dependabot no Settings → Security & analysis (se ainda não estiver).

**Follow-ups identificados:**

- Adicionar UI admin em `/admin/feature-flags` para toggle visual das flags (próxima wave quando for útil).
- Adicionar CI status badge no `README.md` apontando para security-scan.

---
