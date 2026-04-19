# AGENTS.md — credenciais e convenções para agentes

Este arquivo é lido por agentes (Cursor, etc.) **antes** de iniciar
qualquer tarefa. Documenta onde credenciais persistentes vivem e
quais comandos não pedem confirmação humana.

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
- **Projetos visíveis**: `b2b-med-platform`, `clinipharma`,
  `omni-runner-portal`, `project-running`.
- **Projeto vinculado a este repo**: `b2b-med-platform`
  (`.vercel/project.json`).
- **⚠ Topologia importante**: existem **dois projetos Vercel** servindo
  o mesmo branch `main`:
  - `clinipharma` → domínio `clinipharma.com.br` (clientes reais)
  - `b2b-med-platform` → `b2b-med-platform.vercel.app` + branch `staging`
    (usa Supabase de staging em Preview)

  Sempre que adicionar/mudar uma env em **um** deles, replicar no outro
  ou justificar a divergência. Detalhes em
  [`docs/infra/vercel-projects-topology.md`](docs/infra/vercel-projects-topology.md).

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
