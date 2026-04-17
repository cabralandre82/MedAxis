# DIRETIVA DE AUDITORIA TOTAL — CLINIPHARMA B2B MED PLATFORM

# OPERAÇÃO PENTE-FINO PRÉ-RELEASE (VERSÃO FINAL)

> **INSTRUÇÃO AO LLM:** Este prompt deve ser executado com o código-fonte completo do
> repositório anexado ou disponível no contexto. Pastas obrigatórias: `/app`, `/services`,
> `/lib`, `/components`, `/types`, `/supabase/migrations`, `/tests`, `/middleware.ts`,
> `vercel.json`, `package.json`.
>
> **REGRA INQUEBRÁVEL:** Você está PROIBIDO de resumir, agrupar ou pular seções.
> Cada item numerado exige uma análise individual com veredicto. Se a resposta
> ultrapassar o limite de tokens, pare, indique "CONTINUA NA PARTE N" e aguarde
> o comando "continue". Não comprima informação para caber numa única resposta.

---

## O SISTEMA SOB AUDITORIA

**Clinipharma** é um marketplace B2B de medicamentos manipulados que conecta
Clínicas Médicas (compradores), Farmácias de Manipulação (fornecedores) e
Consultores de Vendas (comissionados). A plataforma gerencia o ciclo completo:
cadastro com aprovação, catálogo de produtos, pedidos, pagamentos, repasses
financeiros, comissões, contratos DPA (LGPD), documentos/receitas médicas,
notificações multicanal e auditoria.

### Stack Técnica

- **Frontend/Backend:** Next.js 15 App Router (RSC + Server Actions), Vercel (região GRU1)
- **Banco/Auth/Storage:** Supabase (PostgreSQL 15, Auth JWT, Row Level Security, Realtime WebSockets, Storage Buckets)
- **Segurança de Acesso:** Camada mista — RLS em algumas tabelas, `adminClient` (bypass RLS com Service Role Key) em Server Actions, com `requireRole()` + ownership checks em código TypeScript
- **Pagamentos:** Asaas (gateway brasileiro — PIX, Boleto, Cartão). Webhooks processados via Inngest
- **Background Jobs:** Inngest (7 funções: asaas-webhook, contract-auto-send, stale-orders, churn-detection, reorder-alerts, product-recommendations, export-orders)
- **Cron Jobs:** 11 crons Vercel (stale-orders, purge-revoked-tokens, revalidate-pharmacies, enforce-retention, purge-drafts, coupon-expiry-alerts, reorder-alerts, churn-check, product-recommendations, expire-doc-deadlines, purge-server-logs)
- **Mensageria:** Zenvia (SMS ativo, WhatsApp adiado), Resend (e-mails transacionais), Firebase Cloud Messaging (push notifications)
- **Contratos:** Clicksign (assinatura digital de DPA/LGPD)
- **WAF:** Cloudflare Free (Managed Ruleset 26 regras + rate limit 17req/10s em /api/)
- **Fiscal:** NFS-e via Nuvem Fiscal (emissão assíncrona)
- **Monitoramento:** Sentry (erros), OpenTelemetry (traces)
- **AI Features:** OpenAI (OCR de documentos, recomendações de produtos, churn detection, lead scoring)
- **UI:** Tailwind CSS, shadcn/ui, Recharts, React Hook Form + Zod

### Entidades e Roles

- `SUPER_ADMIN` / `PLATFORM_ADMIN` — Administração total
- `CLINIC_ADMIN` — Comprador (clínica médica)
- `DOCTOR` — Médico (pode comprar solo ou via clínica)
- `PHARMACY_ADMIN` — Fornecedor (farmácia de manipulação)
- `SALES_CONSULTANT` — Comissionado por indicação

### Modelo Financeiro (Semi-Manual)

1. Clínica paga via Asaas → dinheiro cai na wallet Asaas da plataforma
2. Sistema calcula: `pharmacy_cost` (repasse farmácia), `platform_commission`, `consultant_commission`
3. Admin paga farmácia e consultor **manualmente** (TED/Pix externo)
4. Admin registra o repasse no sistema → pedido avança na máquina de estados

### Máquina de Estados do Pedido (18 estados)

`DRAFT` → `AWAITING_DOCUMENTS` → `READY_FOR_REVIEW` → `AWAITING_PAYMENT` →
`PAYMENT_UNDER_REVIEW` → `PAYMENT_CONFIRMED` → `COMMISSION_CALCULATED` →
`TRANSFER_PENDING` → `TRANSFER_COMPLETED` → `RELEASED_FOR_EXECUTION` →
`RECEIVED_BY_PHARMACY` → `IN_EXECUTION` → `READY` → `SHIPPED` → `DELIVERED` →
`COMPLETED` | `CANCELED` | `WITH_ISSUE`

### Banco de Dados: 43 Migrations

001-003 (schema base, funções, RLS) → 004-010 (consultores, custos, order_items,
notificações, status/interesse) → 011-013 (registro, preferências, pagamentos/push/contratos) →
014-020 (templates, SLA, variantes, tracking, auditorias, comissões) → 021-028 (tokens
revogados, CNPJ, criptografia PII, perfis, suporte, drafts, cupons) → 029-035 (AI, receitas,
churn, médico opcional, revisão docs, realtime orders/notifications) → 036-043 (price review,
cancelamento financeiro, distribuidores, manipulados, compra solo médico, NFS-e, server logs)

---

## 📐 FRAMEWORK DE AUDITORIA: AS 20 LENTES DE ANÁLISE

Cada lente representa a perspectiva implacável de um executivo ou arquiteto sênior
(30+ anos, QI 180+) que seria **demitido pessoalmente** se a falha existir em produção.

### LENTE 1 — CISO (Chief Information Security Officer): SUPERFÍCIE DE ATAQUE

Para cada rota pública ou semi-pública listada abaixo, identifique o vetor de ataque mais grave:

1.1. `POST /api/registration/submit` — Registro público. Injection no payload? Upload de docs maliciosos? Flood de registros falsos?
1.2. `POST /api/registration/draft` — Rascunho de registro. Exfiltração de dados de drafts de outros usuários?
1.3. `POST /api/registration/upload-docs` — Upload de documentos no registro. Validação de tipo MIME? Limite de tamanho? Path traversal no Storage?
1.4. `POST /api/auth/forgot-password` — Reset de senha. Enumeração de e-mails? Rate limit? Token timing attack?
1.5. `POST /api/payments/asaas/webhook` — Webhook financeiro. Replay attack? Falsificação de payload? Ausência de verificação de timestamp?
1.6. `POST /api/contracts/webhook` — Webhook Clicksign. HMAC validation? Replay?
1.7. `POST /api/inngest` — Inngest serve handler. Signing key validation? Exposição de funções internas?
1.8. `GET /api/health` — Health check. Information disclosure (versão do Node, do Postgres, uptime)?
1.9. `GET /track/[token]` — Tracking público de pedidos. O token é criptograficamente seguro ou é um UUID previsível? Vaza dados do paciente?
1.10. `GET /api/tracking` — API de tracking. Dados do pedido expostos sem autenticação?
1.11. `POST /api/products/interest` — Interesse em produto. Rate limit? Spam?
1.12. `POST /api/push/subscribe` — Registro de push. Um atacante pode registrar o endpoint de push de outro usuário?
1.13. `POST /api/documents/upload` — Upload autenticado. Validação de ownership? Bypass de role?
1.14. `GET /api/documents/[id]/download` — Download de documento. IDOR? Clínica A baixa receita da Clínica B?
1.15. `POST /api/orders/[id]/advance` — Avanço de status do pedido. Validação de role e ownership? Skip de estados?
1.16. `POST /api/orders/[id]/prescriptions` — Upload de receita médica. Isolamento? Tipo de arquivo?
1.17. `POST /api/orders/reorder` — Reorder. Manipulação de preços congelados do pedido original?
1.18. `POST /api/orders/templates` — Templates de pedido. Cross-tenant access?
1.19. `POST /api/payments/asaas/create` — Criação de pagamento. Manipulação do valor? Desync com o pedido?
1.20. `POST /api/export` — Exportação de dados. Exfiltração massiva? Timeout no Vercel?
1.21. `POST /api/lgpd/deletion-request` — Pedido de exclusão LGPD. Qualquer pessoa pode solicitar exclusão de qualquer conta?
1.22. `GET /api/lgpd/export` — Exportação de dados pessoais. IDOR?
1.23. `POST /api/admin/lgpd/anonymize/[userId]` — Anonimização forçada. Bypass de role?
1.24. `POST /api/admin/registrations/[id]/ocr` — OCR de documentos via OpenAI. Injection no prompt? Exfiltração de dados?
1.25. `GET/POST /api/admin/coupons` e `/api/admin/coupons/[id]` — CRUD de cupons. Bypass? Cupom infinito?
1.26. `POST /api/coupons/activate` — Ativação de cupom. Race condition para usar o mesmo cupom N vezes?
1.27. `GET /api/coupons/mine` — Listar cupons do usuário. Cross-tenant?
1.28. `GET /api/admin/churn` — Dados de churn. Bypass de role?
1.29. `GET /api/products/[id]/recommendations` — Recomendações AI. Cache poisoning?
1.30. `POST /api/products/variants` — Variantes de produto. Ownership?
1.31. `GET /api/sessions` — Histórico de sessões. Cross-user access?
1.32. `GET/POST /api/settings/sla` — Configuração de SLA. Bypass de role?
1.33. `POST /api/profile/notification-preferences` — Preferências. IDOR?
1.34. Todos os 11 cron jobs em `vercel.json` — Proteção contra invocação externa? `CRON_SECRET` validado?
1.35. `middleware.ts` — Análise completa: rotas públicas, parseJwtPayload (sem verificação de assinatura — isso é seguro?), checkRevocation fail-open, bypass via path manipulation

### LENTE 2 — CTO (Chief Technology Officer): ARQUITETURA E RACE CONDITIONS

2.1. **Double-Spend no `confirmPayment`:** Webhook Asaas (via Inngest) e clique manual do Admin executam simultaneamente. Sem `SELECT ... FOR UPDATE`, o guard `status !== 'PENDING'` falha em Read Committed. Prove ou refute.
2.2. **Double-Transfer no `completeTransfer`:** Dois admins clicam "Concluir Repasse" ao mesmo tempo. O guard `status === 'COMPLETED'` é atômico?
2.3. **Double-Commission:** `confirmPayment` insere em `consultant_commissions` e `commissions`. Existe constraint UNIQUE (order_id) nessas tabelas?
2.4. **Máquina de Estados sem transação atômica:** `confirmPayment` faz 6+ operações separadas (update payment, insert commission, insert transfer, insert consultant_commission, update order, insert history). Se o Vercel matar a função no meio (timeout 10s no Hobby), quais tabelas ficam corrompidas?
2.5. **Cold Start + Timeout do Vercel:** Server Actions longas (exportação, bulk operations) podem ser mortas pelo timeout. Quais operações não são idempotentes e deixam estado corrompido?
2.6. **Exaustão de Pool de Conexões:** O `adminClient` cria uma nova conexão a cada chamada ou usa pool? PostgREST tem limite de conexões simultâneas?
2.7. **Realtime Auth-Race:** `OrderRealtimeUpdater` e `DashboardRealtimeRefresher` chamam `auth.getSession()` antes de subscrever. Se a sessão expirar durante a subscrição, o canal cai silenciosamente?
2.8. **WebSocket Cross-Tenant:** Um atacante no DevTools pode alterar os filtros do canal Realtime para escutar `postgres_changes` de pedidos de outra clínica?
2.9. **Migration Drift:** As 43 migrations são aplicadas em ordem no Supabase. Se uma migration falhar parcialmente, o schema fica inconsistente? Há rollback automático?
2.10. **Zod v4 UUID Validation:** O projeto migrou para Zod v4 com UUID strict. Existem UUIDs no banco (gerados por `gen_random_uuid()`) que falham na validação strict do Zod e quebram formulários?

### LENTE 3 — CFO (Chief Financial Officer): INTEGRIDADE DO DINHEIRO

3.1. **Arredondamento IEEE 754:** `Math.round(... * 100) / 100` é usado para calcular `pharmacyTransfer` e `platformCommission` em `confirmPayment`. Com 50 itens a R$ 33,33 cada, o total bate exatamente com o que o Asaas cobrou? Simule numericamente.
3.2. **Congelamento de Preços:** `order_items` congela `pharmacy_cost_per_unit` e `platform_commission_per_unit` no momento da criação do pedido. Se a farmácia alterar o custo entre a criação e a confirmação do pagamento, o repasse usa o valor antigo (congelado) ou o novo?
3.3. **Taxa do Consultor Mutável:** `consultant_commission_rate` é lida de `app_settings` no momento do `confirmPayment`, não no momento da criação do pedido. Se o admin alterar a taxa entre criação e pagamento, o consultor recebe mais ou menos do que deveria?
3.4. **Repasse Duplicado:** `completeTransfer` não verifica se já existe outro transfer COMPLETED para o mesmo `order_id`. Constraint UNIQUE?
3.5. **Estorno Parcial:** `processRefund` marca o pagamento como `REFUNDED`, mas não calcula o valor proporcional se o pedido tiver sido parcialmente executado. O admin sabe quanto devolver?
3.6. **Desbalanço Contábil:** O Asaas cobra taxas (ex: 1.99% cartão, R$ 3,49 boleto). O sistema desconta essas taxas do cálculo de comissão da plataforma ou ignora? Há um "buraco" entre o valor recebido no Asaas e o valor registrado no sistema?
3.7. **NFS-e Assíncrona:** Se a prefeitura rejeitar a NFS-e, o repasse já foi pago manualmente. Como reconciliar?
3.8. **Cupons e Descontos:** Se um cupom de 50% é aplicado, a comissão do consultor e o repasse da farmácia são calculados sobre o valor cheio ou o valor com desconto? Quem absorve o desconto?
3.9. **Cancelamento após SHIPPED:** O pedido pode ser cancelado após a farmácia já ter enviado. O custo da manipulação e do frete são absorvidos por quem?
3.10. **Pedido de R$ 0,00:** O que acontece se o total do pedido for zero (bug ou cupom 100%)? O sistema tenta criar uma cobrança no Asaas de R$ 0,00?

### LENTE 4 — CLO (Chief Legal Officer): CONFORMIDADE LGPD E CONTRATUAL

4.1. **Paradoxo LGPD vs Auditoria:** Se um usuário solicita exclusão, os `audit_logs` contêm PII (nome do ator, role). Hard delete quebra integridade referencial. Soft delete viola LGPD. Como o sistema resolve?
4.2. **Anonimização:** `POST /api/admin/lgpd/anonymize/[userId]` — o que exatamente é anonimizado? Receitas médicas no Storage são deletadas? Dados em `order_items`, `payments`, `transfers` são preservados para compliance fiscal?
4.3. **Retenção de Dados:** Cron `enforce-retention` — qual é a política de retenção? Dados financeiros devem ser mantidos por 5+ anos (Receita Federal). O cron não apaga dados fiscais prematuramente?
4.4. **DPA (Clicksign):** Se a farmácia não assinar o DPA, ela ainda consegue acessar dados de pedidos (nomes de pacientes, endereços de clínicas)? O código verifica o status do contrato antes de exibir dados sensíveis?
4.5. **Consentimento de Push/SMS:** O opt-out de notificações (`notification_preferences`) é respeitado em todos os 7 jobs Inngest e nos envios diretos de SMS/e-mail?
4.6. **Logs do Vercel/Sentry/Inngest:** PII (nomes, telefones, e-mails, CNPJs) aparecem em stack traces ou payloads de erro enviados ao Sentry ou Inngest? Os logs do Vercel expiram automaticamente?
4.7. **Termos de Uso e Política de Privacidade:** `/terms` e `/privacy` — estão atualizados? O registro exige aceite explícito (checkbox) desses documentos?
4.8. **Receitas Médicas:** São dados de saúde sensíveis (Art. 5º, II, LGPD). Quem pode visualizar? Farmácias concorrentes do mesmo pedido conseguem acessar?

### LENTE 5 — CPO (Chief Product Officer): LÓGICA DE PRODUTO E EDGE CASES

5.1. **Registro com CNPJ Rejeitado:** Uma clínica rejeitada tenta cadastrar de novo com o mesmo CNPJ. O sistema bloqueia? Constraint UNIQUE no banco?
5.2. **Farmácia Muda CNPJ:** A farmácia edita seu cadastro e muda o CNPJ. Os pedidos antigos ficam vinculados ao CNPJ velho. NFS-e emitida com dados inconsistentes?
5.3. **Consultor Deletado:** Um consultor é desativado/deletado enquanto tem comissões pendentes (`PENDING`). O admin perde visibilidade das comissões? O histórico financeiro se corrompe?
5.4. **Produto Desativado com Pedidos em Andamento:** Se um produto é desativado (`status=inactive`) enquanto pedidos com esse produto estão em `IN_EXECUTION`, o pedido trava?
5.5. **Médico Solo vs Clínica:** Migration 041 habilita compra direta por médico (`DOCTOR` sem clínica). Todas as Server Actions, filtros de dashboard e relatórios suportam pedidos sem `clinic_id`?
5.6. **Pedido com Múltiplas Farmácias:** O sistema suporta itens de farmácias diferentes no mesmo pedido? Se sim, como funciona o repasse split? Se não, a validação é estrita?
5.7. **Pedido Eternamente Pendente:** Se o PIX/boleto expira e o cliente não paga, existe um cron que cancela automaticamente? Ou o pedido fica em `AWAITING_PAYMENT` para sempre travando o admin?
5.8. **Template de Pedido Desatualizado:** Reorder usa preços congelados do pedido original ou busca preços atuais? Se o produto foi desativado, o reorder falha graciosamente?
5.9. **Catálogo vs Meus Produtos:** `PHARMACY_ADMIN` vê "Meus Produtos" e `CLINIC_ADMIN` vê "Catálogo". Um `PHARMACY_ADMIN` consegue ver o catálogo geral (incluindo preços e custos de farmácias concorrentes)?
5.10. **Interesse em Produto Inexistente:** O fluxo de "interesse" (`/api/products/interest`) gera notificação ao admin. Existe algum follow-up automatizado ou é um dead-end operacional?

### LENTE 6 — COO (Chief Operating Officer): FLUXOS OPERACIONAIS E GARGALOS

6.1. **Aprovação de Cadastro:** Quantos cliques e telas o admin precisa para aprovar uma clínica? O fluxo é serial (um por vez) ou tem batch approval?
6.2. **Fila de Repasses:** Se 50 pedidos são confirmados num dia, o admin precisa fazer 50 TEDs manuais + 50 cliques de "Concluir Repasse". Qual é o tempo operacional? Existe exportação de lote para o banco?
6.3. **Visibilidade de Estoque:** A plataforma sabe se a farmácia tem estoque do produto? Ou é puro "sob demanda" (manipulação)? Se a farmácia rejeitar o pedido por falta de insumo, qual é o status?
6.4. **SLA de Entrega:** O `sla-config.ts` define prazos? O que acontece quando o SLA estoura? Notificação automática ao admin e à clínica?
6.5. **Stale Orders:** O cron `stale-orders` roda diariamente às 08h. O que define "stale"? Quantos dias? O admin é obrigado a agir ou é apenas notificação passiva?
6.6. **Rastreio de Entrega:** A farmácia pode marcar como `SHIPPED` sem fornecer código de rastreio? O campo é obrigatório ou opcional?
6.7. **Múltiplos Admins Simultâneos:** Dois `PLATFORM_ADMIN` editam o mesmo produto simultaneamente. Last-write-wins? Conflito silencioso?
6.8. **Relatórios e BI:** `/reports` — os relatórios refletem dados em tempo real ou cacheados? Se cacheados, qual a defasagem?

### LENTE 7 — CXO (Chief Experience Officer): UX, ACESSIBILIDADE E FRONTEND

7.1. **Loading States:** Todas as Server Actions têm loading state visível (spinner/skeleton) ou a UI congela sem feedback?
7.2. **Optimistic UI Rollback:** Se uma Server Action falha (ex: `confirmPayment` retorna erro), o toast de erro aparece? O estado do React reverte corretamente?
7.3. **Stepper da Farmácia:** O stepper visual de 6 etapas (`PharmacyOrderActions`) — se a farmácia fechar a aba no meio de uma transição, a UI re-sincroniza ao reabrir?
7.4. **Mobile Responsiveness:** O dashboard, tabelas de pedidos e formulários são usáveis em tela de celular? Tabelas com 10+ colunas ficam ilegíveis?
7.5. **Acessibilidade (WCAG 2.1):** Os dialogs (`PaymentConfirmDialog`, `RefundPaymentDialog`, `AcknowledgeReversalDialog`) possuem labels corretos para screen readers? Focus trap funciona?
7.6. **Formulários Longos:** `ProductForm`, `ClinicForm`, `PharmacyForm`, `NewOrderForm` — validação Zod é executada no submit ou em tempo real? Mensagens de erro são claras e em português?
7.7. **Erro de Rede:** Se o usuário perder conexão no meio de um submit de pedido, o que acontece? Retry automático? Dados perdidos?
7.8. **Busca Global:** `GlobalSearch` — pesquisa cross-entity (pedidos, clínicas, farmácias, produtos). Performance com 10k+ registros?
7.9. **Notificações Acumuladas:** Se o admin tem 500 notificações não lidas, o `NotificationBell` carrega todas de uma vez? Paginação?
7.10. **Dark Mode:** `next-themes` está instalado. O dark mode funciona em todas as telas ou algumas ficam com contraste ilegível?

### LENTE 8 — CDO (Chief Data Officer): DADOS, INTEGRIDADE E MIGRAÇÕES

8.1. **Integridade Referencial:** As Foreign Keys estão configuradas com `ON DELETE CASCADE`, `SET NULL` ou `RESTRICT`? Uma deleção em cascata pode apagar dados financeiros?
8.2. **Índices:** Tabelas de alta cardinalidade (`orders`, `payments`, `order_items`, `audit_logs`, `notifications`) possuem índices nos campos de busca/filtro? Queries lentas em produção?
8.3. **Colunas Encriptadas:** Migration 023 adicionou colunas `_encrypted`. A encriptação é feita no app (TypeScript) ou no banco (pgcrypto)? A chave de encriptação está hardcoded ou em env var? Rotação de chave é suportada?
8.4. **Tipos Postgres vs TypeScript:** Os tipos definidos em `types/index.ts` espelham exatamente os CHECK constraints do banco? Se o TypeScript permite `'FAILED'` em `TransferStatus` mas o banco não, qual camada quebra?
8.5. **Dados Órfãos:** Se um `profile` é deletado, as tabelas `clinic_members`, `pharmacy_members`, `user_roles`, `notifications`, `push_tokens` são limpas? Dados órfãos acumulam indefinidamente?
8.6. **Backup e Recovery:** RPO atual é ~24h (backup diário físico Supabase Pro). PITR adiado. Se o banco corromper às 23h59, perdemos quase 24h de pedidos e pagamentos? Aceitável?

### LENTE 9 — CRO (Chief Revenue Officer): MODELO DE NEGÓCIO E FRAUDE

9.1. **Bypass do Marketplace:** Uma Clínica e uma Farmácia se descobrem via catálogo, trocam contatos via campo de "observações" do pedido, e passam a negociar por fora. Como prevenir?
9.2. **Margem Zero:** O sistema valida margem mínima da plataforma? Uma farmácia pode colocar `pharmacy_cost = price_current`, fazendo a plataforma ganhar R$ 0,00 de comissão?
9.3. **Cupom Abuse:** Criação de múltiplas contas para usar o mesmo cupom repetidamente. Constraint por CNPJ ou por e-mail?
9.4. **Consultor Fantasma:** Um admin cria um consultor fictício, vincula a clínicas reais, e desvia comissões para a conta do consultor. A auditoria detecta?
9.5. **Pricing Intelligence Leak:** Farmácias concorrentes conseguem ver os preços praticados por outras farmácias no catálogo? Ou apenas o `price_current` (preço da plataforma)?
9.6. **Churn sem Ação:** O sistema detecta churn (`churn-detection.ts`) e calcula lead scores. Mas existe alguma ação automatizada (email de reengajamento, cupom automático) ou é apenas um dashboard passivo?

### LENTE 10 — CSO (Chief Strategy Officer): ESCALABILIDADE E EVOLUÇÃO

10.1. **Vercel Hobby vs Pro:** O plano Vercel tem limite de 10s para Serverless Functions (Hobby) ou 60s (Pro)? Server Actions longas (export de 10k pedidos, bulk operations) podem ser cortadas?
10.2. **Supabase Rate Limits:** O plano Pro do Supabase tem limites de requisições por segundo ao PostgREST? O que acontece com 100 clínicas fazendo pedidos simultâneos?
10.3. **Multi-região:** O Vercel está em `gru1` (São Paulo). O Supabase está na mesma região? Latência cross-region?
10.4. **Internacionalização:** O sistema está 100% em português. Se expandir para outros países, a estrutura de i18n existe ou seria rewrite total?
10.5. **API Pública:** Existe API documentada para integrações de terceiros (ERPs de clínicas, sistemas de farmácias)? Ou é tudo acoplado ao frontend?

### LENTE 11 — CISO/CTO: SUPPLY CHAIN E DEPENDÊNCIAS

11.1. **Dependências Críticas:** `@supabase/ssr`, `@supabase/supabase-js`, `inngest`, `zod`, `openai`, `firebase-admin` — alguma tem CVE conhecida na versão atual?
11.2. **Lock File Integrity:** `package-lock.json` está commitado? O `npm install` no CI pode puxar versão diferente da local?
11.3. **Service Role Key Exposure:** `SUPABASE_SERVICE_ROLE_KEY` está acessível no runtime do Vercel. Um pacote NPM malicioso injetado via supply chain pode exfiltrar essa chave via `process.env`?
11.4. **Firebase Admin Key:** `firebase-admin` usa uma chave de conta de serviço. Onde está armazenada? No código, em env var, ou no Vercel?
11.5. **Sentry Source Maps:** Source maps são enviados ao Sentry? Expõem lógica de negócios e caminhos internos?

### LENTE 12 — COO/CPO: CRON JOBS E BACKGROUND JOBS (TODOS OS 11+7)

Analise CADA job abaixo individualmente:

12.1. **`/api/cron/stale-orders`** (diário 08h) — O que define "stale"? Notificação para quem? Ação automática?
12.2. **`/api/cron/purge-revoked-tokens`** (diário 03h) — Limpa tokens expirados. E se o cron falhar por 30 dias? A tabela cresce indefinidamente?
12.3. **`/api/cron/revalidate-pharmacies`** (semanal seg 06h) — O que revalida? CNPJ? Licenças? Status?
12.4. **`/api/cron/enforce-retention`** (mensal dia 1 02h) — Qual é a política exata? Dados financeiros são preservados?
12.5. **`/api/cron/purge-drafts`** (diário 03h30) — Drafts de registro. Após quantos dias? O usuário perde dados?
12.6. **`/api/cron/coupon-expiry-alerts`** (diário 09h) — Notifica quem? A clínica? O admin?
12.7. **`/api/cron/reorder-alerts`** (diário 07h) — Baseado em quê? Histórico de compras? É útil ou spam?
12.8. **`/api/cron/churn-check`** (diário 07h30) — Algoritmo de churn. False positives? Ação gerada?
12.9. **`/api/cron/product-recommendations`** (semanal seg 04h) — Rebuild de recomendações AI. Custo de API OpenAI por execução?
12.10. **`/api/cron/expire-doc-deadlines`** (diário 06h) — O que acontece com o pedido se o prazo de documento expirar? Cancelamento automático?
12.11. **`/api/cron/purge-server-logs`** (semanal seg 03h) — Após quantos dias? Logs de erros financeiros são preservados?
12.12. **Inngest `asaas-webhook`** — Retries (3x). Se todos falharem, o pagamento é perdido? DLQ (Dead Letter Queue)?
12.13. **Inngest `contract-auto-send`** — Auto-envio de DPA via Clicksign. Se a API da Clicksign estiver fora, o contrato nunca é enviado?
12.14. **Inngest `stale-orders`** — Duplicação com o cron `/api/cron/stale-orders`? Ambos rodam?
12.15. **Inngest `churn-detection`** — Duplicação com `/api/cron/churn-check`?
12.16. **Inngest `reorder-alerts`** — Duplicação com `/api/cron/reorder-alerts`?
12.17. **Inngest `product-recommendations`** — Timeout? Custo?
12.18. **Inngest `export-orders`** — Exportação em background. O arquivo resultante é armazenado onde? Por quanto tempo? Quem acessa?

### LENTE 13 — CISO: MIDDLEWARE, SESSÃO E AUTENTICAÇÃO

13.1. **`parseJwtPayload` sem verificação de assinatura:** O comentário diz "Supabase já verificou". Mas e se o cookie for manipulado no lado do cliente ANTES do Supabase verificar? O middleware extrai o payload de um JWT potencialmente falsificado?
13.2. **`checkRevocation` fail-open:** Se o banco de dados estiver fora do ar, o middleware deixa passar TODOS os tokens, incluindo tokens revogados. Um atacante pode derrubar o Supabase (DDoS) e usar tokens roubados livremente?
13.3. **Path manipulation:** `PUBLIC_ROUTES` usa `pathname.startsWith()`. Um atacante pode acessar `/api/cron/../../admin/` ou `/login/../dashboard` para bypassar a checagem?
13.4. **Session fixation:** Após login bem-sucedido, o token de sessão é renovado? Ou o token pré-login persiste?
13.5. **JWT expiry window:** O JWT do Supabase expira em quanto tempo? (Padrão: 3600s). Se um admin é banido, ele tem até 1 hora de acesso livre?

### LENTE 14 — CCO/CLO: CONTRATOS E COMPLIANCE OPERACIONAL

14.1. **DPA não assinado:** O sistema permite que uma farmácia acesse dados de pedidos (com PII de clínicas) ANTES de assinar o DPA via Clicksign?
14.2. **Contrato Expirado/Revogado:** Se a Clicksign enviar webhook de revogação, o acesso da farmácia é cortado automaticamente?
14.3. **NFS-e Obrigatória:** O repasse para a farmácia pode ser concluído (botão "Concluir Repasse") sem que a NFS-e da comissão tenha sido emitida com sucesso?
14.4. **Nota de Serviço vs Nota de Venda:** A plataforma cobra comissão (serviço de intermediação). A NFS-e emitida é do tipo correto (serviço) e com o código de serviço municipal adequado?

### LENTE 15 — CMO (Chief Marketing Officer): COMUNICAÇÃO E RETENÇÃO

15.1. **SMS Spam:** O sistema envia SMS em múltiplos eventos (pedido criado, pago, pronto, enviado, entregue). Um pedido gera quantos SMS? O cliente pode se irritar? Opt-out funciona?
15.2. **E-mail Deliverability:** Resend está configurado com SPF/DKIM/DMARC para `clinipharma.com.br`? E-mails transacionais caem no spam?
15.3. **WhatsApp Adiado:** Com SMS ativo e WhatsApp adiado, a experiência de comunicação é consistente? O SMS é suficiente para taxa de abertura?
15.4. **Landing Page (/):** A página pública `app/page.tsx` — é uma landing page de conversão ou uma tela de login? Existe SEO básico (meta tags, OG tags)?

### LENTE 16 — CAO (Chief Administrative Officer): GESTÃO INTERNA

16.1. **Audit Trail Completo:** Todas as ações críticas (aprovar cadastro, confirmar pagamento, concluir repasse, alterar preço, desativar produto, cancelar pedido) geram `audit_log`? Alguma ação escapa?
16.2. **Segregação de Funções:** Um único `SUPER_ADMIN` pode criar um consultor, vincular a uma clínica, aprovar o cadastro, confirmar o pagamento E concluir o repasse — tudo sozinho? Existe segregação de funções (separation of duties)?
16.3. **Imutabilidade dos Logs:** A tabela `audit_logs` tem RLS? Um admin com acesso ao Supabase Dashboard pode deletar registros diretamente no SQL Editor?
16.4. **Server Logs:** Migration 043 criou `server_logs`. Cron purga semanalmente. Logs de erros financeiros críticos são preservados por tempo suficiente?

### LENTE 17 — VP OF ENGINEERING: QUALIDADE DE CÓDIGO E TESTES

17.1. **Cobertura de Testes:** 955 testes unitários e 56 E2E. Qual a cobertura real (%)? Quais services/rotas têm cobertura < 50%?
17.2. **Testes de Race Condition:** Existe algum teste que simula requisições concorrentes ao `confirmPayment` ou `completeTransfer`?
17.3. **Testes de Webhook:** Os testes do webhook Asaas testam payloads malformados, tokens inválidos, e replay?
17.4. **Testes de Autorização:** Para CADA Server Action em `services/*.ts`, existe teste verificando que roles não autorizadas recebem erro?
17.5. **Testes de Edge Cases Financeiros:** Pedido com valor R$ 0,00? Pedido com 1000 itens? Farmácia com repasse negativo?
17.6. **Testes E2E Faltantes:** Quais fluxos críticos NÃO têm teste E2E? (Ex: fluxo completo de repasse, fluxo de estorno, fluxo de DPA)
17.7. **Mocks vs Realidade:** Os mocks de `adminClient` nos testes unitários refletem o comportamento real do Supabase (ex: `.single()` retorna erro se 0 ou 2+ rows)?
17.8. **Testes de Regressão:** Cada bug corrigido (v6.5.1 a v6.9.1) tem teste de regressão impedindo recorrência?

### LENTE 18 — STAFF/PRINCIPAL ENGINEER: PADRÕES E CONSISTÊNCIA

18.1. **Error Handling:** Existe um padrão consistente de tratamento de erros? Algumas Server Actions retornam `{ error: string }`, outras lançam exceções. O frontend lida com ambos?
18.2. **Logger Consistency:** `lib/logger.ts` — todos os erros financeiros são logados com contexto suficiente (orderId, paymentId, userId)? Ou alguns usam `console.error` diretamente?
18.3. **Type Safety:** Existem `as` (type assertions) ou `any` em código crítico (financeiro, auth)? Quantos e onde?
18.4. **Validators Centralizados:** `lib/validators/index.ts` — TODAS as Server Actions usam os validators ou algumas aceitam input não validado?
18.5. **Padrão de Revalidação:** Após mutations, o cache é invalidado consistentemente? Ou algumas actions esquecem `revalidateTag`?
18.6. **Imports e Dead Code:** Existem imports não utilizados, funções exportadas mas nunca chamadas, ou rotas de API sem consumidor no frontend?

### LENTE 19 — DBA (Database Administrator): SCHEMA E PERFORMANCE

19.1. **CHECK Constraints:** Status fields (`order_status`, `payment_status`, `transfer_status`) possuem CHECK constraints no banco alinhados com os TypeScript types?
19.2. **Índices Compostos:** Queries frequentes como `orders WHERE clinic_id = X AND order_status = Y` possuem índice composto? Ou fazem full table scan?
19.3. **Índices Parciais:** Os índices parciais criados (ex: `needs_price_review = true`, `needs_manual_refund = true`) são realmente usados pelo query planner?
19.4. **Bloat e Vacuum:** Tabelas com muitos UPDATEs (`orders`, `payments`, `notifications`) — o autovacuum do Supabase está configurado adequadamente?
19.5. **RLS Residual:** Após a migração para `adminClient`, as políticas RLS antigas ainda existem? Elas interferem com queries que usam o client autenticado (não-admin)?
19.6. **Supabase Publication:** Tabelas adicionadas ao `supabase_realtime` (orders, order_status_history, order_operational_updates, notifications) — o volume de WAL gerado é sustentável?

### LENTE 20 — SRE (Site Reliability Engineer): OBSERVABILIDADE E RECUPERAÇÃO

20.1. **Health Check:** `/api/health` — verifica apenas que o servidor responde ou também testa conectividade com Supabase, Asaas, Zenvia?
20.2. **Sentry:** Erros financeiros críticos (falha no webhook, falha no repasse) são alertados com severidade alta?
20.3. **OpenTelemetry:** `lib/tracing.ts` — traces estão sendo enviados para algum backend? Ou é dead code?
20.4. **Rollback Plan:** `docs/rollback-plan.md` — o plano cobre rollback de migrations do Supabase? Migrations são destrutivas (DROP COLUMN, etc)?
20.5. **Disaster Recovery:** RPO ~24h, RTO ~25-30 min (documentado). O restore foi testado com dados reais ou apenas com schema vazio?
20.6. **Rate Limiting Interno:** `lib/rate-limit.ts` — usa `@upstash/ratelimit` e `@upstash/redis`. Os mocks nos testes indicam que NÃO há Redis real configurado. O rate limit é efetivo em produção ou é no-op?
20.7. **Circuit Breaker State:** `lib/circuit-breaker.ts` — o estado do circuit breaker (aberto/fechado) é per-instance (Vercel Serverless) ou compartilhado? Em Serverless, cada invocação é uma instância nova, então o circuit breaker nunca acumula falhas?

---

## 🚨 FORMATO DE SAÍDA OBRIGATÓRIO

Para CADA sub-item numerado (1.1 a 20.7 — são **187 pontos de análise**), entregue:

**[X.Y] [Nome do Item]**

- **Veredicto:** `🔴 CRÍTICO` | `🟠 ALTO` | `🟡 MÉDIO` | `🟢 SEGURO` | `⚪ NÃO APLICÁVEL`
- **Achado:** O que você encontrou no código (cite arquivo e função exatos).
- **Risco:** O pior cenário se explorado/ignorado.
- **Correção:** O patch específico (código, SQL, configuração) — ou "N/A" se seguro.

---

## 🛑 PROTOCOLO DE AUTO-AVALIAÇÃO (MANDATÓRIO)

Antes de enviar sua resposta:

1. Você analisou todos os 187 sub-itens individualmente? Se pulou algum, volte e complete.
2. Você encontrou pelo menos 5 vulnerabilidades `🔴 CRÍTICO`? Se não, sua análise foi superficial — aprofunde.
3. Suas correções são código real (SQL, TypeScript) ou frases vagas como "melhore a validação"? Se vagas, reescreva.
4. Você cruzou dimensões (ex: race condition no financeiro + cache poisoning + LGPD)? Se não, está pensando em silos.

Se a resposta ultrapassar o limite de tokens, divida em partes e indique claramente "PARTE 1 de N — próxima parte: itens X.Y a Z.W". Não comprima.

```

```
