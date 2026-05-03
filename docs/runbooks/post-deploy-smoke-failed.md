# Runbook — `post-deploy-smoke-failed`

**Gravidade:** 🔴 P1
**Alerta de origem:** GitHub Actions workflow `Post-Deploy Smoke` (issue automática com label `smoke-fail`)
**SLO:** triage < 10 min · containment < 30 min · resolution < 4 h
**Owner:** solo operator (André)
**Introduzido por:** baseline `v1.0.0-launch-ready` (Trilho C)

---

## 0. Companion skill

Sem skill dedicado. Se o smoke quebrar repetidamente em deploys
diferentes, considerar criar um — provavelmente é regressão sistêmica
(env var, schema drift, RPC removida).

---

## 1. Sintomas observados

- Issue automática no GitHub com título `P1 — post-deploy smoke falhou (<sha>)`.
- Labels: `P1`, `incident`, `smoke-fail`.
- Workflow `Post-Deploy Smoke` em vermelho na actions tab.
- Anexo `post-deploy-smoke-report-<run_id>.zip` contendo o report
  Playwright com screenshots/video do step que falhou.
- Comportamento do app: depende do teste que falhou — ver §4.

---

## 2. Impacto no cliente

- **Usuário final:** **direto** — o golden-path representa o caminho
  crítico (catalog → detalhe → simulador → admin → API). Se quebrou,
  algum buyer ou admin já está vendo erro.
- **B2B:** depende do teste. GP-2.x e GP-4.x afetam clínica/médico
  comprando. GP-3.x afeta super-admin / pharmacy.
- **Compliance:** indireto. Se /api/pricing/preview parou de retornar
  preço, pedidos congelam (sem precificação) — pode atrasar SLA de
  resposta a DSAR se o produto da DSAR está envolvido.
- **Financeiro:** GP-3.2 (cupons) ou GP-4.1 (preview) quebrados podem
  levar a precificação errada. Bloqueie pagamentos novos via kill-switch
  até resolver.

---

## 3. Primeiros 5 minutos (containment)

1. **Confirmar que não é falso-positivo de Vercel ainda promovendo:**

   ```bash
   # O smoke espera 90s antes de rodar, mas se houve fila no Vercel
   # pode ainda estar servindo a versão anterior. Confirme:
   curl -sS https://clinipharma.com.br/api/health/live | jq
   gh run list --workflow=post-deploy-smoke.yml --limit=3
   # Se o curl mostra timestamp recente E o workflow continua falhando,
   # é regressão real, segue para §4.
   ```

2. **Decidir entre fix-forward e rollback** — regra de bolso:
   - O delta entre o último deploy verde e este é **pequeno** (1-3
     arquivos, mudança óbvia)? → **fix-forward** (~10 min).
   - O delta é **grande** (refactor, migration, mudança de env)? →
     **rollback** primeiro, investigar depois.
   - Não tem certeza? → **rollback**. Sempre.

3. **Para rollback:**

   ```bash
   # Listar últimos deploys de prod
   vercel ls clinipharma --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" | head -5
   # Promover deploy anterior conhecido-bom
   vercel promote <dpl_id_anterior> --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
   # Confirmar
   curl -sS https://clinipharma.com.br/api/health/live | jq
   ```

4. **Re-disparar o smoke depois do rollback:**

   ```bash
   gh workflow run post-deploy-smoke.yml -f skip_wait=true
   gh run watch --exit-status
   ```

5. **Não faça** revert do commit em main antes de entender a causa.
   O Vercel vai re-deployar automaticamente o próximo push e você
   pode entrar em loop.

---

## 4. Diagnóstico

### 4.1 — Identificar qual GP-X.Y falhou

Baixe o report Playwright do workflow run:

```bash
gh run download <run_id> --name post-deploy-smoke-report-<run_id>
open playwright-report/index.html
```

Cada teste tem ID estável (`GP-1.1` ... `GP-4.1`). Use o ID para rotear:

| Teste falhando             | Causa típica                                          | Vá para |
| -------------------------- | ----------------------------------------------------- | ------- |
| GP-1.1 / GP-1.2            | Vercel não promoveu, ou app crashou no boot           | §5.A    |
| GP-1.3 (com 401/500)       | `CRON_SECRET` faltando ou /deep quebrado              | §5.B    |
| GP-2.1                     | Catálogo sem produtos (DB vazio?) ou auth quebrada    | §5.C    |
| GP-2.2 (descrição+galeria) | Regressão de layout em `product-detail.tsx`           | §5.D    |
| GP-3.2 (5 coupon types)    | Mig 079 não aplicada OU painel admin regrediu         | §5.E    |
| GP-3.3 (server-logs)       | RBAC quebrado OU /server-logs com erro server-side    | §5.F    |
| GP-4.1 (pricing preview)   | RPC `compute_unit_price` quebrada (típico: mig drift) | §5.G    |

### 4.2 — Comparar contra baseline

```bash
# Ver delta desde o baseline
git log v1.0.0-launch-ready..HEAD --oneline
# Ver mudanças nos arquivos suspeitos (depende do teste que falhou)
git diff v1.0.0-launch-ready..HEAD -- components/catalog/
git diff v1.0.0-launch-ready..HEAD -- supabase/migrations/
```

---

## 5. Mitigação

### 5.A — Vercel não promoveu / app crashou no boot

```bash
vercel logs --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" | head -50
# Se houver erro de boot:
vercel rollback --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

### 5.B — `/api/health/deep` retornando algo diferente de 200/403/503

Provavelmente a feature flag `observability.deep_health` foi enabled
mas a query interna quebrou:

```sql
update public.feature_flags set enabled = false where key = 'observability.deep_health';
```

### 5.C — Catálogo sem produtos OU /catalog redirect inesperado

```sql
-- Confirma se há produtos ativos
select count(*) from public.products where active = true;
-- Se zero, o problema é dado, não código. Provavelmente um RLS
-- quebrou o acesso. Veja docs/runbooks/rls-violation.md.
```

### 5.D — Galeria + descrição (regressão UX)

Edite `components/catalog/product-detail.tsx`. O teste GP-2.2 espera
que `<h2>Descrição completa</h2>` apareça **antes** de
`<h2>Características</h2>` no eixo Y. Veja commit `c2b3f53` para
o estado correto.

### 5.E — Mig 079 ou painel admin de cupons

```bash
# Confirme migration aplicada
psql "$DATABASE_URL" -c "select max(version) from supabase_migrations.schema_migrations;"
# Esperado: >= 079

# Se a migration está mas o select sumiu, o painel mudou
# Veja components/coupons/admin-coupon-panel.tsx, busca por
# id="coupon_discount_type"
```

### 5.F — /server-logs

```bash
# Pode ser RBAC (super-admin sendo redirecionado para /forbidden)
# OU o componente quebrou. Logs:
vercel logs --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" | grep -i "server-logs"
```

### 5.G — /api/pricing/preview retornando 5xx ou ok=true com unit_price=0

Mais provável: schema drift ou a função `compute_unit_price` foi
sobrescrita por uma migration nova com bug. Veja runbook
`pricing-health.md`. Mitigação imediata: kill-switch (não existe um
para tiered ainda — ver Trilho D no `launch-baseline-2026-05-02.md`).

### 5.H — Kill-switch genérico

Não existe kill-switch global do golden-path. Quando criado (Trilho D),
documentar aqui.

---

## 6. Verificação pós-mitigação

- [ ] `gh workflow run post-deploy-smoke.yml -f skip_wait=true` retorna verde.
- [ ] Issue automática `P1 — post-deploy smoke falhou` foi fechada.
- [ ] `synthetic-probe` próximo run também verde.
- [ ] Sentry sem erros novos do mesmo símbolo.

---

## 7. Post-mortem

Obrigatório para qualquer post-deploy-smoke-failed P1. Template:
`.github/ISSUE_TEMPLATE/postmortem.md`. Arquivo final em
`docs/incidents/YYYY-MM-DD-smoke-fail-<curto>.md`.

Capturar especificamente:

- O baseline (`v1.0.0-launch-ready`) cobria essa regressão? Se cobria
  e ainda assim quebrou, **por quê** o baseline não pegou?
- Falta um teste novo? Adicionar a `golden-path.test.ts` (ele é o
  guardião — não delegue pra outro arquivo).
- A regressão poderia ter sido pega no CI antes do merge? Por que
  não foi? Se o teste é flaky no CI mas estável no smoke pós-deploy,
  isso é um sinal de que CI mockou demais.

---

## 8. Prevenção

- **Sempre** atualize `tests/e2e/golden-path.test.ts` quando uma
  feature do baseline mudar de superfície (texto de h1, atributo ID,
  estrutura de URL). Não é overhead — é o motivo do golden-path
  existir.
- Se um teste GP-X.Y começar a flakar, **aborte o quick-fix**. O
  golden-path tem que ser determinístico ou perde valor; trate a
  flakiness antes de adicionar `retries`.
- Para mudanças que **vão** quebrar o golden-path intencionalmente
  (refactor de UX), atualize o teste no MESMO commit que altera o
  componente. Nunca em commits separados.

---

## Links

- Workflow: `.github/workflows/post-deploy-smoke.yml`
- Suite: `tests/e2e/golden-path.test.ts`
- Baseline: `docs/launch-baseline-2026-05-02.md`
- Runbooks relacionados: `health-check-failing.md`, `pricing-health.md`,
  `rls-violation.md`

---

_Template version: 2026-05 · Owner: solo operator + AI agents_
