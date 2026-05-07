# RLS warn-only E2E (T1)

**Última atualização:** 2026-05-06
**Owner:** Solo-ops
**Pre-mortem ref:** Blind spot 5 (RLS leak detectado tarde)
**Suíte:** `tests/e2e/cross-tenant-rls.test.ts`
**Helper:** `tests/e2e/_helpers/rls-findings.ts`

---

## Por que existe

Já temos um **canário SQL diário** em `/api/cron/rls-canary` (mig 055)
que prova, via JWT forjado contra PostgREST, que um sujeito não-afiliado
não vê dados de tenant. Esse canário roda direto na camada de banco e
cobre regressões de policy RLS.

O canário SQL **não cobre** três vetores que esta suíte E2E protege:

1. **Bypass na camada de aplicação** — quando uma rota usa
   `createAdminClient()` (BYPASSRLS) e esquece de validar membership
   manualmente. RLS no banco continua "ok", mas a API vaza dados.
2. **Path-traversal de UUID** — rota `/api/.../[id]` aceita qualquer
   UUID válido e devolve dados de outro tenant via JOIN não-coberto
   ou `.single()` sem guard.
3. **Sessão ausente / cookies inválidos** — endpoints autenticados que
   silenciosamente respondem 200 com payload quando deveriam 401.

Esses três casos são responsáveis pelos vazamentos mais comuns em
produtos B2B com RLS — não são "RLS quebrado", são "RLS contornado".

---

## Como funciona

A suíte tem **três grupos** de teste:

### Parte A — anonymous baseline

Endpoints autenticados (`/api/coupons/mine`, `/api/sessions`,
`/api/profile/notification-preferences`, `/api/admin/coupons`,
`/api/admin/legal-hold/list`, `/api/orders/<uuid>/prescription-state`)
chamados **sem cookies de sessão**. Esperado: 401/403 OU 307→/login
(middleware redireciona).

**Importante**: requests usam `maxRedirects: 0` para enxergar o status
original. Sem isso, Playwright segue o 307 do middleware até `/login`
e recebe 200 com HTML — gera falso positivo `200-empty-payload`.
Validado contra prod 2026-05-07: middleware emite 307 com
`location: /login?next=...` para todas as 6 rotas anon.

Comportamentos e classificação:

| Status  | Body / Header               | Classificação                                                           |
| ------- | --------------------------- | ----------------------------------------------------------------------- |
| 401/403 | qualquer                    | OK                                                                      |
| 307/308 | `location: /login...`       | OK — middleware fez seu trabalho                                        |
| 307/308 | `location` não-`/login`     | warn (redirect inesperado)                                              |
| 200     | `text/html`                 | warn (request seguiu redirect — passe `maxRedirects: 0`)                |
| 200     | `{ <key>: [] }`             | warn (RLS protegeu, mas endpoint não força auth)                        |
| 200     | `{ <key>: [item, …] }`      | **hard fail** — vazamento real                                          |
| 200     | payload concreto (>1 key)   | **hard fail** — vazamento real                                          |
| 200     | body vazio/null/1-key, JSON | warn (status code estranho — `bodyTrunc` registrado nos detalhes)       |
| 5xx     | qualquer                    | warn (endpoint deveria tratar sessão ausente como 4xx; `bodyTrunc` log) |

### Parte B — UUID forjado (super-admin)

SUPER_ADMIN tem visão global por design. Aqui testamos que rotas
`/api/.../[id]` com UUID **inexistente** retornam 404 em vez de 200
com dados aleatórios. Esse caso pega regressões onde a rota faz
`.single()` e devolve sem checar se a row existe.

Coberto:

- `GET /api/orders/<random-uuid>/prescription-state` → 404 esperado
- `GET /api/products/<random-uuid>/recommendations` → 200 com `[]` ou 404 OK; 5xx ou >50 itens = warn
- `GET /api/orders/<malformed-id>/prescription-state` → 4xx esperado, 5xx = warn
- `GET /api/registration/<random-uuid>` → 404/403 esperado, 200 com payload concreto = **hard fail**

### Parte C — cross-session real (clinic A → clinic B)

**Skip graceful** quando faltam credenciais. Quando os dois conjuntos
de credenciais estiverem em CI:

- `E2E_CLINIC_A_EMAIL` / `E2E_CLINIC_A_PASSWORD`
- `E2E_CLINIC_B_EMAIL` / `E2E_CLINIC_B_PASSWORD`

o teste:

1. Loga como A → captura ID de pedido próprio.
2. Abre contexto **limpo**, loga como B.
3. `GET /api/orders/<id-de-A>/prescription-state` autenticado como B.
4. Esperado: 401/403/404. Se 200 → **hard fail** (cross-tenant leak).

---

## Modo warn-only vs hard-fail

Por default, qualquer suspeita vira **warn**:

- `console.warn(...)` no log da run.
- `test.info().annotations.push({ type: 'rls-finding', ... })` —
  destaque amarelo no HTML report do Playwright.

CI **não falha** por warn. A suíte é incluída no smoke test sem
bloquear deploy. A escolha é deliberada para a fase pré-launch:
queremos visibilidade, não freios em casos com fixtures incompletas.

Para virar **hard-fail** (regressão = build vermelho):

```bash
E2E_RLS_HARD_FAIL=true npx playwright test cross-tenant-rls --project=chromium
```

Em CI:

```yaml
env:
  E2E_RLS_HARD_FAIL: 'true'
```

**Quando ligar hard-fail**: assim que tráfego comercial real começar
(mais de 5 clinics ativas com pedidos reais). Antes disso, o ROI de
falsos positivos > sinal real.

### Findings sempre hard, mesmo em warn-only

Algumas situações são severas demais para warn. O helper `recordFinding`
aceita `{ forceHard: true }` para forçar `throw new Error(...)`
independentemente do flag global:

| Cenário                                                 | forceHard? | Razão                                |
| ------------------------------------------------------- | :--------: | ------------------------------------ |
| anon GET retorna 200 com `[item, …]`                    |     ✅     | Vazamento confirmado                 |
| anon GET retorna 200 com payload concreto               |     ✅     | Vazamento confirmado                 |
| super-admin UUID forjado retorna 200 em `/registration` |     ✅     | Path-traversal real                  |
| clinic-B lê pedido de clinic-A                          |     ✅     | Cross-tenant data leak (ANPD-grade)  |
| anon GET retorna 200 com `[]`                           |     ❌     | RLS protegeu — defensável, mas anota |
| 5xx em request anon                                     |     ❌     | Bug de tratamento, não leak          |

Decisão: leak **confirmado** = hard sempre. Sintoma **possível** = warn.

---

## Como rodar

### Local (sem credenciais clinic A/B)

```bash
# Inicia dev server e roda Parte A + B; Parte C pula com skip.
E2E_SUPER_ADMIN_PASSWORD='Trinitron1' \
  npx playwright test cross-tenant-rls --project=chromium
```

### Contra staging

```bash
BASE_URL=https://staging.clinipharma.com.br \
  E2E_SUPER_ADMIN_PASSWORD='Trinitron1' \
  npx playwright test cross-tenant-rls --project=chromium
```

### Modo hard-fail (futuro CI gate)

```bash
E2E_RLS_HARD_FAIL=true \
  E2E_SUPER_ADMIN_PASSWORD='Trinitron1' \
  npx playwright test cross-tenant-rls --project=chromium
```

### Com 2 credenciais clinic (Parte C ativa)

```bash
E2E_SUPER_ADMIN_PASSWORD='...' \
  E2E_CLINIC_A_EMAIL='clinic.a@test.clinipharma.local' \
  E2E_CLINIC_A_PASSWORD='...' \
  E2E_CLINIC_B_EMAIL='clinic.b@test.clinipharma.local' \
  E2E_CLINIC_B_PASSWORD='...' \
  npx playwright test cross-tenant-rls --project=chromium
```

---

## Como ler findings

### No HTML report do Playwright

```bash
npx playwright show-report
```

Cada teste com finding aparece com bandeira amarela. Clicando, vê:

- `rls-mode: warn-only (default)` — modo da run
- `rls-finding/<id>: <descrição> (status=200)` — finding em si

### No console (CI logs)

```text
[rls-finding/anon-coupons-mine-200-empty] 200 com [] em request anônimo — esperado 401, mas RLS protegeu (status=200)
```

O prefixo `[rls-finding/...]` torna grep trivial:

```bash
gh run view <run-id> --log | grep '\[rls-finding'
```

---

## Resposta a finding

### Warn (default)

1. Anote no `docs/execution-log.md` com data + ID do finding.
2. Decida: é falso-positivo (rota legitimamente devolve `[]`) ou hint de problema?
3. Se hint, abra issue + cite o finding ID.

### Hard fail

1. Suíte E2E quebra → CI vermelho.
2. **Pare deploys** até diagnosticar.
3. Use o playbook `docs/runbooks/rls-violation-triage.md` (skill `rls-violation-triage`).
4. Após mitigar, considere se vale **adicionar caso de teste mais
   específico** ao SQL canário ou ao próprio E2E.

---

## Mantendo a suíte

### Adicionando endpoint à Parte A (anon baseline)

Se um novo endpoint `/api/foo` deve exigir auth:

```typescript
test('A7: GET /api/foo sem cookies → 401 ou 307→/login', async ({ request }, testInfo) => {
  annotateRlsMode(testInfo)
  const res = await request.get('/api/foo', { maxRedirects: 0 })
  await assertNoAnonLeak(res, 'anon-foo', testInfo, /* arrayKey */ 'items')
})
```

**Crítico**: passar `{ maxRedirects: 0 }`. O middleware do Next.js
emite 307 com `location: /login?next=...` para rotas privadas anon —
seguir o redirect chega no HTML do login (200) e gera falso positivo.

`arrayKey` é o nome do array no payload normal (ex: `coupons`, `items`).
Quando passado, o helper usa para contar entries → distinguir empty vs leak.

### Adicionando endpoint à Parte B (forged UUID)

Para uma rota nova `/api/widgets/[id]`:

```typescript
test('B5: GET /api/widgets/[random-uuid] → 404 ou empty', async ({ request }, testInfo) => {
  annotateRlsMode(testInfo)
  const res = await request.get(`/api/widgets/${RANDOM_UUID}`)
  await assertForgedUuidIs404(res, 'forged-widgets', testInfo)
})
```

### Decidindo entre warn e hard

Use a heurística: **se o finding aparecer em produção e for verdade,
isso é divulgação de PII ou apenas anomalia de UX?**

- Divulgação de PII → `forceHard: true`.
- Anomalia (ex: 5xx em invalid input) → warn.

---

## Limitações conhecidas

1. **Não cobre POSTs**. Foco é leak de leitura, que é o vetor mais
   comum. POST cross-tenant (escrita em recurso alheio) seria útil
   mas requer fixtures muito mais complexas. Próxima iteração.
2. **Parte C requer 2 clinics provisionadas**. Hoje, sem essas
   credenciais em CI, a parte mais "real" pula. Plano: provisionar
   `clinic.test.a@clinipharma.local` e `clinic.test.b@clinipharma.local`
   no banco staging com pedidos sentinela.
3. **UUIDs hard-coded**. Os UUIDs `99999999-...-9999` são previsíveis.
   Para robustez extra, gerar fresh UUID por run via `crypto.randomUUID()`.
4. **Não testa rate-limit em conjunto com leak**. Plano futuro: variante
   que dispara N requests com UUIDs diferentes para flushear cache de
   rota e simular tentativa de scan.

---

## Histórico

| Data       | Mudança                                                       | Autor    |
| ---------- | ------------------------------------------------------------- | -------- |
| 2026-05-06 | Criação da suíte (T1) — Parte A + B implementadas, C com skip | Solo-ops |
