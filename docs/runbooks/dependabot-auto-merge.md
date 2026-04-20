# Runbook — Dependabot auto-merge

**Gravidade:** 🟢 N/A (este não é um runbook de incidente — é a política
operacional do loop de dependências). Eventualmente escalado para 🔴 P1 se
uma dep auto-merged introduziu regressão em produção (ver §8).
**Owner:** solo operator.
**Cadência:** a cada PR do Dependabot (segunda 06:00 BRT pela config atual).

> **Por que existe:** o solo operator recebe ~8-15 PRs do Dependabot por mês.
> Triar cada um manualmente é trabalho que não volta. A plataforma já tem
> camadas defensivas o bastante para delegar o safe-case para automação.

---

## 1. Filosofia

Auto-merge não é "mergear porque o bot pediu". Auto-merge é: **o CI é o
juiz; nós só delegamos a decisão de apertar o botão**. Se qualquer gate
reprova (unit test, lint, tsc, Playwright a11y, CodeQL, Gitleaks, npm audit,
Trivy, license-check), o PR simplesmente não merge — fica vermelho como
qualquer outro PR.

A regra operacional é conservadora assimetricamente:

- **Erramos para o lado de _não_ auto-merge** quando há risco de nova
  superfície (minor em prod dependency = novo código, pode introduzir
  bug lógico que testes automáticos não pegam).
- **Erramos para o lado de _auto-merge_** quando o risco é praticamente
  nulo (patch de devDep, bump de GitHub Action).

Essa assimetria foi calibrada em cima das camadas defensivas existentes.
Se reduzirmos alguma camada (ex.: remover mutation test), revisitamos
esta política.

---

## 2. Decisão: quem entra, quem espera

| Ecosystem        | Dependency type      | Update type   | Decisão        | Racional                                                          |
| ---------------- | -------------------- | ------------- | -------------- | ----------------------------------------------------------------- |
| `npm`            | `direct:development` | patch + minor | **auto-merge** | devDeps não vão para produção; risco = CI lento, não app quebrado |
| `npm`            | `indirect`           | patch + minor | **auto-merge** | transitivas já passaram por CI + `npm audit`                      |
| `npm`            | `direct:production`  | patch         | **auto-merge** | bug-fix-only por convenção semver                                 |
| `npm`            | `direct:production`  | minor         | manual         | nova feature = nova surface; revisar CHANGELOG                    |
| `npm`            | `*`                  | major         | manual         | breaking changes quase garantidos                                 |
| `github_actions` | qualquer             | patch + minor | **auto-merge** | actions pinadas por SHA continuam imutáveis; bump é informacional |
| `github_actions` | qualquer             | major         | manual         | pode mudar runner / inputs                                        |

**Updates de segurança (security advisories):** não têm classe própria aqui
— seguem o mesmo matrix. A lógica é: CI roda `npm audit --audit-level=high`
e Trivy em todo PR. Se a própria alert não foi mitigada, o CI fica vermelho.
Se foi, o merge é seguro.

**Excepciones codificadas no `dependabot.yml`:** `react`, `react-dom`, e
`next` têm majors ignorados completamente (exigem playbook de upgrade
dedicado). Verifique `.github/dependabot.yml` para a lista autoritativa.

---

## 3. Como funciona tecnicamente

```
Dependabot abre PR
      ↓
pull_request_target event → dispatch dependabot-auto-merge.yml
      ↓
dependabot/fetch-metadata classifica o PR
      ↓
Decision matrix (§2)
      ↓
eligible?
 ├── não → gh pr comment "não auto-merge: <razão>" + para aqui
 └── sim → gh pr review --approve
           + gh pr merge --auto --squash --delete-branch
      ↓
GitHub native auto-merge espera todos os required checks
      ↓
CI verde → merge + branch deletada
CI vermelho → PR fica aberto, notificação para o operator triar
```

Arquivos relevantes:

- [`.github/workflows/dependabot-auto-merge.yml`](../../.github/workflows/dependabot-auto-merge.yml) — workflow que decide e aciona merge
- [`.github/dependabot.yml`](../../.github/dependabot.yml) — config das updates (schedule, grouping, ignore list)
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — unit + lint + e2e (gates)
- [`.github/workflows/security-scan.yml`](../../.github/workflows/security-scan.yml) — CodeQL + Gitleaks + npm audit + Trivy + license + SBOM (gates)

---

## 4. Kill-switches (ordem de escalada)

Do mais granular ao mais drástico:

### 4.1 — Label `do-not-auto-merge` no PR individual

Operador não confia num PR específico mas quer deixar as outras automações
rodando. Adicionar a label via UI ou:

```bash
gh pr edit <PR_NUMBER> --add-label do-not-auto-merge
```

Workflow sai cedo no próximo evento. Nenhuma outra PR do Dependabot é
afetada.

### 4.2 — Desabilitar o workflow (temporário)

Pausar auto-merge para todas as PRs, sem apagar o arquivo:

```
GitHub → Actions → Dependabot auto-merge → Disable workflow
```

PRs do Dependabot continuam sendo criadas; o operator triará manualmente.

### 4.3 — Remover o workflow (reversão permanente)

```bash
rm .github/workflows/dependabot-auto-merge.yml
```

Estado volta ao anterior (tudo manual). Uma linha de mudança, fácil de
reverter se preciso.

---

## 5. Pré-requisitos do repositório

Para o workflow funcionar:

- [ ] **Settings → General → Pull Requests → Allow auto-merge:** ON
- [ ] **Settings → Actions → General → Workflow permissions:** Read and write
      (ou "Read repository contents and packages" com custom permissions;
      o workflow já declara `permissions:` explicitamente então esse toggle
      apenas precisa permitir que a declaração tenha efeito).
- [ ] **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests:** ON
      (necessário para o step "Approve the PR").
- [ ] **Branch protection em `main`** (opcional mas recomendado):
      exigir pelo menos "CI / Unit Tests" e "CI / Lint & Type Check" antes
      de merge. Sem branch protection, `--auto` ainda espera, mas com
      protection a garantia é auditável.

Se algum desses não estiver ligado, o workflow reporta um `::warning::` no
step summary e o PR fica pendente até você habilitar. Não falha a run.

---

## 6. Observação operacional

### 6.1 — Visibilidade

Ver quantos auto-merges aconteceram esta semana:

```bash
gh pr list \
  --state merged \
  --author app/dependabot \
  --search "merged:>=$(date -u -d '-7 days' +%F)" \
  --limit 50 \
  --json number,title,mergedAt,url
```

Ver PRs pendentes com o comentário de rejeição (classe manual):

```bash
gh pr list \
  --state open \
  --author app/dependabot \
  --json number,title,labels \
  --jq '.[] | select(.labels[].name | contains("do-not-auto-merge") | not) | "#\(.number) — \(.title)"'
```

### 6.2 — Ritual semanal (segunda de manhã)

Ver [`docs/SOLO_OPERATOR.md`](../SOLO_OPERATOR.md) §2 "Weekly". Checklist:

- [ ] Dependabot PRs abertas > 7 dias? Por quê não mergearam? (CI vermelho? Classe manual não triada?)
- [ ] `do-not-auto-merge` PRs? Ainda bloqueadas por motivo legítimo?
- [ ] Auto-merges da semana passada introduziram regressão? (olhar Sentry para erros surgidos pós-merge)

Tempo estimado: **5-10 min** vs ~30-60 min de triagem manual.

---

## 7. Anti-patterns

- **Nunca desligue um gate de CI pra fazer um auto-merge passar.** Se CI
  está vermelho, o propósito da automação é preservar essa proteção.
- **Nunca classifique uma dep de `production` manual como `development`**
  só pra entrar no auto-merge. O custo (1-2 min de triagem) é trivial.
- **Nunca aprove auto-merge pra dep com CVE HIGH/CRITICAL ainda não
  mitigada no upstream.** O CI deve pegar via `npm audit`; se passou, é
  porque o upstream já corrigiu. Mas revise se o bump de versão realmente
  remove o advisory.
- **Nunca cubra o kill-switch "com fita adesiva".** Se uma PR exigiu
  intervenção manual 3 vezes na mesma semana, revisite a classe: talvez
  deva ser sempre manual (ajuste este runbook + workflow).

---

## 8. Se uma auto-merge causou regressão

Aconteceu: uma dep foi auto-merged, CI verde, mas um bug apareceu em
produção dias depois. Processo:

1. **Revert imediato** via Vercel (não mexer em git primeiro — precisamos
   do app de pé):
   ```bash
   vercel rollback <previous-deployment-url> --token="$VERCEL_TOKEN"
   ```
2. **Abrir issue P1** com label `incident` + `auto-merge-regression`.
3. **Identificar o PR culpado:** `git log --merges --author='dependabot' -n 20`.
4. **Revert do commit no git:**
   ```bash
   git revert <merge-commit-sha> --mainline 1
   ```
5. **Pin a versão problemática no `package.json` ou `dependabot.yml` ignore
   list** para evitar re-ocorrência antes da root cause.
6. **Post-mortem** ([`.github/ISSUE_TEMPLATE/postmortem.md`](../../.github/ISSUE_TEMPLATE/postmortem.md)).
   Pergunta central: _por que o CI não pegou?_ Resposta vira action item
   (adicionar teste de regressão específico).
7. **Revisar a classe que deixou passar.** Se foi `direct:production` patch
   que introduziu breaking, talvez patch também precise ser manual — ajuste
   o matrix em §2 e o workflow.

**Histórico de regressões:** nenhuma ainda. Registre aqui a primeira quando
acontecer, com link para o post-mortem.

---

## 9. Change log

| Data       | Mudança                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 2026-04-20 | Criação inicial. Auto-merge habilitado para devDeps patch+minor, prodDeps patch, actions patch+minor. |

---

## Links

- [`.github/workflows/dependabot-auto-merge.yml`](../../.github/workflows/dependabot-auto-merge.yml)
- [`.github/dependabot.yml`](../../.github/dependabot.yml)
- [`docs/SOLO_OPERATOR.md`](../SOLO_OPERATOR.md) §3 "Automated loops"
- [GitHub docs — Automating Dependabot with GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions)
- [Dependabot fetch-metadata action](https://github.com/dependabot/fetch-metadata)

---

_Owner: solo operator · Última revisão: 2026-04-20_
