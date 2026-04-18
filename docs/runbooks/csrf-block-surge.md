# Runbook — Spike de `csrf_blocked` após Wave 5

**Gravidade:** P2 (degradação — clientes legítimos recebendo 403).
**Escopo:** qualquer `/api/**` atrás do middleware (`middleware.ts`) com método `POST`/`PUT`/`PATCH`/`DELETE`.

---

## 1. Sintomas observados

Qualquer um configura incidente:

- Logs `csrf_blocked` em `logger` com `reason=origin_missing|origin_mismatch|token_missing|token_mismatch` > **20/min** sustentado.
- Grafana / painel Vercel Functions: aumento súbito de 403 em `/api/**` (excluindo webhooks e cron, que são exempt).
- Relatos de usuários: "não consigo salvar", "botão não funciona", "Erro desconhecido" em toasts genéricos.
- Clientes nativos (app mobile, desktop wrapper) perdendo acesso à API.

## 2. Impacto no cliente

- Clientes via browser em abas-dormidas podem perder o cookie `__Host-csrf` (flag double-submit ligada) → precisa reload.
- Clientes externos (parceiros, integrações) que chamam a API sem `Origin` nem `Referer` são bloqueados.
- **Webhooks (Asaas, Clicksign), Inngest e cron não são afetados** — estão na lista de exempt prefixes em `lib/security/csrf.ts`.

## 3. Primeiros 5 minutos — containment

**Opção A — rollback do double-submit (imediato, sem deploy):**

Se o spike começou logo após ligar `CSRF_ENFORCE_DOUBLE_SUBMIT=true` em Vercel, volte para `false`:

```bash
vercel env rm CSRF_ENFORCE_DOUBLE_SUBMIT production
vercel env add CSRF_ENFORCE_DOUBLE_SUBMIT production   # valor: false
vercel redeploy  # ou aguardar próximo push
```

O Origin check continua ligado por padrão; só o tier de token some. Deve drenar os denies do tipo `token_*` em < 60 s após o redeploy.

**Opção B — rollback completo do middleware CSRF (quando Origin check também está bloqueando):**

Abra PR de revert do commit W5 `feat(wave-5): csrf + hmac + safe-redirect`. Aprovação humana + merge + deploy (~5 min). Mantém o restante de W5 (HMAC, safe-redirect) intacto se necessário — o CSRF block pode ser neutralizado removendo a seção marcada `Wave 5 — CSRF gate` do `middleware.ts`.

**Opção C — allowlist de origem extra (quando o cliente legítimo tem Origin diferente):**

Exemplo: um domínio de staging ou app mobile com webview customizado envia Origin `https://native-app.clinipharma.com.br`:

```bash
vercel env add ALLOWED_ORIGINS production  # valor: https://native-app.clinipharma.com.br
vercel redeploy
```

`ALLOWED_ORIGINS` aceita lista separada por vírgula.

## 4. Diagnóstico (primeiros 30 min)

### 4.1. Quem está sendo bloqueado

Top por `reason` nas últimas 2 h:

```sql
SELECT
  payload ->> 'reason'  AS reason,
  count(*)              AS hits,
  count(DISTINCT payload ->> 'path') AS distinct_paths
FROM public.server_logs
WHERE level = 'warn'
  AND message = 'csrf_blocked'
  AND created_at > now() - interval '2 hours'
GROUP BY 1
ORDER BY hits DESC;
```

### 4.2. Top paths afetados

```sql
SELECT
  payload ->> 'path' AS path,
  payload ->> 'method' AS method,
  count(*) AS hits
FROM public.server_logs
WHERE message = 'csrf_blocked'
  AND created_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY hits DESC
LIMIT 20;
```

### 4.3. Origem suspeita (referer/origin)

```sql
SELECT
  payload ->> 'details' AS details,
  count(*) AS hits
FROM public.server_logs
WHERE message = 'csrf_blocked'
  AND payload ->> 'reason' = 'origin_mismatch'
  AND created_at > now() - interval '1 hour'
GROUP BY 1
ORDER BY hits DESC
LIMIT 10;
```

Se o `details` aponta um Origin legítimo (ex.: novo preview deploy), siga a Opção C. Se aponta domínios desconhecidos, é _ataque real_ bloqueado com sucesso — não escalar, mas documentar.

### 4.4. Double-submit — diff cookie vs header

Se `reason = token_mismatch` predominar, a causa mais comum é SameSite impedindo a criação do cookie na primeira navegação. Verifique:

```sql
-- Quantos pedidos chegam SEM cookie __Host-csrf (diagnóstico indireto)
SELECT
  count(*) AS sem_cookie,
  count(*) FILTER (WHERE payload ->> 'reason' = 'token_missing') AS token_missing
FROM public.server_logs
WHERE message = 'csrf_blocked'
  AND created_at > now() - interval '1 hour';
```

Outra causa: clientes bloqueiam cookies de third-party (Safari ITP em iframes). Para app embutido, Opção A resolve.

## 5. Mitigação sem rollback

### 5.1. Adicionar um path exempto

Se um endpoint _legítimo_ precisa receber requisições sem cookie (webhook novo, callback externo), adicione ao `CSRF_EXEMPT_PREFIXES` em `lib/security/csrf.ts`, testes + PR normal:

```ts
const CSRF_EXEMPT_PREFIXES = [
  '/api/payments/asaas/webhook',
  '/api/contracts/webhook',
  '/api/inngest',
  '/api/cron/',
  '/api/tracking',
  '/api/health',
  '/api/partners/new-callback', // ← novo, autentique por outro meio!
]
```

**Atenção:** qualquer endpoint que entre nessa lista PRECISA ter mecanismo próprio (HMAC, token estático comparado via `safeEqualString`, mTLS etc.). Não adicione por preguiça.

### 5.2. Frontend esqueceu de enviar o header

Cliente JS próprio deve ler `document.cookie` e ecoar:

```ts
const token = document.cookie.match(/(?:^|; )(?:__Host-csrf|csrf-token)=([^;]+)/)?.[1] ?? ''
await fetch('/api/orders', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json', 'x-csrf-token': token },
  body: JSON.stringify(payload),
})
```

Lib helper recomendada (Wave 6): `lib/security/client-csrf.ts` — já ficará pronta junto com o painel admin em W6.

## 6. Falso positivo — quando NÃO rollback

- **Scanners automatizados** (gitleaks, zap baseline) chegam sem Origin → 403. Esperado. Apenas ignore no SOC.
- **Requests de curl/postman** em staging — `--header 'origin: https://staging.clinipharma.com.br'` resolve.
- **Cron externos** que chamem `/api/**` fora da lista — corretamente bloqueados; escale para revisar integração.

## 7. Pós-incidente

1. Exportar contagem por `reason` nas últimas 24 h (query §4.1) para o postmortem.
2. Se o incidente envolveu Opção B (revert de middleware), agendar re-merge com testes adicionais.
3. Atualizar `docs/execution-log.md` seção "Incidentes / Rollbacks".
4. Se a causa foi falta de Origin header em cliente legítimo, abrir follow-up em `docs/audit-fine-tooth-comb-2026-04.md` lente 04 (perímetro).

## 8. Links úteis

- Código: `middleware.ts` (§82-99) + `lib/security/csrf.ts`
- Testes: `tests/unit/lib/security-csrf.test.ts`, `tests/e2e/smoke-security-attack.test.ts`
- Feature flag DB: `SELECT * FROM public.feature_flags WHERE key = 'security.csrf_enforce'`
- Env Vercel: `CSRF_ENFORCE_DOUBLE_SUBMIT`, `ALLOWED_ORIGINS`
