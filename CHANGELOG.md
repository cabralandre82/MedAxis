# Changelog

---

## [1.5.0] — 2026-04-08

### Fixed (Auditoria pré-release)

- **P0 — State machine de status de pedido:** `PHARMACY_ADMIN` podia setar qualquer status arbitrário (inclusive `CANCELED`, `COMMISSION_CALCULATED`). Criado `lib/orders/status-machine.ts` com matriz de transições por papel. Agora toda mudança de status é validada antes de persistir.
- **P0 — Reorder completamente quebrado:** `app/api/orders/reorder/route.ts` usava campos errados (`total_amount` vs `total_price`, `created_by` vs `created_by_user_id`) e não enviava `doctor_id` (coluna `NOT NULL`). Todos os pedidos de repetição falhavam silenciosamente. Corrigido com busca automática do médico principal da clínica.
- **P0 — Reorder gerava código de formato errado:** gerava `PED-{timestamp}` manualmente, bypassando o trigger do banco (`MED-YYYY-NNNNNN`). Corrigido para deixar `code: ''` e o trigger gerar o código padrão.
- **P0 — Webhook Asaas: admin jamais recebia notificação de pagamento confirmado:** `createNotification({ userId: '' })` retorna imediatamente sem fazer nada. Corrigido para `createNotificationForRole('SUPER_ADMIN')`.
- **P0 — Webhook Asaas sem idempotência:** processar `PAYMENT_CONFIRMED` duas vezes avançava o status e criava histórico duplicado. Adicionado guard de idempotência.
- **P0 — Asaas create payment: campo `amount` inexistente na tabela:** deveria ser `gross_amount`. Pagamentos inseridos sem valor.
- **P1 — Farmácia não podia ler documentos dos seus pedidos (RLS):** necessário para execução da manipulação. Policy adicionada.
- **P1 — Sem rate limiting em endpoints sensíveis:** `/forgot-password` e `/registration/submit` expostos a brute force. Rate limiter aplicado.
- **P1 — Sem idempotência em `payments.order_id`:** sem `UNIQUE` constraint, era possível criar múltiplos pagamentos para o mesmo pedido.

### Added

- `lib/orders/status-machine.ts` — máquina de estados com `isValidTransition()` e `getAllowedTransitions()` por papel
- `lib/rate-limit.ts` — rate limiter in-memory (pronto para Upstash Redis em produção multi-instância)
- `lib/utils/cnpj.ts` — validador CNPJ com algoritmo de dígito da Receita Federal
- `tests/unit/status-machine.test.ts` — 13 testes cobrindo transições válidas/inválidas por papel

### Database

- `supabase/migrations/015_audit_fixes.sql`:
  - `UNIQUE(payments.order_id)` — previne cobrança duplicada
  - 9 índices novos em `orders`, `order_items`, `payments`, `profiles`, `clinics`, `order_templates`
  - Precisão financeira ampliada: `numeric(10,2)` → `numeric(15,2)` em todas as colunas de valor
  - `orders.deleted_at` — soft-delete
  - `profiles.last_login_at` — monitoramento de atividade
  - RLS: farmácia lê documentos de seus pedidos
  - RLS: clínica pode cancelar pedido em `DRAFT`/`AWAITING_DOCUMENTS`
  - RLS: DOCTOR pode ver seus próprios pedidos

---

## [1.4.0] — 2026-04-08

### Added

- **Variações de produto:**
  - Tabela `product_variants` com atributos livres (concentração, apresentação, quantidade), preço, custo farmácia e comissão independentes por variante
  - `components/products/product-variants-manager.tsx` — gerenciador inline no formulário de produto; adicionar, editar, marcar padrão, desativar variantes
  - `app/api/products/variants/route.ts` — CRUD completo de variantes (GET, POST, PATCH, DELETE)
  - Migração automática: todos os produtos existentes receberam uma variante "Padrão"
  - `variant_id` adicionado a `order_items` para rastreamento futuro

- **Templates de pedido e Reorder:**
  - Tabela `order_templates` por clínica (todos os membros da clínica enxergam)
  - `components/orders/templates/save-template-modal.tsx` — salva produtos de um pedido como template nomeado
  - `components/orders/templates/templates-list.tsx` — lista de templates na página de pedidos, com botão "Usar"
  - `components/orders/reorder-button.tsx` — botão "Repetir pedido" na tela de detalhe (pedidos concluídos)
  - `app/api/orders/templates/route.ts` — GET/POST/DELETE de templates
  - `app/api/orders/reorder/route.ts` — cria novo pedido a partir de pedido anterior ou template

- **Portal de rastreamento público:**
  - Tabela `order_tracking_tokens` com token único por pedido (gerado automaticamente)
  - `app/track/[token]/page.tsx` — página pública sem autenticação com timeline visual, status atual e ETA estimada; dados financeiros omitidos
  - `app/api/tracking/route.ts` — valida token e retorna dados públicos do pedido
  - Link gerado automaticamente na tela de detalhe do pedido
  - Link expira 30 dias após entrega (configurável via `expires_at`)

- **SLA configurável por farmácia:**
  - Tabela `sla_configs` com thresholds globais (null = padrão) e por farmácia (overrides)
  - 3 níveis de alerta: aviso (warning), alerta (alert), crítico (critical)
  - Seed automático de defaults globais equivalentes aos antigos thresholds hardcoded
  - `components/settings/sla-config.tsx` — UI em Configurações para editar SLA global e por farmácia
  - `app/api/settings/sla/route.ts` — GET/PATCH para leitura e atualização
  - `lib/stale-orders.ts` refatorado para usar DB com fallback

- **BI Avançado (4 novos gráficos em Relatórios):**
  - **Comparação de períodos** — métricas do período atual vs. anterior com delta %
  - **Ranking de clínicas** — top 10 por receita com barras proporcionais
  - **Funil de conversão** — pedidos por etapa (criados → pagos → execução → entregues)
  - **Margem real por produto** — empilhado: custo farmácia + comissão consultor + margem plataforma
  - `components/reports/advanced-bi.tsx` — 4 componentes Recharts independentes

- **Histórico de sessões:**
  - Tabela `access_logs` com IP, user-agent, detecção de novo dispositivo, retenção 90 dias
  - `lib/session-logger.ts` — registra acesso; envia alerta in-app em novo dispositivo
  - `app/api/sessions/route.ts` — GET (usuário vê próprios logs, admin vê todos) + POST (registra sessão)
  - `components/profile/session-history.tsx` — UI no perfil com browser, OS, IP, badge "Novo dispositivo"

### Database

- `supabase/migrations/014_templates_sla_variants_tracking_sessions.sql`:
  - Tabelas: `order_templates`, `sla_configs`, `order_tracking_tokens`, `product_variants`, `access_logs`
  - RLS em todas as novas tabelas
  - Triggers `updated_at` nas tabelas relevantes
  - Seed de 11 configs SLA globais padrão

---

## [1.3.0] — 2026-04-10

### Added

- **Firebase Push Notifications (FCM):**
  - `lib/firebase-admin.ts` — Firebase Admin SDK singleton (server-side)
  - `lib/push.ts` — `sendPushToUser` / `sendPushToRole` helpers
  - `lib/notification-types.ts` — tipos/constantes separados para uso client-side sem dependências Node.js
  - `public/firebase-messaging-sw.js` — service worker para mensagens em background
  - `lib/firebase/client.ts` — SDK cliente; `requestPushPermission` (captura token FCM) + `onForegroundMessage` (toast em foreground)
  - `components/push/push-permission.tsx` — botão no header para solicitar permissão; exibe status ativo/bloqueado
  - `app/api/push/subscribe/route.ts` — `POST`/`DELETE` para salvar/remover FCM tokens na tabela `fcm_tokens`
  - `lib/notifications.ts` — agora envia push automático para `CRITICAL_TYPES`; suporte a `push` flag por notificação
  - ~~Pendente VAPID key~~ ✅ **Configurada:** `BNrMF4L9UwGqH3dHkIZp9-plConcw5YXpcTbfL-mF6_XTv6oIlV10Buw1sgCqd-YVveXECTWcxvWxXgbgf_VQ-U` no Vercel. Push notifications FCM totalmente operacionais.

- **Asaas Payment Gateway (sandbox):**
  - `lib/asaas.ts` — wrapper completo: `findOrCreateCustomer`, `createPayment`, `getPixQrCode`, `cancelPayment`, validação de webhook
  - `app/api/payments/asaas/create/route.ts` — `POST`: cria cobrança Asaas para um pedido; salva `asaas_payment_id`, QR PIX, boleto URL, invoice URL
  - `app/api/payments/asaas/webhook/route.ts` — recebe eventos Asaas (`PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`); avança status do pedido; dispara notificação in-app + push + SMS + WhatsApp + email
  - `components/orders/payment-options.tsx` — UI com abas PIX (QR Code + copia-e-cola), Boleto e Cartão; botão de geração para admins
  - Integrado na tela de detalhe do pedido (status `AWAITING_PAYMENT`)
  - **Variáveis Vercel configuradas:** `ASAAS_API_KEY`, `ASAAS_API_URL` (sandbox), `ASAAS_WEBHOOK_SECRET`
  - **Pendente produção:** substituir sandbox URL/key; configurar webhook no painel Asaas → `https://clinipharma.com.br/api/payments/asaas/webhook?accessToken=<secret>`

- **SMS via Twilio (test credentials):**
  - `lib/sms.ts` — `sendSms` com normalização de número BR; templates para eventos críticos
  - Integrado no webhook Asaas (PAYMENT_CONFIRMED → SMS à clínica)
  - **Variáveis Vercel:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (test), `TWILIO_PHONE_NUMBER` (+15005550006 test)
  - **Pendente produção:** conta real Twilio + número BR +55

- **WhatsApp via Evolution API (infraestrutura pronta, deploy pendente):**
  - `lib/whatsapp.ts` — wrapper `sendWhatsApp` + templates completos (pedido criado/confirmado/pronto/enviado/entregue, contrato enviado, cadastro aprovado/reprovado, alerta parado)
  - Integrado no webhook Asaas e notificações
  - **Pendente:** (1) número WhatsApp; (2) deploy Evolution API (Docker `atendai/evolution-api:v2.2.3` em Render/VPS pago ou Railway); (3) atualizar `EVOLUTION_API_URL` no Vercel

- **Assinatura eletrônica Clicksign (sandbox):**
  - `lib/clicksign.ts` — `generateContractPdf` (gera PDF A4 com `pdf-lib`), `uploadDocument`, `addSigner`, `notifySigners`, `createAndSendContract`
  - Templates de contrato para CLINIC, DOCTOR, PHARMACY, CONSULTANT
  - `app/api/contracts/route.ts` — `POST` (SUPER_ADMIN cria e envia contrato) + `GET` (lista contratos por entidade)
  - `app/api/contracts/webhook/route.ts` — recebe eventos Clicksign (`sign`, `auto_close`, `deadline_exceeded`, `cancelled`); atualiza status + notifica usuário
  - `components/contracts/contract-status.tsx` — exibe status do contrato com badge, data de assinatura e link para download
  - Botão "Enviar contrato" adicionado em `RegistrationActions` (aprovação de clínica/médico)
  - **Variáveis Vercel:** `CLICKSIGN_ACCESS_TOKEN` (sandbox), `CLICKSIGN_API_URL` (sandbox)
  - **Pendente produção:** token + URL produção Clicksign; configurar webhook → `https://clinipharma.com.br/api/contracts/webhook`

- **NF-e / NFS-e — modelo fiscal definido (implementação pendente CNPJ):**
  - Modelo: Clinipharma recebe pagamento integral → repassa `pharmacy_cost` à farmácia + `consultant_commission` ao consultor → retém margem
  - Farmácia emite NF-e para a clínica (produtos); Clinipharma emite NFS-e para a clínica (serviço de intermediação)
  - Integrador escolhido: **Nuvem Fiscal**
  - **Variáveis Vercel pré-configuradas:** `NUVEM_FISCAL_CLIENT_ID`, `NUVEM_FISCAL_CLIENT_SECRET`, `NUVEM_FISCAL_CNPJ` (todos com valor `PENDING_CNPJ`)
  - **Pendente:** CNPJ + regime tributário com contadora → substituir valores no Vercel → implementar emissão

### Database

- **Migration 013 (`013_payments_push_contracts.sql`) aplicada:**
  - `fcm_tokens` — armazena tokens FCM por usuário (com RLS)
  - `payments.asaas_payment_id`, `asaas_invoice_url`, `asaas_pix_qr_code`, `asaas_pix_copy_paste`, `asaas_boleto_url`, `payment_link`, `payment_due_date` — campos do gateway Asaas
  - `clinics.asaas_customer_id` — ID do cliente no Asaas (evita re-criação)
  - `contracts` — contratos digitais com status, chaves Clicksign, signatários (com RLS)

### Tests

- **142 testes unitários passando (zero falhas)**
- `tests/setup.ts` atualizado: mocks para `firebase-admin`, Firebase client SDK e Twilio (evita inicialização de credenciais nos testes)
- `tests/unit/notifications.test.ts` — atualizado para importar de `@/lib/notification-types` (sem dependências Node.js)

---

## [1.2.0] — 2026-04-10

### Added

- **Filtro de período nos relatórios:** `DateRangePicker` com atalhos (Hoje, Esta semana, Este mês, Mês anterior, Últimos 3/6/12 meses, Personalizado). Padrão: Este mês. Persiste em URL params (`?from=&to=&preset=`). Todos os KPIs e gráficos filtrados pelo período.
- **Gráficos interativos com Recharts:** substituídas as barras CSS por:
  - `OrdersBarChart` — pedidos por período (BarChart)
  - `RevenueBarChart` — faturamento por período (BarChart)
  - `StatusPieChart` — pedidos por status (donut chart)
  - `PharmacyRevenueChart` — faturamento por farmácia (horizontal bar)
  - `ConsultantCommChart` — comissões por consultor (horizontal bar)
  - Todos com tooltip, hover e valores formatados em R$
- **Export filtrado por período:** botão de exportação em relatórios agora passa `from`/`to` para a API; nome do arquivo inclui o período (ex: `pedidos_2026-04-01_a_2026-04-30.csv`).
- **Alertas de pedidos parados:**
  - Widget vermelho no dashboard do SUPER_ADMIN e PHARMACY_ADMIN listando pedidos stale com link direto
  - Thresholds: 3 dias (fases financeiras/docs), 5 dias (fases operacionais)
  - Vercel Cron (`0 8 * * *`) em `/api/cron/stale-orders`: notificação in-app + email digest para SUPER_ADMIN e farmácia responsável pelos pedidos dela
  - Tipo `STALE_ORDER` adicionado a `NotificationType`
- **Preferências de notificação por usuário:**
  - Migration 012: coluna `notification_preferences jsonb` em `profiles` (default `{}`)
  - Críticas (sempre enviadas): `ORDER_CREATED`, `ORDER_STATUS`, `PAYMENT_CONFIRMED`, `DOCUMENT_UPLOADED`
  - Silenciáveis: `TRANSFER_REGISTERED`, `CONSULTANT_TRANSFER`, `PRODUCT_INTEREST`, `REGISTRATION_REQUEST`, `STALE_ORDER`
  - UI em `/profile` — seção "Preferências de notificação" com toggles por tipo
  - API `PATCH /api/profile/notification-preferences` persiste as preferências
  - `lib/notifications.ts` checa `notification_preferences` antes de inserir qualquer notificação (críticos ignoram a preferência)
- **Variável de ambiente `CRON_SECRET`:** adicionada ao `.env.local` (desenvolvimento) e ao Vercel via API REST (Production + Preview + Development). Redeploy disparado e concluído automaticamente.

### Tests

- **142 testes unitários passando (zero falhas):** 56 novos testes em 3 novos arquivos.
- **`tests/unit/stale-orders.test.ts`** (19 casos): cobre `getStaleThreshold` (thresholds corretos por fase, null para terminais), `getDaysDiff` (com fake timers), e lógica de detecção de pedido parado.
- **`tests/unit/notifications.test.ts`** (20 casos): valida `SILENCEABLE_TYPES`, `CRITICAL_TYPES`, disjunção entre os dois conjuntos, e semântica de preferências (tipos críticos sempre ativos; silenciáveis respeitam `prefs[type] !== false`).
- **`tests/unit/date-range.test.ts`** (17 casos): testa as funções puras `today`, `daysAgo`, `startOfMonth`, `endOfMonth`, `startOfYear` e garante que todos os presets têm `from <= to`.

---

## [1.1.0] — 2026-04-10

### Fixed

- **Upload de documentos no fluxo PENDING_DOCS:** a página `/profile` agora detecta automaticamente quando o usuário está com status `PENDING_DOCS` e exibe um bloco laranja no topo com a lista exata de documentos solicitados pelo admin, incluindo texto personalizado ("Outro"). Cada documento tem botão de upload individual com troca de arquivo.
- **Re-notificação ao SUPER_ADMIN:** após o usuário enviar os documentos extras, a API `POST /api/registration/upload-docs` reverte o status para `PENDING`, envia notificação in-app e email HTML a todos os SUPER_ADMINs com link direto para a solicitação.
- **Status do cadastro visível em /profile:** campo "Status do cadastro" exibido na sidebar de informações quando o usuário não está APPROVED.

### Tests

- **86 testes unitários passando (zero falhas):** corrigido prefixo `CP-` em `generateOrderCode`; `orderSchema` refatorado para `items array`; `clinicSchema` e `productSchema` validados com campos reais.
- **Novo arquivo `tests/unit/registration.test.ts`:** 13 casos cobrindo `CLINIC_REQUIRED_DOCS`, `DOCTOR_REQUIRED_DOCS`, labels, cores de status e `ALL_REQUESTABLE_DOCS`; duplicata `OPERATING_LICENSE` removida de `EXTRA_DOC_OPTIONS`.
- **E2E (Playwright) expandido:** credenciais atualizadas; 10 novos casos em `auth.test.ts` cobrindo `/registro`; `catalog.test.ts` expandido com filtros, modal de interesse, painéis `/registrations` e `/interests`.

---

## [1.0.0] — 2026-04-10

### Added

- **Auto-cadastro de clínicas e médicos (`/registro`):**
  - Página pública multi-step: escolha de perfil (Clínica ou Médico) → dados cadastrais → upload de documentos obrigatórios
  - Conta criada imediatamente com `registration_status: PENDING`; usuário pode logar e navegar, mas não pode criar pedidos até aprovação
  - Email de confirmação enviado ao solicitante; email + notificação in-app ao SUPER_ADMIN
  - Farmácias continuam sendo cadastradas exclusivamente pelo SUPER_ADMIN (sem auto-cadastro)

- **Fluxo de aprovação (painel `/registrations`):**
  - Lista filtrável por status: Aguardando análise / Documentos pendentes / Aprovado / Reprovado
  - Página de detalhe com todos os dados e documentos do solicitante (links para abrir cada arquivo)
  - Três ações exclusivas do SUPER_ADMIN:
    - **Aprovar** → cria a entidade (clínica ou médico), email de boas-vindas com link para o usuário definir a própria senha (mesmo mecanismo da recuperação de senha)
    - **Reprovar** → modal com campo de motivo, email com a justificativa enviado ao solicitante
    - **Pedir documentos** → seleção de lista predefinida + campo livre "Outro", email e notificação in-app ao solicitante
  - Item "Cadastros" adicionado à sidebar do SUPER_ADMIN com ícone `ClipboardList`

- **Welcome email com definição de senha:**
  - Qualquer usuário criado pelo admin (farmácia, clínica, médico via painel) recebe email com link "Definir minha senha" gerado via `supabase.auth.admin.generateLink({ type: 'recovery' })`
  - Campo de senha removido do formulário de criação de usuário pelo admin; sistema gera senha temporária internamente

- **Banner de status no dashboard:**
  - Usuários PENDING: banner âmbar "Cadastro em análise"
  - Usuários PENDING_DOCS: banner laranja "Documentos pendentes" com link para `/profile`
  - Usuários REJECTED: banner vermelho "Cadastro não aprovado"

- **Bloqueio de criação de pedidos:**
  - Redirecionamento automático para `/dashboard` ao tentar acessar `/orders/new` sem `registration_status = APPROVED`

- **Seleção de clínica no pedido para médicos:**
  - Médicos vinculados a uma só clínica: clínica auto-selecionada
  - Médicos com múltiplas clínicas: dropdown exibe apenas as clínicas vinculadas ao médico
  - Vinculação via tabela `doctor_clinic_links`

- **Link "Solicitar cadastro" na tela de login** aponta para `/registro`

- **Migration `011_registration_flow.sql`:**
  - Campo `registration_status text DEFAULT 'APPROVED' CHECK (IN ('PENDING','PENDING_DOCS','APPROVED','REJECTED'))` em `profiles`
  - Tabela `registration_requests` (tipo, status, form_data jsonb, user_id, entity_id, admin_notes, requested_docs jsonb, reviewer info, timestamps)
  - Tabela `registration_documents` (request_id, document_type, label, filename, storage_path, public_url)
  - Bucket `registration-documents` (privado) no Supabase Storage
  - RLS em ambas as tabelas (owner, admins, service_role)

- **Novos tipos:** `RegistrationStatus`, `RegistrationType`, `RequestedDoc`, `RegistrationRequest`, `RegistrationDocument` em `types/index.ts`

- **Constantes de registro:** `lib/registration-constants.ts` — listas de documentos obrigatórios por tipo, opções extras, labels e cores de status

- **Novo tipo de notificação `REGISTRATION_REQUEST`** adicionado a `lib/notifications.ts`

### Changed

- `services/users.ts`: campo `password` agora opcional; sistema gera senha temporária e envia welcome email automaticamente
- `middleware.ts`: `/registro` e `/api/registration/submit` adicionados às rotas públicas
- `ProfileWithRoles` e `Profile` agora expõem `registration_status`

---

## [0.9.0] — 2026-04-09

### Added

- **Status `unavailable` nos produtos:** terceiro estado além de `active` e `inactive`. No formulário de produto, o toggle virou um select de 3 opções (✅ Ativo / ⚠️ Indisponível / 🚫 Inativo).
- **Botão "Tenho interesse" no catálogo:** produtos indisponíveis aparecem com imagem em grayscale, overlay "Indisponível" e botão âmbar no lugar de "Ver detalhes".
- **Modal de interesse:** formulário com nome e WhatsApp (sempre em branco), confirmação visual após envio.
- **API `POST /api/products/interest`:** valida dados, salva na tabela `product_interests`, dispara notificação in-app e email ao SUPER_ADMIN com link clicável para WhatsApp.
- **Painel `/interests`:** exclusivo para SUPER_ADMIN. Lista todos os interesses registrados (produto, interessado, WhatsApp clicável, email, data) com paginação. Card de resumo dos produtos com mais interesse no topo. Adicionado à sidebar.
- **Notificação in-app (`PRODUCT_INTEREST`):** novo tipo no `NotificationType`, envia para todos os usuários com papel `SUPER_ADMIN`.
- **Email ao SUPER_ADMIN:** HTML com tabela de dados do interessado + botão "Ver todos os interesses" linkando para `/interests`.
- **Migration `010_product_status_interests.sql`:** adiciona coluna `status` em `products` com constraint `CHECK (status IN ('active','unavailable','inactive'))`; cria tabela `product_interests` com RLS.

### Changed

- Catálogo (`/catalog`) agora filtra por `status IN ('active', 'unavailable')` em vez de `active = true`, exibindo produtos indisponíveis com visual diferenciado.
- `ProductCard` no `CatalogGrid` virou Client Component para suportar abertura do modal de interesse.
- `services/products.ts`: na criação/atualização, o campo `active` é derivado automaticamente do `status` (`status !== 'inactive'`).
- `types/index.ts`: campo `status` adicionado em `Product`; novo tipo `ProductInterest`.
- `lib/validators`: novo schema `productInterestSchema`; campo `status` adicionado em `productSchema`.

---

## [0.8.0] — 2026-04-09

### Added

- **Fluxo completo de recuperação de senha end-to-end:**
  - Rota `POST /api/auth/forgot-password` — gera `token_hash` via `supabase.auth.admin.generateLink()` e envia email HTML diretamente pelo Resend, sem depender de SMTP ou Auth Hooks
  - Callback `/auth/callback` agora trata dois fluxos: `token_hash` + `verifyOtp` (recovery) e `code` + `exchangeCodeForSession` (PKCE/OAuth)
  - Nova página `/reset-password` — formulário com validação de senha (mín. 8 chars) e confirmação; após salvar redireciona para o dashboard
  - Edge Function `send-auth-email` deployada no Supabase (reserva para Auth Hook, não utilizada ativamente)
- **Usuário SUPER_ADMIN real cadastrado:** `cabralandre@yahoo.com.br` (André) com acesso completo à plataforma

### Fixed

- Middleware: adicionado `/api/auth/forgot-password` e `/reset-password` às rotas públicas — sem isso o middleware redirecionava o POST para `/login` causando erro 405
- `tsconfig.json`: exclui `supabase/functions/` do TypeScript do Next.js para evitar conflito com tipos Deno
- `NEXT_PUBLIC_APP_URL` substituído por detecção dinâmica do `origin` no header da requisição — funciona corretamente em qualquer ambiente (local, preview, produção)

---

## [0.7.0] — 2026-04-09

### Added

- **Paginação server-side** em todas as listagens (20 itens/página, Auditoria 50). Componente `Pagination` com elipsis, first/last e navegação por URL (`?page=N`).
- **Catálogo melhorado:** filtro de categoria corrigido (usa `category_id`), ordenação configurável (destaque, A–Z, menor/maior preço, mais recente), paginação de 12/página.
- **Notificações in-app:** tabela `notifications` com RLS e realtime. Sino no header com badge de contagem, dropdown, marcar como lida/todas, navegação ao link. Integrado em: criação de pedido, confirmação de pagamento, status do pedido e conclusão de repasse.
- **Exportação CSV/Excel:** `ExportButton` com dropdown CSV/xlsx em Pedidos (admins), Pagamentos, Repasses e Repasses a Consultores. Rota `/api/export?type=&format=` protegida por RBAC.
- **Dashboard de relatórios enriquecido:** KPIs com ícones e cores, gráfico de barras CSS (últimos 6 meses), breakdown de status com barra de progresso, cards de entidades, alertas de pendências financeiras no topo.
- **Busca global `⌘K`** no header: pesquisa pedidos, clínicas, médicos e produtos em tempo real com debounce 300ms, navegação por teclado (↑↓ Enter Esc), ícones por tipo.
- **Gestão de documentos por tipo:** `DocumentManager` com checklist de tipos obrigatórios (receita médica, identidade, relatório médico, autorização, outro), indicadores visual presente/ausente, upload adicional diretamente no detalhe do pedido.
- Rota `POST /api/documents/upload` — upload seguro para Supabase Storage com RBAC (max 10 MB, PDF/JPG/PNG).
- Cloudflare DNS configurado e propagado. Domínio `clinipharma.com.br` ativo com HTTPS.
- Resend verificado e emails transacionais ativos em produção.

### Changed

- Todas as listagens agora usam `.range()` + `count: 'exact'` para total real no servidor.
- `CatalogFilters` reseta `?page` ao trocar qualquer filtro para evitar página fora do range.
- `lib/utils` ganhou `parsePage` e `paginationRange` helpers.

---

## [0.6.0] — 2026-04-09

### Added

- **Múltiplos produtos por pedido:** nova tabela `order_items` com campos congelados (`unit_price`, `pharmacy_cost_per_unit`, `platform_commission_per_unit`) por item. A tabela `orders` passa a ser cabeçalho do pedido.
- Formulário de criação de pedido virou um **carrinho**: permite adicionar N produtos da mesma farmácia com quantidade individual e resumo em tempo real.
- Página de detalhe do pedido exibe tabela de itens com subtotal por linha.
- Trigger `freeze_order_item_price` congela preço e custos no INSERT de cada `order_item`.
- Trigger `recalc_order_total` recalcula `orders.total_price` automaticamente após qualquer alteração em `order_items`.
- RLS para `order_items` espelhando as políticas de `orders`.

### Changed

- `orders` não possui mais as colunas `product_id`, `quantity`, `unit_price`, `pharmacy_cost_per_unit`, `platform_commission_per_unit` (migradas para `order_items`).
- `services/payments.ts` agora soma os custos de todos os itens para calcular repasse e comissão.
- `services/orders.ts` aceita array de itens na criação.
- `types/index.ts` — novo tipo `OrderItem`; `Order` atualizado.

---

## [0.5.0] — 2026-04-09

### Alterado

- **Renomeação da plataforma: MedAxis → Clinipharma**
  - Substituição global em todo o codebase (58 arquivos): nome, URLs, emails, metadados
  - Prefixo dos códigos de pedido: `MED-` → `CP-` (ex: `CP-2026-000001`)
  - Migration 006: atualiza `app_settings` (platform_name, support_email) e recria trigger `generate_order_code()` com prefixo `CP-`
  - Emails atualizados: `noreply@clinipharma.com.br`, `suporte@clinipharma.com.br`
  - Repositório GitHub: `cabralandre82/MedAxis` (pendente renomear)
  - Domínio: `clinipharma.com.br` (configuração de DNS em andamento)

- **Email transacional ativado com Resend**
  - `RESEND_API_KEY` configurada em `.env.local` e pendente no Vercel
  - 5 templates ativos: novo pedido, pagamento confirmado, repasse à farmácia, status atualizado, repasse a consultor

---

## [0.4.0] — 2026-04-08

### Adicionado

- **Custo de repasse por produto (`pharmacy_cost`)**
  - Campo `pharmacy_cost` obrigatório em `products` — valor fixo que a plataforma deve repassar à farmácia por unidade vendida
  - Campos `pharmacy_cost_per_unit` e `platform_commission_per_unit` em `orders` — congelados no `INSERT` via trigger junto com `unit_price`
  - Migration 005 aplica todas as alterações de schema

- **Painel de análise de margem no formulário de produto**
  - Preview em tempo real: preço ao cliente → repasse farmácia → margem bruta → comissão do consultor → lucro líquido (com e sem consultor)
  - Aviso em vermelho quando `pharmacy_cost` é tão alto que a margem bruta não cobre a comissão global dos consultores

- **Seção "Análise de margem" no detalhe do produto**
  - Breakdown estático completo: margem bruta em R$ e %, comissão de consultor, lucro líquido nos dois cenários

### Alterado

- **Comissão de consultores: de individual para global**
  - `sales_consultants.commission_rate` removido — taxa não é mais por consultor
  - Nova chave `consultant_commission_rate` em `app_settings` — percentual único aplicado a todos os consultores sobre o valor total de cada pedido
  - Página de Configurações atualizada com label, hint descritivo e unidade (%)
  - Formulário, listagem e detalhe de consultores: campo `commission_rate` removido; informativo sobre taxa global adicionado

- **`services/payments.ts` — cálculo financeiro na confirmação de pagamento**
  - Usa `pharmacy_cost_per_unit` e `platform_commission_per_unit` congelados no pedido (fallback para produto atual em pedidos antigos)
  - Busca `consultant_commission_rate` de `app_settings` em vez de `commission_rate` do consultor

- **`app_settings`**: `default_commission_percentage` substituído por `consultant_commission_rate` (padrão: 5%)

### Regras de negócio acrescentadas

- RN-16 a RN-19: custo de farmácia por produto, congelamento no pedido, margem da plataforma e regra de não-prejuízo para consultores (ver `BUSINESS_RULES.md`)

---

## [0.3.0] — 2026-04-09

### Adicionado

- **Módulo de Consultores de Vendas**
  - Tabelas: `sales_consultants`, `consultant_commissions`, `consultant_transfers` (migration 004)
  - `clinics.consultant_id` — FK vinculando cada clínica ao seu consultor
  - CRUD completo: `/consultants`, `/consultants/new`, `/consultants/[id]`, `/consultants/[id]/edit`
  - Página `/consultant-transfers` — comissões pendentes + registro de repasse em batch
  - `AssignConsultantDialog` — vincula/troca consultor diretamente no detalhe da clínica
  - `ConsultantTransferDialog` — registra repasse batch com referência e observações
  - Dashboard do consultor (`SALES_CONSULTANT`) — KPIs, clínicas vinculadas, histórico de comissões
  - `services/consultants.ts` — createConsultant, updateConsultant, updateStatus, assignToClinic, registerTransfer
  - Auto-criação de `consultant_commission` na confirmação de pagamento (`services/payments.ts`)
  - Role `SALES_CONSULTANT` adicionado ao sistema de papéis
  - Suporte ao role `SALES_CONSULTANT` na criação de usuários com vínculo de `consultant_id`
  - Sidebar: itens "Consultores" e "Repasses Consultores" para admins

### Alterado

- **RBAC: Consultores restrito ao SUPER_ADMIN**
  - `PLATFORM_ADMIN` pode somente visualizar listagem e detalhes de consultores
  - Criação, edição, vinculação e repasse a consultores: exclusivo `SUPER_ADMIN`
  - Proteção em duas camadas: UI (botões ocultos) + backend (Server Actions rejeitam)
- `RBAC_MATRIX.md` — atualizado com coluna `SALES_CONSULTANT` e novos módulos

---

## [0.2.0] — 2026-04-09

### Adicionado

- **Gestão de Usuários** (`/users`, `/users/new`, `/users/[id]`)
  - Criação de usuário via Supabase Admin API (auth + profile + role + vínculo de org)
  - Redefinição de senha pelo admin (`ResetPasswordDialog`)
  - Listagem com busca por nome, email e papel
- **Página de Perfil** (`/profile`) — qualquer usuário edita nome e telefone
- **CRUD completo de entidades**
  - Clínicas: `/clinics/new`, `/clinics/[id]`, `/clinics/[id]/edit`, controle de status
  - Médicos: `/doctors/new`, `/doctors/[id]`, `/doctors/[id]/edit`
  - Farmácias: `/pharmacies/new`, `/pharmacies/[id]`, `/pharmacies/[id]/edit`, dados bancários
  - Produtos: `/products/new`, `/products/[id]`, `/products/[id]/edit`, histórico de preço
- **`PriceUpdateForm`** — dialog com campo de motivo obrigatório para atualização de preço
- **`PharmacyOrderActions`** — farmácia avança status do pedido (execução → enviado → entregue)
- **`ClinicStatusActions`** — dropdown de transição de status para clínicas
- **`services/clinics.ts`** — createClinic, updateClinic, updateClinicStatus
- **`services/doctors.ts`** — createDoctor, updateDoctor, linkDoctorToClinic
- **`services/pharmacies.ts`** — createPharmacy, updatePharmacy, updatePharmacyStatus
- **`services/products.ts`** — createProduct, updateProduct, updateProductPrice, toggleActive
- **`services/users.ts`** — createUser, updateUserProfile, assignUserRole, resetUserPassword, deactivateUser, updateOwnProfile
- **`components/shared/status-badge.tsx`** — EntityStatusBadge e OrderStatusBadge
- **`next.config.ts`** — imagens Supabase Storage + serverActions bodySizeLimit 10MB
- **`vercel.json`** — configuração de deploy com região GRU (São Paulo)
- Sidebar: item "Usuários" (admins) e ícone separado para Produtos (Package)
- Header: link "Meu perfil" aponta para `/profile`

### Infraestrutura (produção)

- Migrations aplicadas no Supabase via `supabase db push`
- Seed executado: 5 categorias, 2 farmácias, 2 clínicas, 2 médicos, 5 produtos
- Storage buckets criados: `product-images` (público) e `order-documents` (privado)
- 5 usuários criados com papéis e vínculos de organização
- Deploy realizado na Vercel — https://clinipharma-three.vercel.app
- Supabase Auth configurado com Site URL e Redirect URLs de produção

### Corrigido

- `lib/db/server.ts` — exporta `createServerClient` como alias de `createClient`
- `EntityStatus` — adicionados `INACTIVE` e `SUSPENDED`
- `OrderStatus` no status-badge alinhado com valores reais do banco
- `ProductPriceHistory` — campo `price` correto (substituía `old_price`/`new_price`)
- `DialogTrigger` e `DropdownMenuTrigger` — substituído `asChild` por `render` prop (base-ui)
- Imports `Button` não utilizados removidos de múltiplos componentes

---

## [0.1.0] — 2026-04-08

### Adicionado

- Bootstrap Next.js 15 + TypeScript + Tailwind CSS v4 + shadcn/ui
- ESLint, Prettier, Husky, lint-staged
- Estrutura completa de pastas e tipos TypeScript
- Documentação base: README, PRODUCT_OVERVIEW, PRD, ARCHITECTURE, DATABASE_SCHEMA, RBAC_MATRIX, BUSINESS_RULES, DEPLOY, USER_FLOWS, TEST_PLAN, CHANGELOG
- Migrations do banco de dados (001 schema, 002 functions/triggers, 003 RLS policies)
- Autenticação Supabase Auth (email/senha, recuperação de senha)
- Middleware de proteção de rotas + RBAC com guards de papel
- Layout base (sidebar, header, shell) com navegação dinâmica por papel
- Dashboard diferenciado por papel (admin, clínica, médico, farmácia)
- Catálogo privado com filtros por categoria, farmácia e busca
- Página de detalhe de produto
- Criação de pedidos com congelamento de preço por trigger de banco
- Upload de documentos obrigatório para Supabase Storage
- Timeline de status do pedido com histórico
- Módulo de pagamentos — confirmação manual pelo admin
- Módulo de comissões — cálculo automático no momento da confirmação
- Módulo de repasses — registro manual de transferência
- Logs de auditoria automáticos em todas as ações críticas
- Configurações globais (comissão default)
- Relatórios com KPIs operacionais e financeiros
- Testes unitários com Vitest (46 testes)
- Testes E2E com Playwright
- Seeds de desenvolvimento
