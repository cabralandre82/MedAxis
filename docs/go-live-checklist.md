# Clinipharma — Checklist de Go-Live

---

## Infraestrutura

- [x] Migrations aplicadas no Supabase de produção (`jomdntqlgrupvhrqoyai`) — inclui migrations 013–016 (fcm_tokens, asaas_fields, contracts, templates, sla_configs, tracking, sessions, UNIQUE payments, índices, precisão financeira numeric(15,2), soft-delete, RLS, 8 novos índices de performance)
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
- [x] `ASAAS_API_KEY` (sandbox key)
- [x] `ASAAS_API_URL` = `https://sandbox.asaas.com/api/v3`
- [x] `ASAAS_WEBHOOK_SECRET` = `clinipharma_asaas_webhook_2026`
- [x] `TWILIO_ACCOUNT_SID` (test)
- [x] `TWILIO_AUTH_TOKEN` (test)
- [x] `TWILIO_PHONE_NUMBER` = `+15005550006` (test number)
- [x] `EVOLUTION_API_URL` = `PENDING_DEPLOY`
- [x] `EVOLUTION_API_KEY` = `clinipharma_evolution_2026`
- [x] `EVOLUTION_INSTANCE_NAME` = `clinipharma`
- [x] `CLICKSIGN_ACCESS_TOKEN` (sandbox)
- [x] `CLICKSIGN_API_URL` = `https://sandbox.clicksign.com/api/v1`
- [x] `NUVEM_FISCAL_CLIENT_ID` = `PENDING_CNPJ`
- [x] `NUVEM_FISCAL_CLIENT_SECRET` = `PENDING_CNPJ`
- [x] `NUVEM_FISCAL_CNPJ` = `PENDING_CNPJ`

### Variáveis opcionais — código pronto, credenciais pendentes

- [ ] `NEXT_PUBLIC_SENTRY_DSN` — ativa error tracking automático (obter em sentry.io)
- [ ] `SENTRY_ORG` — slug da organização no Sentry
- [ ] `SENTRY_PROJECT` — nome do projeto no Sentry (ex: `clinipharma`)
- [ ] `SENTRY_AUTH_TOKEN` — token para upload de source maps (Settings → Auth Tokens no Sentry)
- [ ] `UPSTASH_REDIS_REST_URL` — ativa rate limit distribuído (obter em upstash.com)
- [ ] `UPSTASH_REDIS_REST_TOKEN` — token de acesso ao Upstash Redis

> Sem essas variáveis a plataforma funciona normalmente. Com elas, erros aparecem no Sentry e o rate limit fica multi-instância safe.

---

## 🚨 AÇÕES OBRIGATÓRIAS ANTES DO LANÇAMENTO COMERCIAL

> Estas ações são pré-requisitos para receber pagamentos reais, notificar clientes e assinar contratos em produção.

### 💳 1. Asaas — Trocar para conta de produção

**Status:** sandbox ativo, recebimento real BLOQUEADO  
**O que fazer:**

1. Acessar [asaas.com](https://asaas.com) → criar conta PJ (necessita CNPJ)
2. Completar verificação de identidade e dados bancários
3. Gerar API Key de produção
4. No Vercel → Environment Variables:
   - Atualizar `ASAAS_API_KEY` → nova chave de produção
   - Atualizar `ASAAS_API_URL` → `https://api.asaas.com/v3` (remover `sandbox.`)
5. No painel Asaas → Configurações → Notificações → Webhooks → Adicionar:
   - URL: `https://clinipharma.com.br/api/payments/asaas/webhook?accessToken=clinipharma_asaas_webhook_2026`
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`

---

### 📝 2. Clicksign — Trocar para conta de produção

**Status:** sandbox ativo, assinaturas têm valor jurídico limitado  
**O que fazer:**

1. Acessar [clicksign.com](https://clicksign.com) → criar conta empresarial
2. Gerar access token de produção
3. No Vercel → Environment Variables:
   - Atualizar `CLICKSIGN_ACCESS_TOKEN` → token de produção
   - Atualizar `CLICKSIGN_API_URL` → `https://app.clicksign.com/api/v1`
4. No painel Clicksign → Configurações → Webhooks → Adicionar:
   - URL: `https://clinipharma.com.br/api/contracts/webhook`
   - Eventos: sign, deadline_exceeded, cancelled, auto_close

---

### 📱 3. WhatsApp — Número dedicado + Evolution API

**Status:** infraestrutura e templates prontos, sem número real  
**O que fazer:**

1. Adquirir chip com número dedicado para a Clinipharma (número que **não seja** usado pessoalmente)
2. Deploy da Evolution API (requer plano pago em Render ou outro host Docker):
   ```
   Imagem Docker: atendai/evolution-api:v2.2.3
   Porta: 8080
   Variáveis obrigatórias:
     AUTHENTICATION_TYPE=apikey
     AUTHENTICATION_API_KEY=clinipharma_evolution_2026
     SERVER_URL=https://<seu-dominio-evolution>
     DATABASE_ENABLED=false
   ```
3. Após deploy, conectar o número WhatsApp:
   - `GET https://<evolution-url>/instance/create` → criar instância `clinipharma`
   - `GET https://<evolution-url>/instance/connect/clinipharma` → escanear QR code com o celular
4. No Vercel → atualizar `EVOLUTION_API_URL` → URL pública da instância Evolution
5. Configurar webhook da Evolution para receber confirmações:
   - `POST /webhook/set/clinipharma` com `{ url: "https://clinipharma.com.br/api/webhooks/whatsapp" }`

---

### 📨 4. Twilio SMS — Trocar para conta real

**Status:** test credentials ativas (mensagens NÃO são entregues)  
**O que fazer:**

1. Em [console.twilio.com](https://console.twilio.com) → fazer upgrade para conta real
2. Adquirir número brasileiro +55 (ou usar Alphanumeric Sender ID "Clinipharma" se Twilio permitir no Brasil)
3. No Vercel → atualizar:
   - `TWILIO_ACCOUNT_SID` → Account SID real (encontrar em console.twilio.com → Account Info)
   - `TWILIO_AUTH_TOKEN` → Auth Token real da conta (encontrar em console.twilio.com → Account Info)
   - `TWILIO_PHONE_NUMBER` → número adquirido no Twilio (ex: `+551140028922`)

---

### 🧾 5. NF-e / NFS-e — Após CNPJ com contadora

**Status:** modelo fiscal definido, aguardando CNPJ  
**O que fazer:**

1. Finalizar abertura de empresa (CNPJ) com a contadora
2. Criar conta na [Nuvem Fiscal](https://nuvemfiscal.com.br)
3. Configurar certificado digital A1 na Nuvem Fiscal
4. No Vercel → substituir os 3 `PENDING_CNPJ`:
   - `NUVEM_FISCAL_CLIENT_ID` → client_id da Nuvem Fiscal
   - `NUVEM_FISCAL_CLIENT_SECRET` → client_secret
   - `NUVEM_FISCAL_CNPJ` → CNPJ da Clinipharma (formato `00000000000000`)
5. Implementar emissão de NFS-e na confirmação do repasse ao consultor
6. Orientar farmácias parceiras a emitir NF-e para a clínica em cada entrega

---

## Build e Deploy

- [x] `npm run build` passa sem erros (v1.6.0 auditoria round 2 ✅)
- [x] `npm run lint` passa sem warnings críticos
- [x] Testes unitários passando (155 testes, 9 suítes)
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
- [x] Assinatura eletrônica Clicksign (sandbox → produção pendente, ver item 2 acima)
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
- [x] Contratos digitais via Clicksign (sandbox → produção pendente)

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
- [x] **Rate limiter Redis-ready** — `lib/rate-limit.ts` detecta automaticamente `UPSTASH_REDIS_REST_URL`. Para ativar Redis: adicionar variáveis no Vercel (sem alteração de código).
- [ ] **Ativar Upstash Redis** — adicionar `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` no Vercel quando necessário
- [x] **Sentry instalado e estruturado** — no-op sem `NEXT_PUBLIC_SENTRY_DSN`. Error boundaries integrados com `captureError()`.
- [ ] **Ativar Sentry** — criar projeto em sentry.io e adicionar `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` no Vercel
- [x] **`/api/health` endpoint** — verificação de Supabase + env vars. Configurar UptimeRobot/Better Uptime para monitorar.

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
- [ ] **Clicksign produção ativo** (ver item 2 acima) — obrigatório para contratos com valor jurídico
- [ ] **WhatsApp conectado** (ver item 3 acima) — recomendado para conversão
- [ ] **Twilio produção** (ver item 4 acima) — recomendado para alertas críticos
- [ ] **NF-e ativo** (ver item 5 acima) — obrigatório para operação fiscal legal
- [ ] Primeiro pedido de teste realizado de ponta a ponta em produção

---

_Legenda: [x] = concluído | [ ] = pendente | 🚨 = bloqueante para lançamento real_
