# Clinipharma — Branch Protection Policy

**Escopo:** branches `main` e `develop` (quando existir).
**Fonte de verdade:** esta configuração é aplicada via GitHub (Settings → Branches → Add rule).
**Automação futura:** replicar via Terraform + `github` provider ou via `gh api`.

---

## Regras ativas em `main`

### Review obrigatório

- [x] **Require a pull request before merging** — nada entra em `main` direto.
- [x] **Require approvals** — mínimo **1 aprovação**.
- [x] **Dismiss stale pull request approvals when new commits are pushed** — aprovação cai se alguém força commit depois.
- [x] **Require review from Code Owners** — `.github/CODEOWNERS` define os obrigatórios por caminho.
- [x] **Require conversation resolution before merging** — nenhum comment pendente.

### Status checks obrigatórios

Antes de merge, todos estes jobs devem estar verdes:

- [x] `unit-tests` (Vitest + coverage)
- [x] `lint` (ESLint + `tsc --noEmit`)
- [x] `e2e-smoke` (Playwright smoke contra staging ou preview)
- [x] `codeql` (security-scan workflow)
- [x] `gitleaks` (security-scan workflow)

Não-bloqueantes (visíveis mas não gates enquanto estamos estabilizando):

- [ ] `trivy-fs`
- [ ] `license-check`
- [ ] `sbom`
- [ ] `npm-audit`

### Signatures / linear history

- [x] **Require signed commits** — todos os commits assinados com GPG ou SSH.
- [x] **Require linear history** — proibido merge commit tradicional; apenas squash ou rebase.
- [x] **Require deployments to succeed before merging** — deploy de preview precisa estar healthy.

### Restrictions

- [x] **Restrict who can push to matching branches** — apenas `@cabralandre82` e admins.
- [x] **Restrict pushes that create matching branches** — branches protegidas não podem ser recriadas.
- [x] **Do not allow bypassing the above settings** — inclusive admins precisam de PR.
- [x] **Lock branch** → **NO** (permite edição via PR).

### Rewrite / delete

- [ ] **Allow force pushes** → **NO**.
- [ ] **Allow deletions** → **NO**.

---

## Regras ativas em `develop`

Mesmo conjunto, com **2 diferenças**:

1. `Require approvals` → **0** (dev solo). Code Owner review ainda requerido para caminhos sensíveis.
2. `Require linear history` → **NO** (permite merge commits durante desenvolvimento).

Deploy automático via Vercel (branch preview).

---

## Exceções e emergências

Em incidente crítico (P1 ativo em produção), o founder pode:

1. Abrir PR em `main` com label `emergency-bypass`.
2. Anotar no PR: `reason`, `incident-id`, `rollback-plan`.
3. Mergear com 1 aprovação (ou `gh pr merge --admin` em último caso).
4. **Obrigatório:** post-mortem em 72h documentando a exceção.

Toda exceção vira entrada em `docs/execution-log.md` com tag `[EMERGENCY BYPASS]`.

---

## Como aplicar

Via UI: `Settings → Branches → Add classic branch protection rule`. Copiar os checks acima.

Via CLI (`gh`):

```bash
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=unit-tests \
  -f required_status_checks[contexts][]=lint \
  -f required_status_checks[contexts][]=e2e-smoke \
  -f required_status_checks[contexts][]=codeql \
  -f required_status_checks[contexts][]=gitleaks \
  -f enforce_admins=true \
  -f required_pull_request_reviews[dismiss_stale_reviews]=true \
  -f required_pull_request_reviews[require_code_owner_reviews]=true \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f required_linear_history=true \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f required_conversation_resolution=true \
  -f required_signatures=true
```

---

_Última atualização: 2026-04-17 — Wave 0.3._
