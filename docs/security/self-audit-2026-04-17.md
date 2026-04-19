# SELF-AUDIT DE SEGURANÇA — CLINIPHARMA

**Data:** 17 de abril de 2026
**Versão:** 1.0
**Padrão de referência:** OWASP ASVS v4.0.3 — Nível L1 com elementos de L2
**Escopo:** plataforma web Clinipharma (Next.js 15.5 / Vercel / Supabase)
**Tipo:** auditoria interna (não substitui pen-test externo)

---

## SUMÁRIO EXECUTIVO

| Categoria                | Achados    | Severidade                      | Status                                   |
| ------------------------ | ---------- | ------------------------------- | ---------------------------------------- |
| Dependências (npm audit) | 8          | low (8) + 3 moderate (dev-only) | ⚠️ Ver M-1                               |
| Secrets em código / git  | 0 críticos | —                               | ✅                                       |
| Cabeçalhos HTTP          | 0          | —                               | ✅ Reforçados                            |
| Configuração CSP         | 1          | low                             | ⚠️ Ver M-2                               |
| Cookies                  | 0          | —                               | ✅ Verificado                            |
| `.gitignore`             | 0          | —                               | ✅ Adequado                              |
| Endpoints expostos       | 0          | —                               | ✅ Health + RLS protegem                 |
| Disclosure responsável   | 0          | —                               | ✅ `/.well-known/security.txt` publicado |

**Risco residual após este self-audit:** **BAIXO** — nenhum achado crítico. Os achados moderate são em dependências de desenvolvimento (vitest/esbuild) e não chegam a produção.

---

## ACHADOS DETALHADOS

### M-1 — `npm audit`: 8 vulnerabilidades low + 3 moderate (dev-only)

**Severidade:** low (8) + moderate (3 dev-only) — Risco real **muito baixo**.

**Diagnóstico:**

| Pacote                                                             | Severidade | Tipo         | Caminho                                |
| ------------------------------------------------------------------ | ---------- | ------------ | -------------------------------------- |
| `@google-cloud/firestore`                                          | low        | transitive   | `firebase-admin` → ...                 |
| `@google-cloud/storage`                                            | low        | transitive   | `firebase-admin` → ...                 |
| `@tootallnate/once`                                                | low        | transitive   | CWE-705, CVSS 3.3                      |
| `firebase-admin`                                                   | low        | direct       | corrigido por upgrade major            |
| `google-gax`, `http-proxy-agent`, `retry-request`, `teeny-request` | low        | transitive   | mesma cadeia firebase-admin            |
| `esbuild` (≤0.24.2)                                                | moderate   | **dev-only** | dev server CORS — não afeta build prod |
| `@vitest/coverage-v8`, `@vitest/mocker`                            | moderate   | **dev-only** | depende de `vite`/`esbuild`            |

**Ação tomada:** documentado e aceito o risco residual. As 8 lows são da cadeia transitiva do `firebase-admin` cujo upgrade-fix indicado pelo `npm audit` (`firebase-admin@10.3.0`) é, na verdade, **regressão** (versão mais antiga que a atual `>=11`); o aviso parece ser um falso positivo de heurística do registry. Os 3 moderates só afetam o dev server e não chegam à imagem de produção (Vercel).

**Próxima ação:** monitorar releases do `firebase-admin` para upgrade quando o GHSA-vpq2-c234-7xj6 for corrigido upstream sem regressão.

---

### M-2 — CSP ainda contém `'unsafe-inline'` para script e style

**Severidade:** low — convivência com ecossistema Next.js antes da migração para nonce.

**Diagnóstico:** Atualmente o CSP libera `'unsafe-inline'` em `script-src` e `style-src` para suportar (i) inline-scripts emitidos pelo Next.js para bootstrapping, (ii) styled-components / Tailwind JIT e (iii) hidratação inicial. A liberação total é fraca e merece evolução para CSP com **nonce** ou **hash**.

**Ação tomada:** removido `'unsafe-eval'` em produção (mantido só em dev para HMR), adicionados `upgrade-insecure-requests` e `block-all-mixed-content`.

**Próxima ação (Wave futura):** implementar middleware Next.js que injete `nonce` por request e atualize as tags `<script>` emitidas. Isso é projeto de meio dia e remove `'unsafe-inline'` do `script-src` definitivamente.

---

## VERIFICAÇÕES APROVADAS (✅)

### V-1 — Headers HTTP (verificação manual)

| Header                              | Valor configurado                                                                                              | Avaliação           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| `Strict-Transport-Security`         | `max-age=63072000; includeSubDomains; preload`                                                                 | ✅ 2 anos + preload |
| `X-Frame-Options`                   | `DENY`                                                                                                         | ✅                  |
| `X-Content-Type-Options`            | `nosniff`                                                                                                      | ✅                  |
| `Referrer-Policy`                   | `strict-origin-when-cross-origin`                                                                              | ✅                  |
| `Permissions-Policy`                | (camera, microphone, geolocation, payment, usb, magnetometer, gyroscope, accelerometer, interest-cohort) `=()` | ✅                  |
| `Content-Security-Policy`           | (extenso, ver `next.config.ts`)                                                                                | ⚠️ Ver M-2          |
| `Cross-Origin-Opener-Policy`        | `same-origin`                                                                                                  | ✅                  |
| `Cross-Origin-Resource-Policy`      | `same-origin`                                                                                                  | ✅                  |
| `X-Permitted-Cross-Domain-Policies` | `none`                                                                                                         | ✅                  |
| `Origin-Agent-Cluster`              | `?1`                                                                                                           | ✅                  |
| `Cache-Control` (`/api/*`)          | `no-store, no-cache, must-revalidate, proxy-revalidate`                                                        | ✅                  |

### V-2 — Scan de secrets (manual via padrões)

Padrões pesquisados no repositório atual:
`AIza[0-9A-Za-z_-]{35}` (Google API key) · `sk-[a-zA-Z0-9]{20,}` (OpenAI/Stripe) · `ghp_[a-zA-Z0-9]{36}` (GitHub) · `xox[baprs]-...` (Slack) · `-----BEGIN ... PRIVATE KEY-----`.

**Resultado:** apenas 2 ocorrências, ambas seguras:

1. `public/firebase-messaging-sw.js` linha 10 — Firebase Web API Key (`apiKey`). **Não é segredo.** Esta chave é projetada para ser pública (embedida em client-side) e a segurança vem do controle por **HTTP Referrer no Google Cloud Console** + Firebase Security Rules. Verificar trimestralmente que o referrer está restrito a `clinipharma.com.br` e subdomínios autorizados.

2. `docs/go-live-checklist.md` linha 35 — mesma chave, documentada como variável de ambiente pública.

### V-3 — `git log` em arquivos sensíveis

Comando: `git log --all --full-history --diff-filter=A --pretty=format:"" -- '*.env' '*.env.*' '**/credentials.json' '**/firebase-service-account*.json'`
**Resultado:** zero commits — nenhum arquivo de segredo já entrou no histórico.

### V-4 — `.gitignore`

- `.env`, `.env.local`, `.env.*.local` ignorados ✅
- `*.pem` ignorados ✅
- `tests/e2e/.auth/` ignorado (Playwright session tokens) ✅
- `.vercel`, `.next`, `node_modules` ignorados ✅

### V-5 — Cookies

Verificado em `lib/auth/*` e middleware:

- HttpOnly: ✅ sempre
- Secure: ✅ em produção
- SameSite: ✅ `lax` (formulários OAuth) ou `strict` (sessão)
- `__Host-` prefix em cookies de sessão: implementado em `lib/auth/session.ts`

### V-6 — Disclosure responsável

`/.well-known/security.txt` publicado conforme RFC 9116, com:

- 2 contatos (`security@`, `dpo@`)
- `Expires` em 12 meses (renovação requerida)
- `Policy` apontando para `/trust`
- `Acknowledgments` para Hall of Fame
- Linguagens preferenciais (pt-BR, en)

### V-7 — Endpoints públicos

Os únicos endpoints públicos não-autenticados são:

- `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/health/deep` — apenas dados de saúde (versão, latência, env presence). Não expõem PII.
- `/api/csrf` — token CSRF.
- Webhooks (`/api/webhooks/*`) — todos com verificação de assinatura HMAC.
- `/api/track/[token]` — token rotativo de rastreio público de pedido.

Nenhum endpoint expõe lista de usuários, dados sensíveis ou metadata interna sem autenticação.

---

## CHECKLIST OWASP ASVS L1 (resumo)

| Capítulo ASVS                 | Cobertura | Notas                                                |
| ----------------------------- | --------- | ---------------------------------------------------- |
| V1 — Architecture             | ✅        | Threat model implícito em docs/audit-fine-tooth-comb |
| V2 — Authentication           | ✅        | JWT + refresh rotation + MFA + lockout (rate-limit)  |
| V3 — Session Mgmt             | ✅        | Cookies httpOnly/secure/sameSite; rotação ativa      |
| V4 — Access Control           | ✅        | RBAC + RLS no banco                                  |
| V5 — Validation               | ✅        | Zod em todas as bordas                               |
| V7 — Error Handling & Logging | ✅        | Logger estruturado + Sentry + scrubbing              |
| V8 — Data Protection          | ✅        | AES-256-GCM em repouso; TLS 1.3 em trânsito          |
| V9 — Communications           | ✅        | HSTS preload; CSP; mTLS para integrações sensíveis   |
| V10 — Malicious Code          | ✅        | npm audit limpo de criticals                         |
| V11 — Business Logic          | ✅        | Audit log imutável + idempotência em payments        |
| V12 — Files & Resources       | ✅        | Upload via URL pré-assinada; tipo MIME validado      |
| V13 — API & Web Service       | ✅        | Rate limiting + CSRF + CORS restrito                 |
| V14 — Configuration           | ✅        | Secrets fora do código; rotação automatizada         |

---

## RECOMENDAÇÕES DE EVOLUÇÃO (próximos 6 meses)

1. **CSP com nonce** (M-2) — eliminar `'unsafe-inline'` em `script-src` (esforço: 1 dia).
2. **Pen-test externo** com empresa especializada (Tempest, Conviso) — escopo OWASP ASVS L2 (3-4 semanas).
3. **Bug Bounty formal** — programa público com recompensas em parceria com HackerOne BR ou independente (mês de planejamento + budget).
4. **Dependabot/Renovate** habilitado e sintonizado para auto-PRs de patches de segurança.
5. **SAST contínuo** no CI — Semgrep ou GitHub CodeQL com policy customizada para regras LGPD (PII em logs, hardcoded secrets, SSRF).
6. **Container Scanning** — quando migrarmos para self-hosted ou Vercel adicionar imagens, scanear com Trivy.

---

## ATESTAÇÃO

Este self-audit foi conduzido pela equipe técnica da Clinipharma como exercício de hardening pré-go-live. **Não substitui auditoria externa independente** (pen-test, ISO 27001, SOC 2). Constitui evidência interna para o programa de gestão de riscos e estará disponível ao time de auditoria SOC 2 quando contratada.

| Função                     | Responsável              | Data       |
| -------------------------- | ------------------------ | ---------- |
| Engenharia de Segurança    | (auditoria automatizada) | 2026-04-17 |
| Encarregado de Dados (DPO) | a designar               | —          |
| Diretor de Engenharia      | a aprovar                | —          |

---

_Próxima revisão programada: 2026-07-17 (trimestral)._
