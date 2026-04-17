# Clinipharma — Checklist de Go-Live

---

## Infraestrutura

- [x] Migrations aplicadas no Supabase de produção (`jomdntqlgrupvhrqoyai`) — inclui migrations 013–022 (fcm_tokens, asaas_fields, contracts, templates, sla_configs, tracking, sessions, UNIQUE payments, índices, precisão financeira, soft-delete, RLS completo, constraints financeiras, session revocation blacklist, pharmacy CNPJ validation columns)
- [x] RLS habilitada em todas as tabelas
- [x] Buckets de Storage criados (`product-images` público, `order-documents` privado)
- [x] Seed de categorias e produtos rodado
- [x] Usuários iniciais criados via `scripts/setup-production.ts`

## Autenticação

- [x] Email/senha funcionando
- [x] Site URL atualizada no Supabase Auth para `https://clinipharma.com.br`
- [x] Redirect URL `https://clinipharma.com.br/**` adicionada no Supabase Auth
- [x] Recuperação de senha via Resend (rota própria `POST /api/auth/forgot-password` + `admin.generateLink`)
- [x] Email de recuperação de senha testado e funcionando end-to-end
- [x] Página `/reset-password` criada e funcional

## Variáveis de Ambiente (Vercel) — Todas configuradas

- [x] `NEXT_PUBLIC_SUPABASE_URL` configurada
- [x] `NEXT_PUBLIC_SUPABASE_ANON_KEY` configurada
- [x] `SUPABASE_SERVICE_ROLE_KEY` configurada
- [x] `NEXT_PUBLIC_APP_NAME` = Clinipharma
- [x] `NEXT_PUBLIC_APP_URL` = `https://clinipharma.com.br`
- [x] `RESEND_API_KEY` configurada
- [x] `EMAIL_FROM` = `Clinipharma <noreply@clinipharma.com.br>`
- [x] `CRON_SECRET` configurada (Production + Preview + Development)
- [x] `FIREBASE_PROJECT_ID` = `clinipharma-d7797`
- [x] `FIREBASE_CLIENT_EMAIL` (service account)
- [x] `FIREBASE_PRIVATE_KEY` (encrypted, service account)
- [x] `NEXT_PUBLIC_FIREBASE_API_KEY` = `AIzaSyCwBdcB8Ibgq4lBVWwz1_hmrkzDxIwnIto`
- [x] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `clinipharma-d7797.firebaseapp.com`
- [x] `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `clinipharma-d7797`
- [x] `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- [x] `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` = `67520190566`
- [x] `NEXT_PUBLIC_FIREBASE_APP_ID` = `1:67520190566:web:927fdadd22238ff26b35a7`
- [x] `NEXT_PUBLIC_FIREBASE_VAPID_KEY` = `BNrMF4L9UwGqH3dHkIZp9-plConcw5YXpcTbfL-mF6_XTv6oIlV10Buw1sgCqd-YVveXECTWcxvWxXgbgf_VQ-U` ✅ **chave real configurada**
- [x] `ASAAS_API_KEY` — ✅ **produção** configurada no Vercel (id: `e8M2BKBBylCBgjf0`) e `.env.local` em 2026-04-14.
- [x] `ASAAS_API_URL` = `https://api.asaas.com/v3` — ✅ **produção** configurada no Vercel (id: `Ha59rt0jVTvFFY64`) e `.env.local` em 2026-04-14.
- [x] `ASAAS_WEBHOOK_SECRET` — ✅ **produção** configurada no Vercel (id: `59YdW0ce1NcycTwx`) e `.env.local` em 2026-04-14. URL do webhook no Asaas: `https://clinipharma.com.br/api/payments/asaas/webhook?accessToken=whsec_8AzQE_w7P99SIDhRCLktw3Pq4G6IcYtI7jxD3bUCbjs`
- [x] `ZENVIA_API_TOKEN` — ✅ **CONCLUÍDO (2026-04-17)** — token `AFOTY18T...` configurado. Vercel id: `WCWL1B4O5e9guOOZ`
- [x] `ZENVIA_SMS_FROM` — ✅ **CONCLUÍDO (2026-04-17)** — sender `Clinipharma` ativo. Vercel id: `fYrN1vRC0mPF93Ne`
- [ ] `ZENVIA_WHATSAPP_FROM` — ⏳ **ADIADO** — conectar WABA quando a plataforma estiver em operação real. WhatsApp Business existente disponível para iniciar o processo. Vercel id: `qN5b0EH8Y0bouNYp`
- [x] `CLICKSIGN_ACCESS_TOKEN` — ✅ **produção** configurada no Vercel (id: `eYo5lbCljCz6oKFu`) e `.env.local` em 2026-04-16
- [x] `CLICKSIGN_API_URL` = `https://app.clicksign.com/api/v1` — ✅ **produção** configurada no Vercel (id: `9HsdfN0FtO7WGa6o`) em 2026-04-16
- [x] `CLICKSIGN_WEBHOOK_SECRET` = HMAC SHA256 Secret gerado pelo painel Clicksign — ✅ configurada no Vercel (id: `B684F1veC2CQLq5j`) em 2026-04-16. Webhook handler atualizado para verificar header `Content-Hmac: sha256=<hex>` (padrão real da Clicksign)
- [x] `OPENAI_API_KEY` — ✅ configurada no Vercel (Production + Preview) em 2026-04-12 via API REST com token de serviço. Necessária para todas as features de IA (v6.0.0): triagem de tickets, sentimento, OCR, contratos, recomendações.

> **Como gerenciar variáveis via CLI/API (referência):**
>
> ```bash
> # Listar todas as env vars do projeto
> curl -s "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
>   -H "Authorization: Bearer $VERCEL_TOKEN"
>
> # Adicionar nova variável (Production)
> vercel env add NOME_VAR production --token "$VERCEL_TOKEN" --scope "$TEAM_ID"
>
> # Adicionar via API (sem prompts interativos)
> curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
>   -H "Authorization: Bearer $VERCEL_TOKEN" \
>   -H "Content-Type: application/json" \
>   -d '{"key":"NOME_VAR","value":"VALOR","type":"encrypted","target":["production","preview"]}'
> ```
>
> O token de serviço (Vercel API Token) pode ser criado em vercel.com/account/tokens.
> PROJECT_ID = `prj_AselTmZTlBpnArr0M7zP6GTmNJ16` | TEAM_ID = `team_fccKc8W6hyQmvCcZAGCqV1UK`
> VERCEL_TOKEN: armazenado apenas no `.env.local` (nunca comitar).

## Auditoria interna de QA / segurança / IA

- [ ] **`docs/audit-qa-plena-2026-04.md`** — executar matriz de testes (v6.0.2); expandir RBAC linha a linha para cada rota em `app/api/**/route.ts` conforme nota no sumário quantitativo do documento.

## Segurança (Roadmap 90pts — Semana 1–2)

- [x] **Session revocation** — `revoked_tokens` blacklist implementada. `deactivateUser()` e `assignUserRole()` revogam sessões imediatamente via `revokeAllUserTokens()`.
- [x] **Middleware revocation check** — todo request autenticado verifica a blacklist. Token revogado → redirect para login + limpeza de cookies.
- [x] **Security headers** — CSP, HSTS (max-age=31536000 preload), X-Frame-Options: DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy em todas as rotas.
- [x] **Circuit breaker** — Asaas e Clicksign protegidos contra cascade failure (3 falhas → OPEN, 30s recovery). Estado exposto em `/api/health`.
- [x] **X-Request-ID** — gerado no middleware e propagado em todos os responses para rastreamento.
- [x] **API response padronizada** — `lib/api-response.ts` com `apiSuccess()`, `apiError()`, `ApiErrors` factory.
- [x] **Compliance engine** — `lib/compliance.ts` com `validateCNPJ()` (ReceitaWS), `canPlaceOrder()`, `canAcceptOrder()`.
- [x] **CNPJ validation cron** — revalidação semanal (segunda 06h UTC) suspende farmácias com CNPJ irregular e notifica admins.
- [x] **Compliance integrado nos services** — `createPharmacy`, `updatePharmacyStatus('ACTIVE')` e `createOrder` validam compliance antes de prosseguir.
- [x] **API versioning** — rewrites `/api/v1/*` → `/api/*` ativo em `next.config.ts`.

## Background Jobs (Inngest)

- [x] **`/api/inngest` route** — serve endpoint registrado com 7 funções: `export-orders`, `stale-orders`, `asaas-webhook`, `churn-detection`, `reorder-alerts`, `contract-auto-send`, `product-recommendations`.
- [x] **`export-orders` job** — exportação CSV sem timeout, envia resultado por email.
- [x] **`stale-orders` job** — alerta de pedidos parados com retry automático 3×.
- [x] **`asaas-webhook` job** — webhook de pagamento enfileirado no Inngest, retorna 200 imediatamente.
- [x] **`INNGEST_EVENT_KEY`** — ✅ **produção configurada** (2026-04-16) no Vercel (id: `PR9V0fQTXo9EWT9A`) e `.env.local`. Key: `clinipharma`.
- [x] **`INNGEST_SIGNING_KEY`** — ✅ **produção configurada** (2026-04-16) no Vercel (id: `oJfsDFsucA13Jreb`) e `.env.local`. Key: `default inngest key`.
- [x] **App sincronizado** ✅ (2026-04-16) — 7 funções registradas no dashboard Inngest: `export-orders`, `stale-orders`, `asaas-webhook`, `churn-detection`, `reorder-alerts`, `contract-auto-send`, `product-recommendations`.

## Staging e Load Testing

- [x] **`docs/staging-environment.md`** — plano completo documentado com branch strategy e política de promoção.
- [x] **`docs/load-testing.md`** — SLOs definidos + scripts k6 prontos para uso.
- [ ] **🔴 AÇÃO PENDENTE DO PROPRIETÁRIO:** Provisionar projeto Supabase `clinipharma-staging` — ver `docs/staging-environment.md` para passo a passo completo
- [ ] Criar branch `staging` e configurar deploy automático no Vercel
- [ ] Executar scripts k6 contra staging (ver `docs/load-testing.md`)
- [x] **Cloudflare WAF** ✅ CONCLUÍDO (2026-04-17) — Cloudflare Managed Free Ruleset ativo (26 regras block). Rate limit 17 req/10 s por IP em `/api/` (≈100 req/min). ⚠️ OWASP Core Ruleset requer plano Pro ($20/mês); upgradar quando houver tráfego real.
- [ ] **Pentest externo** — contratar antes do go-live comercial (Tempest, Conviso, Kondado)

## LGPD e Privacidade (Semana 7–8)

- [x] **`ENCRYPTION_KEY`** — AES-256-GCM gerada e configurada no Vercel. ✅
- [x] **Migration 023** — colunas `phone_encrypted`, `crm_encrypted`, `form_data_encrypted` adicionadas.
- [x] **`lib/crypto.ts`** — encrypt/decrypt com fail-open + isEncrypted + reEncrypt.
- [x] **Portal LGPD** — `/profile/privacy` com exportação de dados e solicitação de exclusão.
- [x] **`GET /api/lgpd/export`** — exporta todos os dados do usuário em JSON.
- [x] **`POST /api/lgpd/deletion-request`** — registra solicitação + notifica SUPER_ADMIN.
- [x] **`POST /api/admin/lgpd/anonymize/:userId`** — anonimiza PII + revoga sessões + preserva financeiros.
- [x] **`lib/retention-policy.ts`** — política de retenção técnica (5 anos PII, 10 anos financeiros).
- [x] **Cron mensal de retenção** — `0 2 1 * *` anonimiza e purga dados vencidos automaticamente.
- [x] **`docs/lgpd-registro-atividades.md`** — registro formal de atividades (Art. 37) + suboperadores.
- [x] **`docs/disaster-recovery.md`** — plano DR completo (cenários, procedimentos, checklist pós-restore).
- [x] **Migração PII encrypted** ✅ **(2026-04-17)** — dual-write ativo em todos os services; `scripts/migrate-pii-encryption.ts` executado em produção (6 CRMs + 1 form_data); `ENCRYPTION_KEY` configurada no Vercel.
- [ ] **🔴 AÇÃO PENDENTE:** DPA formal — revisão por advogado LGPD + assinatura com primeiras farmácias/clínicas (auto-envio via Clicksign implementado)
- [x] **Política de Privacidade em `/privacy` e Termos de Uso em `/terms`** — implementadas em v5.1.0; acesso público corrigido no middleware em v5.1.4
- [x] `NUVEM_FISCAL_CLIENT_ID` — ✅ configurada no Vercel (id: `Jo9YeeTl79GpYDdF`) e `.env.local` em 2026-04-14.
- [x] `NUVEM_FISCAL_CLIENT_SECRET` — ✅ configurada no Vercel (id: `qDNONdPREYbz6AoE`) e `.env.local` em 2026-04-14.
- [x] `NUVEM_FISCAL_CNPJ` = `66279691000112` — ✅ configurada no Vercel (id: `UzSkKepARhbh4sG1`) e `.env.local` em 2026-04-14.

### Variáveis opcionais — ✅ todas configuradas

- [x] `NEXT_PUBLIC_SENTRY_DSN` — ✅ `https://c63e33b1b94125b1be02f61a38b6cb6f@o4510907598700544.ingest.us.sentry.io/4511197915381760`
- [x] `SENTRY_ORG` — ✅ `cabralandre82s-org`
- [x] `SENTRY_PROJECT` — ✅ `clinipharma`
- [x] `SENTRY_AUTH_TOKEN` — ✅ token pessoal configurado como `sensitive` (production + preview)
- [x] `UPSTASH_REDIS_REST_URL` — ✅ `https://subtle-mackerel-96084.upstash.io`
- [x] `UPSTASH_REDIS_REST_TOKEN` — ✅ configurado (production + preview + development)

> **Sentry 100% operacional:** erros capturados com stack traces em TypeScript (source maps ativos via `SENTRY_AUTH_TOKEN`).  
> **Upstash ativo:** rate limit distribuído em todas as instâncias do Vercel.

---

## 🚨 AÇÕES OBRIGATÓRIAS ANTES DO LANÇAMENTO COMERCIAL

> Estas ações são pré-requisitos para receber pagamentos reais, notificar clientes e assinar contratos em produção.

### 💳 1. Asaas — Trocar para conta de produção

**Status:** sandbox ativo, recebimento real BLOQUEADO  
**O que fazer:**

1. ✅ Conta PJ criada no Asaas (2026-04-14)
2. ✅ API Key de produção gerada e configurada no Vercel (`ASAAS_API_KEY`, id: `e8M2BKBBylCBgjf0`)
3. ✅ `ASAAS_API_URL` = `https://api.asaas.com/v3` configurada no Vercel (id: `Ha59rt0jVTvFFY64`)
4. ✅ `ASAAS_WEBHOOK_SECRET` configurada no Vercel (id: `59YdW0ce1NcycTwx`)
5. ✅ Webhook registrado no painel Asaas (2026-04-14):
   - URL: `https://clinipharma.com.br/api/payments/asaas/webhook?accessToken=whsec_8AzQE_w7P99SIDhRCLktw3Pq4G6IcYtI7jxD3bUCbjs`
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`

---

### 📝 2. Clicksign — Trocar para conta de produção

**Status:** ✅ **PRODUÇÃO CONFIGURADA** (2026-04-16) — credenciais de produção ativas no Vercel e `.env.local`  
**Pendência restante (manual):** No painel Clicksign Produção → Configurações → Webhooks → Adicionar:

- URL: `https://clinipharma.com.br/api/contracts/webhook`
- HMAC SHA256 Secret: já gerado pelo painel e configurado na env var
- Eventos: `sign`, `auto_close`, `deadline`, `cancel`

---

### 📱 3. Zenvia — SMS + WhatsApp (provider unificado)

**Status:** código implementado (`lib/zenvia.ts`) — aguardando aprovação da conta Zenvia  
**Por que Zenvia:** provider brasileiro, SMS e WhatsApp num único token REST, sem infraestrutura própria (sem Docker), sem complexidade de QR code. BSP oficial do Meta.

> ⚠️ **Tempo de aprovação:** o cadastro da conta Zenvia é imediato e o **sandbox** funciona no mesmo dia. Para produção: SMS tende a ser aprovado em 1–2 dias úteis. WhatsApp Business requer verificação de conta Meta (CNPJ + razão social) e pode levar **5–10 dias úteis**. Inicie o processo o quanto antes.

**O que fazer:**

1. Criar conta em [app.zenvia.com](https://app.zenvia.com) (sandbox disponível imediatamente)
2. Ir em **Developers → Tokens & Webhooks → Criar novo** → copiar o token gerado
3. **SMS sender:** em **Canais → SMS** → obter o sender ID aprovado (alfanumérico "Clinipharma" ou número curto)
4. **WhatsApp:** em **Canais → WhatsApp Business** → registrar número dedicado (requer verificação de conta Business)
   - Até aprovação, usar a **keyword** do Sandbox em `app.zenvia.com/home/sandbox`
5. No Vercel → atualizar os 3 placeholders com os valores reais:
   - `ZENVIA_API_TOKEN` (id: `WCWL1B4O5e9guOOZ`) → token criado no passo 2
   - `ZENVIA_SMS_FROM` (id: `fYrN1vRC0mPF93Ne`) → sender ID SMS do passo 3
   - `ZENVIA_WHATSAPP_FROM` (id: `qN5b0EH8Y0bouNYp`) → número WhatsApp Business ou keyword sandbox
6. Também atualizar `.env.local` com os mesmos valores para desenvolvimento local

---

### 🧾 5. NF-e / NFS-e — Após CNPJ com contadora

**Status:** código implementado (v6.8.0) — aguardando credenciais Nuvem Fiscal  
**O que fazer:**

1. ✅ CNPJ obtido (2026-04-14)
2. ✅ Conta criada na [Nuvem Fiscal](https://nuvemfiscal.com.br) (2026-04-14)
3. ✅ Certificado A1 configurado na Nuvem Fiscal (2026-04-14)
4. ✅ Código implementado (`lib/nuvem-fiscal.ts`, `services/nfse.ts`, migration `042`) — NFS-e emitida automaticamente ao confirmar repasse à farmácia e ao consultor (2026-04-14)
5. ✅ Credenciais configuradas no Vercel e `.env.local` (2026-04-14):
   - `NUVEM_FISCAL_CLIENT_ID` = `Bu3gtVpg3cmInVWxwIZT`
   - `NUVEM_FISCAL_CLIENT_SECRET` = `eTXMxROBNLGL0asJeKXXp9I2bwP9QegZMEYZtA3Z`
   - `NUVEM_FISCAL_CNPJ` = `66279691000112`
6. ✅ Migration `042_nfse_records.sql` aplicada no Supabase produção (2026-04-14)
7. Orientar farmácias parceiras a emitir NF-e para a clínica em cada entrega

---

## Build e Deploy

- [x] `npm run build` passa sem erros ✅
- [x] `npm run lint` passa sem warnings críticos ✅
- [x] TypeScript `tsc --noEmit` sem erros ✅
- [x] Testes unitários passando — **930 testes, 67 suítes, 0 falhas** ✅ — inclui cobertura de `lib/nuvem-fiscal.ts`, `services/nfse.ts` e `app/api/contracts/webhook` (HMAC SHA256)
- [x] Testes E2E Playwright configurados (`tests/e2e/`, 5 suítes, pronto para staging) ✅
- [x] **Testes E2E contra staging real** ✅ **(2026-04-17)** — 56 passando, 3 skipped (sem dados), 0 falhas. Cobertura: auth, admin, orders, profile/privacy, smoke, catalog. Playwright contra `staging.clinipharma.com.br`.
- [x] GitHub Actions CI workflow (`.github/workflows/ci.yml`) — unit + lint + TypeScript + E2E smoke ✅
- [x] Deploy na Vercel bem-sucedido (status: Ready)
- [x] URL de produção acessível (`https://clinipharma.com.br`)
- [x] Repositório GitHub conectado (auto-deploy no push para `main`)
- [x] Domínio `clinipharma.com.br` com HTTPS ativo na Vercel

## Funcionalidades críticas implementadas

- [x] Login com email/senha
- [x] Dashboard por papel (SUPER_ADMIN, PLATFORM_ADMIN, CLINIC_ADMIN, DOCTOR, PHARMACY_ADMIN)
- [x] Catálogo de produtos com filtros e paginação
- [x] Criação de pedido com carrinho
- [x] Upload de documentos por tipo com checklist
- [x] Gateway de pagamento PIX + boleto + cartão (Asaas sandbox → produção pendente)
- [x] Confirmação automática de pagamento via webhook
- [x] Cálculo de comissão automático
- [x] Registro manual de repasse para farmácia e consultores
- [x] Timeline do pedido com histórico de status
- [x] Farmácia avança status operacional
- [x] Logs de auditoria
- [x] Notificações in-app em tempo real
- [x] Push notifications FCM (botão no header; VAPID key configurada ✅)
- [x] SMS Twilio (test → produção pendente, ver item 4 acima)
- [x] WhatsApp Evolution API (infraestrutura pronta → deploy pendente, ver item 3 acima)
- [x] Assinatura eletrônica Clicksign — ✅ **produção ativa** (2026-04-16)
- [x] Busca global (pedidos, clínicas, médicos, produtos)
- [x] Exportação CSV/Excel com filtro de período
- [x] Relatórios com Recharts interativo e DateRangePicker
- [x] **BI Avançado** — comparação de períodos, ranking clínicas, funil de conversão, margem real por produto
- [x] Alertas de pedidos parados (widget + Cron diário + email digest)
- [x] **SLA configurável** — thresholds por farmácia com 3 níveis (aviso/alerta/crítico); UI em Configurações
- [x] Preferências de notificação por usuário
- [x] Produto indisponível + botão "Tenho interesse"
- [x] **Variações de produto** — atributos livres, preço/custo/comissão por variante
- [x] **Templates de pedido** — salvar, reutilizar e repetir pedidos por clínica
- [x] **Portal de rastreamento público** — `/track/[token]` sem login, timeline + ETA
- [x] **Histórico de sessões** — log de acesso com detecção de novo dispositivo + alerta in-app
- [x] Auto-cadastro público de clínicas/médicos com aprovação e docs
- [x] Contratos digitais via Clicksign — ✅ **produção ativa** (2026-04-16)

## Segurança

- [x] `.env.local` NÃO está no repositório
- [x] Service Role Key NÃO exposta no frontend
- [x] RLS bloqueia acesso cruzado entre organizações
- [x] Rotas privadas redirecionam para login
- [x] Server Actions e API routes validam papéis no servidor
- [x] Webhooks protegidos por secret token (Asaas, Cron, Clicksign)
- [x] Rate limiting em `/forgot-password` (5/min) e `/registration/submit` (3/10min)
- [x] State machine de status — PHARMACY_ADMIN não pode setar status financeiros
- [x] Idempotência no webhook Asaas — pagamento duplo ignorado
- [x] UNIQUE constraint em `payments.order_id` — previne cobrança duplicada
- [x] IDOR bloqueado em `updateOwnProfile` — usuário não pode editar perfil alheio
- [x] Dependência vulnerável `xlsx` substituída por `exceljs`
- [x] `clinic_members` insert corrigido — aprovação de clínica agora linka usuário corretamente
- [x] `product_price_history` corrigido — histórico de preço agora é persistido
- [x] Cron `stale-orders` corrigido — farmácias agora recebem alertas de pedidos parados
- [x] Tracking route — `isCancelled` e labels de todos os status corrigidos
- [x] **Rate limiter Redis-ready** — `lib/rate-limit.ts` detecta automaticamente `UPSTASH_REDIS_REST_URL`. ✅ Upstash ativo.
- [x] **Upstash Redis** — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` configuradas. Rate limit multi-instância ativo.
- [x] **Sentry 100% operacional** — DSN + org (`cabralandre82s-org`) + project (`clinipharma`) + auth token configurados. Source maps e error tracking ativos.
- [x] **`/api/health` endpoint** — verificação de Supabase + env vars + circuit breakers. ✅ **UptimeRobot ativo (2026-04-16)** — monitor a cada 5 min. Status page público: https://stats.uptimerobot.com/gPxExgRxI7
- [x] **Structured logging** — `lib/logger.ts` com JSON logs em todos os services críticos. `console.log/error` substituídos nas API routes.
- [x] **OpenTelemetry (2026-04-14)** — `@vercel/otel` + `instrumentation.ts`; auto-instrumenta todos os `fetch()` (Supabase, OpenAI, Clicksign, Asaas); spans customizados em `order.create`, `order.updateStatus`; traces visíveis no painel Vercel → Observability.
- [x] **Log persistente (2026-04-14)** — `logger.error/warn` em produção persiste fire-and-forget em `server_logs` (Supabase, 90 dias); cron semanal de purge; página admin `/server-logs` com filtros por nível/mensagem. Migration 043 aplicada.
- [x] **SLOs documentados** — `docs/slos.md` com targets de disponibilidade, latência, error rate e alertas de negócio.
- [x] **PWA manifest** — `public/manifest.json` ativo, shortcuts "Novo Pedido" e "Meus Pedidos".
- [x] **Disaster Recovery Plan** — `docs/disaster-recovery.md` com cenários, RTO/RPO e checklist de restore.
- [x] **DR Simulação realizada** ✅ **(2026-04-17)** — RTO medido: ~25–30 min (target: < 4h ✅); RPO atual: ~24h backup diário físico (target: < 1h ⚠️ — ativar PITR). 8 backups físicos disponíveis. Schema restore completo: 141s.

## Email transacional

- [x] Resend integrado com domínio `clinipharma.com.br` verificado
- [x] Templates: recuperação de senha, boas-vindas, interesses, pedidos parados, notificações

## Onboarding comercial (pós-deploy)

- [x] Usuário super admin criado em produção (`cabralandre@yahoo.com.br` — André, SUPER_ADMIN)
- [ ] Farmácias reais cadastradas e ativas
- [ ] Catálogo real de produtos cadastrado (com `price_current`, `pharmacy_cost`, prazo por SKU)
- [ ] Taxa de comissão dos consultores configurada em **Configurações**
- [ ] Clínicas clientes onboardadas
- [ ] Médicos vinculados às clínicas
- [ ] Consultores de vendas cadastrados e vinculados às clínicas
- [ ] **Asaas produção ativo** (ver item 1 acima) — obrigatório para receber pagamentos reais
- [x] **Clicksign produção ativo** — ✅ credenciais + webhook registrado no painel Clicksign produção (HMAC SHA256, eventos: sign, auto_close, deadline, cancel). Totalmente operacional (2026-04-16).
- [x] **Zenvia SMS** ✅ CONCLUÍDO (2026-04-17) — conta criada, token e sender `Clinipharma` ativos, vars Vercel atualizadas. **WhatsApp adiado** para quando a plataforma estiver em operação real.
- [ ] **NF-e ativo** (ver item 5 acima) — obrigatório para operação fiscal legal
- [ ] Primeiro pedido de teste realizado de ponta a ponta em produção

---

_Legenda: [x] = concluído | [ ] = pendente | 🚨 = bloqueante para lançamento real_
