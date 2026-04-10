# Clinipharma — Roadmap para 90+ pontos por camada

> **Objetivo:** Atingir ≥ 90/100 em cada uma das 9 camadas arquiteturais.
> **Baseline:** Avaliação de 2026-04-08 (score geral 61/100).
> **Restrição documentada:** NF-e, WhatsApp Business API, Asaas produção e integração formal ANVISA bloqueados até obtenção de CNPJ, certificado digital e número de telefone empresarial.

---

## Scores: Baseline → Sem CNPJ → Com CNPJ

| #   | Camada            | Baseline | Teto sem CNPJ | Teto com CNPJ | Meta       |
| --- | ----------------- | -------- | ------------- | ------------- | ---------- |
| 1   | Apresentação      | 72       | 92            | 92            | 90 ✅      |
| 2   | API Gateway       | 38       | 90            | 90            | 90 ✅      |
| 3   | Segurança         | 70       | 92            | 92            | 90 ✅      |
| 4   | Lógica de Negócio | 65       | 90            | 90            | 90 ✅      |
| 5   | Financeiro        | 32       | 68            | 93            | 90 🔒 CNPJ |
| 6   | Dados             | 60       | 92            | 92            | 90 ✅      |
| 7   | Infraestrutura    | 55       | 90            | 90            | 90 ✅      |
| 8   | Observabilidade   | 50       | 91            | 91            | 90 ✅      |
| 9   | Conformidade      | 28       | 72            | 93            | 90 🔒 CNPJ |

🔒 = bloqueado parcialmente até CNPJ disponível

---

## Bloco A — Executável agora (sem CNPJ)

### Semana 1–2: Segurança Crítica

#### A1 — Session Revocation (Camadas 3 e 6)

**Problema:** JWT stateless sem revogação. Usuário banido continua com acesso por até 1h.
**Risco:** Funcionário demitido de clínica/farmácia mantém acesso a dados sensíveis (LGPD Art. 46).

- [x] Migration `021_revoked_tokens.sql`: tabela `revoked_tokens(jti, user_id, revoked_at, expires_at)`
- [x] `lib/token-revocation.ts`: `revokeToken(jti, userId, expiresAt)`, `revokeAllUserTokens()`, `isTokenRevoked()`, `purgeExpiredTokens()`
- [x] Atualizar `middleware.ts`: checar blacklist a cada request autenticado + `X-Request-ID`
- [x] Atualizar `services/users.ts` → `deactivateUser()`: revogar todos os tokens ativos do usuário
- [x] Atualizar `services/users.ts` → `assignUserRole()`: revogar tokens ao trocar papel
- [x] Cron `/api/cron/purge-revoked-tokens` (diário 03h UTC): limpar tokens expirados da tabela
- [x] Testes: mock adicionado em `users.test.ts`

**Esforço:** 3 dias | **Status:** ✅ concluído (2026-04-08)

---

#### A2 — Security Headers (Camada 3)

**Problema:** Sem CSP, HSTS, X-Frame-Options. Vetores de ataque XSS/clickjacking abertos.

- [x] `next.config.ts`: headers de segurança em todas as rotas (`CSP`, `HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`)
- [ ] Cloudflare WAF: ativar OWASP Core Ruleset + rate limit 100 req/min por IP em `/api/`

**Esforço:** 1 dia | **Status:** ✅ headers implementados (2026-04-08) | ⬜ Cloudflare WAF pendente (manual)

---

#### A3 — Circuit Breaker para Serviços Externos (Camada 2)

**Problema:** Falha em Asaas, Clicksign ou Resend propaga erro para o usuário sem degradação graciosa.

- [x] `lib/circuit-breaker.ts`: estados CLOSED → OPEN → HALF_OPEN (3 falhas → OPEN, 30s → HALF_OPEN)
- [x] Envolvidos: `lib/asaas.ts`, `lib/clicksign.ts`
- [x] Alerta Sentry quando circuito abre
- [x] `GET /api/health`: expõe estado de todos os circuits
- [ ] Envolver também: `lib/email/index.ts`, `lib/sms.ts`, `lib/whatsapp.ts`
- [ ] Testes unitários para os 3 estados

**Esforço:** 4 dias | **Status:** ✅ core implementado (2026-04-08) | ⬜ email/sms pendente

---

### Semana 3–4: API e Compliance

#### A4 — API Versioning + Resposta Padronizada (Camada 2)

**Problema:** Sem versioning (`/api/v1/`), sem shape consistente, sem `X-Request-ID`.

- [x] `lib/api-response.ts`: `apiSuccess()`, `apiError()`, `ApiErrors` factory com erros comuns
- [x] `middleware.ts`: gera e propaga `X-Request-ID` em todos os responses
- [x] `next.config.ts`: rewrites de `/api/v1/*` → `/api/*` para compatibilidade futura
- [ ] Aplicar `apiSuccess`/`apiError` progressivamente em todas as rotas (em andamento — aplicar por área conforme features novas)
- [ ] Documentação interna OpenAPI via `zod-to-openapi`

**Esforço:** 3 dias | **Status:** ✅ concluído (2026-04-08) — rewrites ativos | ⬜ aplicação progressiva em andamento

---

#### A5 — Validação CNPJ + Compliance Engine (Camada 4)

**Problema:** Farmácias são aprovadas manualmente sem checar se CNPJ está ativo. Sem revalidação periódica.

- [x] `lib/compliance.ts`: `validateCNPJ()` (ReceitaWS, fail-open em timeout/rate-limit), `canPlaceOrder()`, `canAcceptOrder()`
- [x] Migration 022: `cnpj_validated_at` + `cnpj_situation` em `pharmacies` com índice partial
- [x] Cron `/api/cron/revalidate-pharmacies` (segunda 06h UTC): suspende + notifica SUPER_ADMIN
- [x] `services/pharmacies.ts`: `validateCNPJ()` em `createPharmacy()` e `updatePharmacyStatus('ACTIVE')` — falha com mensagem clara se CNPJ inativo
- [x] `services/orders.ts`: `canPlaceOrder()` antes de criar pedido — bloqueia pedido se clínica/farmácia inativa ou CNPJ irregular
- [x] Testes unitários em `tests/unit/lib/compliance.test.ts`

**Esforço:** 5 dias | **Status:** ✅ concluído (2026-04-08)

---

### Semana 5–6: Infraestrutura

#### A6 — Background Jobs com Inngest (Camada 7)

**Problema:** Exports, emails em lote e webhooks complexos rodam em serverless com limite de 10s.

- [x] Instalar e configurar Inngest v4 (free tier)
- [x] `lib/inngest.ts`: client + event type registry (`ExportOrdersEvent`, `StaleOrdersEvent`, `AsaasWebhookEvent`)
- [x] `app/api/inngest/route.ts`: serve endpoint (GET/POST/PUT) com todos os jobs registrados
- [x] Mover para Inngest:
  - [x] Export CSV (`lib/jobs/export-orders.ts`) — sem timeout, com email de resultado
  - [x] Stale orders notifications (`lib/jobs/stale-orders.ts`) — com retry 3x
  - [x] Webhook Asaas payment confirmed (`lib/jobs/asaas-webhook.ts`) — webhook retorna 200 imediatamente, processa em background
- [ ] Configurar `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` no Vercel (exige conta Inngest criada)
- [ ] Testes de jobs com Inngest Dev Server (pós-conta criada)

**Pendente externo:** Criar conta em [inngest.com](https://app.inngest.com/sign-up) (free tier), copiar `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` e adicionar no Vercel.

**Esforço:** 4 dias | **Status:** ✅ implementado (2026-04-08) | ⬜ ativar após conta Inngest

---

#### A7 — Staging Environment Dedicado (Camada 7)

**Problema:** Sem ambiente de staging isolado. Testes de integração afetam produção.

- [x] Documentar política de staging em `docs/staging-environment.md`
- [x] Documentar branch strategy: `feature/* → staging → main`
- [x] Documentar variáveis de ambiente de staging + seed de dados
- [ ] Criar projeto Supabase `clinipharma-staging` (ação manual — exige conta Supabase)
- [ ] Configurar deploy automático branch `staging` no Vercel (ação manual)
- [ ] Criar branch `staging` no repositório e rodar seed

**Esforço:** 2 dias | **Status:** ✅ documentado (2026-04-08) | ⬜ provisionamento pendente

---

#### A8 — Load Testing (Camada 7)

**Problema:** Sem baseline de performance documentado. Capacidade desconhecida.

- [x] Definir SLOs: `p95 < 800ms`, `p99 < 2s`, `error rate < 0.1%`
- [x] Documentar plano completo em `docs/load-testing.md` com scripts k6 prontos para uso
- [x] Scripts documentados para: login (100 VUs), create-order (50 VUs), list-orders (200 VUs), export (10 VUs)
- [ ] Instalar k6 no ambiente de CI/CD ou localmente
- [ ] Rodar scripts contra staging após provisionamento
- [ ] Atualizar tabela de resultados em `docs/load-testing.md`

**Esforço:** 2 dias | **Status:** ✅ plano documentado (2026-04-08) | ⬜ execução pendente staging

---

#### A9 — Disaster Recovery Testado (Camada 7)

**Problema:** DR plan existe na cabeça, não documentado e nunca testado.

- [ ] Criar `docs/disaster-recovery.md`:
  - Contatos de emergência e escalation
  - RTO target: < 4h | RPO target: < 1h
  - Passo a passo para restore de banco Supabase
  - Passo a passo para redeploy na Vercel
  - Checklist de validação pós-restore
- [ ] Executar restore do backup mais recente do Supabase em staging
- [ ] Medir e documentar RTO e RPO reais
- [ ] Agendar simulação de DR semestral

**Esforço:** 2 dias | **Status:** ⬜ pendente

---

### Semana 7–8: Dados e LGPD

#### A10 — Encriptação de PII Sensível (Camada 6)

**Problema:** Campos como `phone`, `crm`, e `form_data` armazenados em plaintext.

- [ ] `lib/crypto.ts`: `encrypt(value)`, `decrypt(value)` com AES-256-GCM
  - Chave via env var `ENCRYPTION_KEY` (256 bits, gerado com `openssl rand -hex 32`)
- [ ] Campos a encriptar: `profiles.phone`, `doctors.crm`, `registration_requests.form_data` (JSON)
- [ ] Migration: renomear colunas para `_encrypted`, migrar dados existentes
- [ ] Atualizar todas as queries que leem/escrevem esses campos
- [ ] Configurar `ENCRYPTION_KEY` no Vercel (Production + Preview)

**Esforço:** 3 dias | **Status:** ⬜ pendente

---

#### A11 — Portal de Direitos LGPD (Camadas 6 e 9)

**Problema:** Usuários não conseguem exportar ou solicitar exclusão de seus dados (Art. 18 LGPD).

- [ ] `GET /api/v1/lgpd/export`: gera JSON com todos os dados do usuário autenticado
- [ ] `POST /api/v1/lgpd/deletion-request`: cria solicitação, notifica SUPER_ADMIN
- [ ] `POST /api/admin/lgpd/anonymize/:userId`: anonimiza PII, preserva dados financeiros
- [ ] Página `/profile/privacy` com botões de exportação e solicitação de exclusão
- [ ] `docs/lgpd-registro-atividades.md`: registro formal das atividades de tratamento (Art. 37)
- [ ] Template DPA para contratos com farmácias e clínicas

**Esforço:** 4 dias | **Status:** ⬜ pendente

---

#### A12 — Política de Retenção Técnica (Camadas 6 e 9)

**Problema:** Política documentada mas não implementada tecnicamente.

- [ ] `lib/retention-policy.ts`: tabela de retenção por entidade
  - Dados pessoais: 5 anos após `deleted_at`
  - Dados financeiros: 10 anos (Código Tributário Nacional, Art. 195)
  - Logs de auditoria: 5 anos
  - Documentos de pedido: 5 anos
- [ ] Cron mensal: identifica registros além do prazo e executa purge/anonimização
- [ ] Testes para garantir que dados financeiros não sejam deletados prematuramente

**Esforço:** 2 dias | **Status:** ⬜ pendente

---

### Semana 9–10: Observabilidade e UX

#### A13 — Structured Logging + Distributed Tracing (Camada 8)

**Problema:** Logs não correlacionados entre requests. Impossível debugar problemas cross-service.

- [ ] `lib/logger.ts`: `log(level, message, context)` com `requestId`, `userId`, `action`, `durationMs`
- [ ] Integrar `@vercel/otel` para OpenTelemetry
- [ ] Adicionar spans em: queries Supabase, chamadas a APIs externas, server actions
- [ ] Logtail (free tier 1GB/mês) como destino de logs estruturados
- [ ] Substituir todos os `console.log/error` pelo novo logger

**Esforço:** 3 dias | **Status:** ⬜ pendente

---

#### A14 — SLOs Formais + Alertas de Negócio (Camada 8)

**Problema:** Sem SLOs definidos. Alertas só em erros técnicos, não em eventos de negócio.

- [ ] `docs/slos.md`: formalizar SLOs
  - Disponibilidade: 99.5% mensal
  - Latência p95: < 800ms nas rotas principais
  - Taxa de erro: < 0.5% nas rotas de pedido
- [ ] Alertas de negócio no Sentry:
  - Nenhum pedido criado em 4h (horário comercial)
  - Taxa de erro de pagamento > 10% em 1h
  - Webhook Clicksign sem eventos por 48h
  - Circuit breaker aberto em qualquer serviço externo

**Esforço:** 2 dias | **Status:** ⬜ pendente

---

#### A15 — Acessibilidade WCAG 2.1 + PWA (Camada 1)

**Problema:** Sem auditoria de acessibilidade. Sem PWA manifest. Lei Brasileira de Inclusão (Art. 63).

- [ ] Instalar `axe-core` + rodar auditoria em todas as páginas
- [ ] Corrigir: contraste de cores, labels em formulários, navegação por teclado, ARIA roles
- [ ] Adicionar `manifest.json` (nome, ícones, theme color, `display: standalone`)
- [ ] Service worker para cache de assets estáticos (Next.js `next-pwa`)

**Esforço:** 3 dias | **Status:** ⬜ pendente

---

#### A16 — Testes E2E com Playwright (Camada 1)

**Problema:** Sem testes de interface. Deploys podem quebrar fluxos críticos silenciosamente.

- [ ] Configurar Playwright no projeto
- [ ] Fluxo 1: login → criar pedido → confirmar pagamento
- [ ] Fluxo 2: admin aprova cadastro de clínica
- [ ] Fluxo 3: farmácia atualiza status de pedido
- [ ] Integrar no CI (Vercel Preview build check)

**Esforço:** 3 dias | **Status:** ⬜ pendente

---

#### A17 — Pentest Externo (Camada 3)

**Problema:** Sem validação externa de segurança. Requisito implícito de qualquer due diligence.

- [ ] Contratar empresa especializada (Tempest, Conviso, Kondado — custo estimado R$8k–20k)
- [ ] Escopo: autenticação, IDOR, injeção, lógica de negócio, configuração de infraestrutura
- [ ] Corrigir todos os findings críticos e altos antes do go-live comercial
- [ ] Obter relatório formal para apresentar a investidores e parceiros regulados

**Esforço:** 2–3 semanas (externo) | **Status:** ⬜ pendente (contratar assim que possível)

---

## Bloco B — Executar quando CNPJ disponível 🔒

| Item                               | Camadas | O que fazer                                                           | Esforço estimado |
| ---------------------------------- | ------- | --------------------------------------------------------------------- | ---------------- |
| **Certificado digital A1**         | 5, 9    | Emitir via Certisign/Serasa para assinar NF-e                         | 1–3 dias úteis   |
| **NF-e de serviço (NFS-e)**        | 5, 9    | Integrar NFe.io/Enotas para emitir NFS-e da comissão da plataforma    | 2 semanas        |
| **NF-e de produto**                | 5, 9    | Emitir NF-e da transação farmácia→clínica no fluxo de pedido          | 1 semana         |
| **Armazenamento XML + DANFE**      | 6, 9    | Salvar XML e PDF no Supabase Storage com retenção 5 anos              | 2 dias           |
| **Asaas conta produção**           | 5       | Migrar de sandbox para produção, testar split de pagamento nativo     | 3 dias           |
| **WhatsApp Business API**          | 4, 8    | Ativar Evolution API com número empresarial registrado                | 1 semana         |
| **Clicksign produção**             | 4, 9    | Migrar token sandbox → produção, testar fluxo de assinatura real      | 1 dia            |
| **Registro ANPD**                  | 9       | Registrar como operador de dados de saúde (processo administrativo)   | 2–4 semanas      |
| **DPA formal com parceiros**       | 9       | Assinar DPA com farmácias e clínicas via Clicksign                    | 1 semana         |
| **ANVISA API (quando disponível)** | 4, 9    | Integrar consulta de autorização de funcionamento via sistema oficial | 1 semana         |

---

## Cronograma Visual

```
Sem CNPJ (10 semanas)
─────────────────────────────────────────────────────────────────

Sem 1–2   [▓▓▓▓▓] Session revocation + Security headers + Circuit breaker
Sem 3–4   [▓▓▓▓▓] API versioning + CNPJ validation + Compliance engine
Sem 5–6   [▓▓▓▓▓] Inngest jobs + Staging env + Load testing + DR plan
Sem 7–8   [▓▓▓▓▓] Encriptação PII + Portal LGPD + Retenção técnica
Sem 9–10  [▓▓▓▓▓] Structured logging + SLOs + WCAG + Playwright + Pentest

Score projetado: 72–92 por camada (camadas 5 e 9 limitadas pelo CNPJ)

Com CNPJ (+ 6–8 semanas após obtenção)
─────────────────────────────────────────────────────────────────

Sem 1     Certificado digital A1 + Asaas produção
Sem 2–3   NFS-e (comissão plataforma) via NFe.io
Sem 4–5   NF-e produto (farmácia → clínica) integrada ao pedido
Sem 6     WhatsApp Business + Clicksign produção
Sem 7–8   Registro ANPD + DPA formal + ANVISA API

Score projetado: 90–93 em todas as 9 camadas ✅
```

---

## Checklist de Desbloqueio (quando CNPJ estiver pronto)

- [ ] CNPJ registrado e ativo (situação ATIVA na Receita Federal)
- [ ] Certificado digital A1 ou A3 emitido
- [ ] Conta Asaas migrada para produção com CNPJ da empresa
- [ ] Número de telefone empresarial ativado
- [ ] WhatsApp Business registrado com número empresarial
- [ ] Clicksign conta de produção ativada
- [ ] Conta NFe.io ou Enotas criada e configurada
- [ ] Registro ANPD iniciado
- [ ] DPA template revisado por advogado especialista em LGPD

---

## Referências Regulatórias

| Norma                               | Relevância                                       | Status                                        |
| ----------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| LGPD (Lei 13.709/2018)              | Tratamento de dados pessoais de saúde            | 🟡 Parcial — completar com portal de direitos |
| RDC ANVISA 67/2007                  | Farmácias de manipulação e distribuição          | 🟡 Manual — automatizar validação CNPJ        |
| Código Tributário Nacional Art. 195 | Retenção de dados fiscais por 10 anos            | 🟡 Documentado — implementar tecnicamente     |
| Lei 12.682/2012                     | Digitalização de documentos com valor legal      | ✅ Clicksign implementado                     |
| Lei Brasileira de Inclusão Art. 63  | Acessibilidade em plataformas digitais           | 🔴 Não iniciado                               |
| Resolução BCB 80/2021               | Intermediação financeira e arranjos de pagamento | 🔴 Avaliar com advogado quando volume crescer |

---

_Documento gerado em 2026-04-08. Atualizar a cada sprint concluída._
