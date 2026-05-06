# AGENTS.md — guia canônico para agentes de IA

Lido automaticamente por qualquer agente (Cursor, Codex CLI, Claude
Code, Devin, etc.) **antes** de iniciar qualquer tarefa. Não edite
sem ler toda a seção "Invariantes" — várias linhas aqui foram
desenhadas para impedir classes inteiras de bug/regressão.

> Operação solo. Um humano. Muitos agentes. O humano é **aprovador**,
> não executor. Cada agente que entra aqui está substituindo um
> stand-up, um code review, ou uma escala de on-call. Leia esse
> arquivo inteiro uma vez, salve o modelo mental, e só volte se
> `docs/execution-log.md` indicar mudança estrutural.

---

## 0. O que é esta plataforma

- **Nome**: Clinipharma (domínio `clinipharma.com.br`)
- **Produto**: Marketplace B2B farmácia ↔ clínica (Brasil). Clínicas
  enviam prescrições digitais; farmácias precificam, aceitam, separam,
  faturam; pacientes retiram.
- **Dados sensíveis**: CPF, CRM/CRF, prescrições, endereços, dados de
  pagamento. Sujeito a LGPD + ANPD + CFM + ANVISA.
- **Stack**:
  - Next.js 15 (App Router, Server Components) + React 19
  - Supabase Postgres (RLS estrito) + Supabase Storage + Supabase Auth
  - Vercel Edge runtime + Vercel cron
  - Upstash Redis (rate-limit distribuído + cron lock)
  - Sentry (erros + traces) + logger estruturado + Prometheus-style metrics
  - Resend (transactional email) + Asaas (pagamento PIX/cartão)
  - Inngest (durable jobs)
  - Testes: Vitest (unit) + Playwright (E2E + a11y) + k6 (load) + Stryker (mutation)
- **Escala atual**: bootstrap, 1 operador, onboarding de primeiras
  clínicas/farmácias. Arquitetura é dimensionada para 100× esse
  volume sem re-fundação.

## 1. Invariantes — agente NUNCA pode violar

Se um pedido do usuário implicar em violar qualquer coisa abaixo,
**pare e pergunte** antes de executar.

### Segurança

1. **RLS é obrigatório em toda nova tabela**. O safety-net da
   migration 057 força `enable row level security` em qualquer
   tabela nova; pelo menos uma policy `select`/`insert`/`update`/
   `delete` deve existir. Ver `supabase/migrations/057_rls_auto_enable_safety_net.sql`.
2. **Nunca persista PII em claro**. Use `encrypt()` / `decrypt()` de
   `lib/crypto.ts` (AES-256-GCM + key rotation tier). A chave vive
   em `ENCRYPTION_KEY` (64 hex). Se o campo for pesquisável, indexe
   o hash HMAC, não o valor.
3. **Nunca desabilite CSP em produção**. A CSP é gerada por
   `lib/security/csp.ts` com nonce por request; `CSP_REPORT_ONLY=true`
   existe só para debug em preview, nunca em `main`.
4. **Nunca adicione `'unsafe-inline'` a `script-src`** — usar nonce.
   `style-src-attr 'unsafe-inline'` é exceção documentada (React inline style prop).
5. **Audit chain é append-only**. Nunca `DELETE` ou `UPDATE` em
   `audit_logs` — o cron `verify-audit-chain` detecta e abre incidente.
6. **CSRF via Origin + double-submit cookie** (`lib/security/csrf.ts`).
   Cookie `__Host-csrf` é intencionalmente não-HttpOnly. Não "conserte".

### Dados

7. **Dinheiro é `int` em centavos**. Nunca `float`/`decimal` em código
   aplicação. Ver `supabase/migrations/050_money_cents.sql` e `lib/money.ts`.
8. **Migrations são append-only** em `supabase/migrations/NNN_*.sql`.
   Nunca edite uma migration já mergeada — crie uma nova. Schema drift
   Layer 2 detecta divergência.
9. **Retenção é automatizada**. Nunca crie política manual de purge;
   estenda `lib/retention/policies.ts` + cron `enforce-retention`.

### Compliance (LGPD)

10. **DSAR tem SLA legal de 15 dias**. Automação em
    `supabase/migrations/051_dsar_sla.sql` + cron `expire-doc-deadlines`.
11. **Legal hold vence RLS**. Se `legal_holds` aponta para uma linha,
    policies de retenção ignoram aquela linha (`supabase/migrations/054_legal_holds.sql`).
12. **Incidentes de dados pessoais** disparam notificação ANPD em
    72h. Runbook: `docs/runbooks/data-breach-72h.md`.

### CI / deploy

13. **Nunca `git push --force` em `main`**.
14. **Nunca `npm audit fix --force`** — quebra pins.
15. **Todo PR que toca `lib/crypto.ts` ou `lib/security/**`dispara
mutation-test**. Threshold: 84% mínimo. Ver`stryker.config.mjs`.

---

## 2. Onde as coisas vivem (topologia)

| Quer saber…                                    | Leia                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Postura de segurança completa                  | `docs/security/threat-model.md` + `docs/security/dynamic-scanning.md` |
| Modelo de operação humano vs agente            | `docs/SOLO_OPERATOR.md`                                               |
| Como responder a um alerta (fast-path)         | `.cursor/skills/README.md` → skill específico                         |
| Como responder a um alerta (contexto completo) | `docs/runbooks/README.md` → runbook específico                        |
| Estratégia de testes (pirâmide + mutation)     | `docs/testing/strategy.md` + `docs/testing/mutation-testing.md`       |
| Matriz RLS por tabela                          | `docs/rls-matrix.md`                                                  |
| SLOs e burn-rate                               | `docs/observability/slos.md` + `docs/observability/burn-rate.md`      |
| 3 camadas de synthetic monitoring              | `docs/observability/synthetic-monitoring.md`                          |
| Evidência de DR drill (restore + audit-tamper) | `docs/security/dr-evidence/YYYY-MM-DD/`                               |
| Decisões arquiteturais (ADRs)                  | `docs/decisions/`                                                     |
| Log de mudanças estruturais                    | `docs/execution-log.md`                                               |
| Topologia de projetos Vercel                   | `docs/infra/vercel-projects-topology.md`                              |
| Inventário de secrets                          | `docs/security/secrets-manifest.json`                                 |
| Review de senior counsel (legal)               | `docs/legal/REVIEW-2026-04-17-senior-counsel.md`                      |

## 3. Comandos canônicos

```bash
# Ciclo local rápido (sempre antes de push)
npx tsc --noEmit && npx vitest run && npm run build

# Lint + format (lint-staged roda no pre-commit também)
npx eslint . && npx prettier --check .

# Testes focados
npx vitest run tests/unit/lib/crypto.test.ts
npx playwright test tests/e2e/a11y-public-pages.test.ts

# Mutation (só security surface, ~4 min)
npm run test:mutation

# CI — monitorar último run de um workflow
gh run list --workflow=ci.yml --limit=3
gh run watch <run-id> --exit-status

# Disparar workflows manuais
gh workflow run zap-baseline.yml --ref main
gh workflow run external-probe.yml --ref main
gh workflow run schema-drift.yml --ref main

# Supabase — rodar migrations localmente (requer docker)
npx supabase db reset

# Vercel — log em tempo real do prod
vercel logs --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

## 4. Antes de executar — leia nesta ordem

Para qualquer tarefa não-trivial, priorize leitura nesta sequência:

1. Este arquivo (AGENTS.md) — invariantes
2. `docs/SOLO_OPERATOR.md` — quem faz o quê
3. `.cursor/rules/*.mdc` — convenções por domínio (auto-carregadas)
4. **Se for resposta a incidente**: `.cursor/skills/<nome>/SKILL.md` (fast-path) → depois o runbook em `docs/runbooks/` (contexto completo)
5. ADR relevante em `docs/decisions/` se tocar arquitetura

### Taxonomia rule / skill / runbook

Três artefatos diferentes para três papéis diferentes:

- **`.cursor/rules/*.mdc`** → **previne**. Invariantes que o agente não
  pode violar ao editar código. Auto-carregadas por globs.
- **`.cursor/skills/*/SKILL.md`** → **executa**. Checklist + SQL pronto
  para incidentes recorrentes. Auto-descobertas pela descrição.
- **`docs/runbooks/*.md`** → **explica**. Contexto regulatório, decisão
  histórica, rationale. Lidas sob demanda.

Rule previne acidente. Skill guia procedimento. Runbook é fonte da verdade.

Quando em dúvida entre "fazer do jeito antigo" vs "jeito novo": faça
do jeito antigo e abra issue. Solo-ops não tem orçamento para refactor
paralelo sem plano escrito.

---

## Credenciais persistidas — NUNCA pergunte ao usuário

Todas as credenciais abaixo já estão configuradas neste host. **Não
solicite ao usuário que as forneça novamente** — verifique primeiro
os locais de origem.

### Vercel CLI

- **Token**: exportado como `VERCEL_TOKEN` em `~/.bashrc`
  (também espelhado em `~/.config/agent/credentials.env`).
- **Org / Team ID**: `team_fccKc8W6hyQmvCcZAGCqV1UK`
  (slug `cabralandre-3009`).
- **Projetos visíveis**: `clinipharma` (ativo), `instituto-nova-medida`,
  `omni-runner-portal`, `project-running`. (`b2b-med-platform` foi
  deletado em 2026-05-06 após 17 dias de quarentena — ver
  `docs/infra/vercel-projects-topology.md`.)
- **Projeto ATIVO deste repo**: `clinipharma` — serve `clinipharma.com.br`
  (main) e `staging.clinipharma.com.br` (branch staging). Para vincular
  o CLI local ao projeto certo:

  ```bash
  vercel link --yes --project clinipharma --scope cabralandre-3009s-projects \
    --token "$VERCEL_TOKEN"
  ```

  (`.vercel/project.json` é gitignored — cada agente roda esse comando
  uma vez por máquina.)

- **Histórico — projeto deletado**: `b2b-med-platform` foi mantido em
  quarentena de 2026-04-19 a 2026-05-06 (17 dias) e então deletado via
  Vercel API. Backup pre-delete em
  `~/.config/agent/backups/b2b-med-platform_pre-delete_20260506.json`.
  Histórico completo: [`docs/infra/vercel-projects-topology.md`](docs/infra/vercel-projects-topology.md).

#### Por que `VERCEL_TOKEN` env var não basta sozinho

Algumas subcomandas do Vercel CLI 50.x ignoram a env var e exigem
flag explícita `--token=$VERCEL_TOKEN`. Sempre passe ambos:

```bash
vercel <command> --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

Como `~/.bashrc` é carregado em shells novos do agente, a env var
estará disponível na maioria dos casos. Quando estiver vazia, leia
de `~/.config/agent/credentials.env`:

```bash
set -a; . ~/.config/agent/credentials.env; set +a
```

#### Operações comuns

```bash
# listar envs do projeto
vercel env ls --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# adicionar env (precisa stdin com o valor)
echo -n "true" | vercel env add CSP_REPORT_ONLY production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# forçar redeploy de produção pegando a env nova
vercel --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

### GitHub CLI (`gh`)

- Já autenticado via `~/.config/gh/hosts.yml`
  (user `cabralandre82`, scopes `gist, read:org, repo, workflow`).
- Use `gh` direto sem flags adicionais.

---

## Workflow git

- **Branch único**: `main`. Não há fluxo de feature branches —
  commits vão direto para `main`. PRs existem apenas para
  Dependabot e revisão externa.
- **Push direto permitido**: as rules do GitHub bypassem para o
  owner. Use `git push origin main` normalmente; se a CI falhar
  depois, reverter.
- **lint-staged + husky** estão ativos no pre-commit:
  rodam `eslint --fix` e `prettier --write` em arquivos staged.
  Espere ~2-3s no commit.
- **Commits em português** (idioma do usuário); body em conventional
  commits + descrição técnica detalhada (não economizar palavras).

---

## CI/CD

- **Workflows obrigatórios** (configurados como required status checks
  em branch protection): `CI` (lint + tests) e `Security Scan`
  (gitleaks + trivy + codeql + npm audit + license + sbom).
- **Auto-merge desabilitado** no repo. Para mergear PR sem aprovação
  humana use `--admin`: `gh pr merge N --squash --admin --delete-branch`.
- **CI tempo médio**: 2-3 min. Use `gh run watch <id> --exit-status`
  para bloquear até verde.

---

## Não-negociáveis

- ❌ Nunca commit credenciais (tokens, .env\*, service-account JSON).
  Tudo isso está em `.gitignore` — confira antes de `git add -A`.
- ❌ Nunca rodar `git push --force` em `main`.
- ❌ Nunca rodar `npm audit fix --force` sem revisão (quebra deps
  pinadas via package.json `^x.y.z`).
- ✅ Sempre rodar `npx tsc --noEmit && npx vitest run && npm run build`
  antes de pushar mudanças que tocam código (não-doc).
