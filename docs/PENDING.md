# Clinipharma — Lista Consolidada de Pendências

> Gerado em: 2026-04-16 | Versão da plataforma: **6.8.1** | **930 testes, 0 falhas** | cobertura atualizada
>
> **v6.5.29:** Fix silencioso no `handleOrderCancellationFinancials` — `update()` de `payments` e `transfers` não verificava o `error` retornado pelo Supabase JS client. Se o constraint de status rejeitasse o valor `CANCELED` (problema de nome de constraint no banco), a falha era engolida sem logs. Adicionado verificação explícita: se `paymentCancelErr` ou `transferCancelErr` não for null, lança exceção que propaga até o `logger.error` no `updateOrderStatus`. Diagnóstico e correção de constraint via SQL fornecidos (ver abaixo).
>
> **v6.5.28:** Workflow completo de estorno e reversão de repasse para pedidos cancelados. Migration 038: `needs_manual_refund boolean DEFAULT false` em `payments` e `needs_manual_reversal boolean DEFAULT false` em `transfers` (+ índices parciais). `handleOrderCancellationFinancials` agora seta o flag + envia notificação quando `payment.status='CONFIRMED'` ou `transfer.status='COMPLETED'` (antes só enviava notificação). Novos server actions `processRefund` e `acknowledgeTransferReversal` em `services/payments.ts`: registram que a ação externa foi concluída, atualizam status (`REFUNDED`/`CANCELED`), zeram o flag e criam audit log. Novos `AuditAction.PAYMENT_REFUNDED` e `TRANSFER_REVERSED`. Novos componentes `RefundPaymentDialog` e `AcknowledgeReversalDialog`: dialogs com aviso explicativo ("esta ação não movimenta dinheiro — apenas registra que a ação foi concluída"). Páginas de Pagamentos e Repasses: botões de ação aparecem quando flag está ativo; status `CANCELED` agora tem label/estilo correto (antes exibia texto bruto). Dashboard: novos cards urgentes "Estornos pendentes" (vermelho) e "Reversões de repasse" (laranja) que aparecem apenas quando há itens a resolver. **Ação manual:** rodar migration 038 no SQL Editor do Supabase.
>
> **v6.5.27:** Auto-cancelamento financeiro ao cancelar pedido. Migration 037: adicionado `CANCELED` ao CHECK constraint de `payments.status` e `transfers.status`. `updateOrderStatus`: quando `newStatus='CANCELED'`, chama `handleOrderCancellationFinancials()` que aplica as regras: `payment PENDING|UNDER_REVIEW → CANCELED` (+ audit); `payment CONFIRMED → mantém + notificação urgente ao admin "estorno manual necessário"`; `transfer NOT_READY|PENDING → CANCELED` (+ audit); `transfer COMPLETED → mantém + notificação urgente ao admin "reversão manual necessária"`. Falha no cleanup nunca bloqueia o cancelamento do pedido (try/catch separado). 3 novos testes (888 total). **Ação manual:** rodar migration 037 no SQL Editor do Supabase.
>
> **v6.5.26:** Fix cancelamento de pedidos pelo SUPER_ADMIN. Dois problemas corrigidos: (1) Máquina de estados (`status-machine.ts`): `CANCELED` não existia nas transições admin para `RECEIVED_BY_PHARMACY`, `IN_EXECUTION`, `READY`, `SHIPPED` e `DELIVERED` — admin ficava bloqueado assim que a farmácia recebia o pedido. Adicionado `CANCELED` a todos esses estados. (2) UI ausente: `order-detail.tsx` só renderizava `PharmacyOrderActions` — admin não tinha nenhum botão de ação de status. Criado `AdminOrderActions` (componente cliente) que lê `getAllowedTransitions('admin')` e renderiza botões configuráveis: "Cancelar pedido" (destructive, motivo obrigatório, dialog de confirmação) e "Marcar como concluído" (quando DELIVERED). 7 novos testes na state machine (885 total).
>
> **v6.5.25:** Fluxo completo de revisão de preço. Card "Revisar preço" agora linka para `/products?needs_review=1`. Lista de produtos: suporte ao filtro `?needs_review=1` (mostra apenas produtos pendentes + banner laranja informativo + botão "Limpar filtro"); badge `⚠️ Revisar preço` visível por linha para admin. Detalhe do produto: banner laranja "Repasse atualizado pela farmácia" quando `needs_price_review=true` com dois CTAs — "Alterar preço" (abre `PriceUpdateForm`, zera flag ao salvar) e "Confirmar sem alterar" (`DismissPriceReviewButton` → `dismissPriceReview()` server action). `dismissPriceReview`: nova server action que seta `needs_price_review=false` + audit log + revalidações. 2 novos testes (883 total).
>
> **v6.5.24:** Dashboard admin em tempo real — `DashboardRealtimeRefresher` (componente cliente invisível) subscreve `postgres_changes` (`event: '*'`) nas 4 tabelas que alimentam os KPI cards (`products`, `orders`, `payments`, `transfers`). Quando qualquer mudança chega, chama server action `revalidateDashboard()` (invalida `revalidateTag('dashboard')` no servidor) seguido de `router.refresh()` para re-render imediato com dados frescos. Mesmo padrão anti-auth-race do `OrderRealtimeUpdater`: `auth.getSession()` antes de subscrever. Fallback polling silencioso de 60 s como safety-net. `lib/actions/revalidate.ts` — server action reutilizável.
>
> **v6.5.23:** Card "Revisar preço" no dashboard admin — coluna `needs_price_review boolean DEFAULT false` adicionada à tabela `products` (migration 036 + índice parcial). `updatePharmacyCost`: seta `needs_price_review=true` quando `price_current > 0` (qualquer alteração de repasse exige revisão do preço ao cliente). `updateProductPrice`: zera `needs_price_review=false` quando admin atualiza o preço + `revalidateTag('dashboard')`. Dashboard: novo card "Revisar preço" laranja com alerta vermelho quando count > 0, verde quando zerado. Cor `orange` adicionada ao `COLOR_CLASSES` do `KpiCard`.
>
> **v6.5.22:** Dois bugs corrigidos. (1) Dashboard "pedidos em aberto": status `DELIVERED` não estava na lista de exclusão (`['COMPLETED','CANCELED']`), fazendo pedidos entregues aparecerem como abertos. Adicionado `DELIVERED` ao filtro. (2) Sino de notificações não atualizava em tempo real: tabela `notifications` nunca foi adicionada à publication `supabase_realtime` (migration 035), e o componente `NotificationBell` sofria o mesmo auth-race corrigido no `OrderRealtimeUpdater` (WebSocket conectava como anon antes da sessão carregar). Corrigido com `auth.getSession()` antes de subscrever + polling fallback de 30 s.
>
> **v6.5.21:** Integridade de preços — resposta em 3 camadas quando farmácia atualiza `pharmacy_cost`. (1) 🟡 Margem > 15%: notificação informativa "repasse atualizado, margem parece OK — revise o preço ao cliente" (não silenciável). (2) 🟠 Margem ≤ 15%: alerta "margem crítica — revise o preço com urgência". (3) 🔴 `pharmacy_cost ≥ price_current`: produto **desativado automaticamente** + alerta urgente "produto desativado — repasse excede preço ao cliente". Nenhuma ação quando `price_current=0` (produto já estava inativo aguardando precificação). Novo tipo de notificação `PRODUCT_COST_UPDATED` (não silenciável). 5 novos testes unitários (881 total).
>
> **v6.5.20:** Workflow de precificação de produtos — farmácia cria produto → plataforma precifica e publica. `createProduct` por `PHARMACY_ADMIN` força `price_current=0` + `status=inactive` (produto nunca vai ao catálogo sem preço). Notificação automática `PRODUCT_AWAITING_PRICE` disparada para todos `SUPER_ADMIN`/`PLATFORM_ADMIN` com push. Dashboard: novo card "Aguardando preço" (âmbar com alerta quando > 0). Lista de produtos: badge `⏳ Aguardando preço` substitui Ativo/Inativo; produtos sem preço sobem ao topo. Detalhe do produto: banner âmbar com botão "Definir preço" em destaque quando `price_current=0`. `PriceUpdateForm`: novas props `label` e `highlight`. 4 novos testes unitários (876 total).
>
> **v6.5.19:** Fluxo de precificação corrigido — farmácia define `pharmacy_cost` (seu repasse), plataforma define `price_current` (preço à clínica). `createProduct`: força `price_current=0` quando chamado por `PHARMACY_ADMIN`. `updatePharmacyCost`: aberto para `PHARMACY_ADMIN` com ownership check (farmácia atualiza próprio custo sem precisar de admin). Validator: `price_current ≥ 0`. `ProductForm`: nova prop `isPharmacyAdmin` — esconde campo de preço ao cliente, análise de margem, comissão do consultor e lucro da plataforma; seção renomeada para "Seu repasse". Detalhe do produto: `PHARMACY_ADMIN` vê seu repasse em destaque (não o preço), `PharmacyCostUpdateForm` disponível para farmácia, `PriceUpdateForm` restrito a `SUPER_ADMIN`.
>
> **v6.5.18:** Auditoria de vazamento de dados financeiros — 3 info-leaks corrigidos para `PHARMACY_ADMIN`: (1) `/products/[id]`: `MarginBreakdown` (margem da plataforma %, comissão consultor %, lucro c/s consultor) ocultado; histórico de preços ocultado; buscas de `consultant_commission_rate` e `product_price_history` suprimidas no servidor quando viewer é farmácia. (2) `/transfers`: colunas "Bruto" (`gross_amount`) e "Comissão" (`commission_amount`) ocultadas — farmácia vê apenas valor líquido, pedido, status e data. `CLINIC_ADMIN` sem vazamentos confirmados por varredura completa.
>
> **v6.5.17:** Fix acesso negado em `/products/[id]` para `PHARMACY_ADMIN` — página de detalhe só aceitava `SUPER_ADMIN`/`PLATFORM_ADMIN` enquanto a lista `/products` já permitia `PHARMACY_ADMIN` (inconsistência da v6.5.10). Adicionado `PHARMACY_ADMIN` ao `requireRolePage` + ownership check (`notFound` se produto não pertencer à farmácia do usuário).
>
> **v6.5.16:** Fix `OrderRealtimeUpdater` — `createClient()` chamado antes da hidratação da sessão fazia o WebSocket conectar como `anon`, falhando silenciosamente no RLS check do `postgres_changes` (eventos chegavam ao Supabase mas nunca eram entregues). Correção: `supabase.auth.getSession()` chamado antes de subscrever para garantir JWT carregado; bail-out se sem sessão. Adicionado polling fallback de 20 s (`router.refresh()` silencioso) que roda independente do Realtime — safety-net para proxies corporativos e Realtime misconfigured. Cleanup correto com `clientRef` + `channelRef` evitando race condition no strict-mode (double-mount). Tratamento explícito de `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`.
>
> **v6.5.15:** Realtime de pedidos via Supabase Realtime — `OrderRealtimeUpdater` (componente cliente invisível) subscreve `postgres_changes` nas tabelas `orders` e `order_status_history` filtradas pelo `id` do pedido corrente; chama `router.refresh()` em qualquer mudança, mantendo a timeline sincronizada em todas as abas abertas (clínica, farmácia, admin) sem reload manual. Toast de notificação exibido no INSERT de novo `order_status_history` com o label traduzido do status. `LiveBadge`: indicador verde pulsante "Ao vivo" no header do detalhe do pedido quando o canal Realtime está no estado `SUBSCRIBED`. Migration 034: `REPLICA IDENTITY FULL` habilitado em `orders`, `order_status_history` e `order_operational_updates`; tabelas adicionadas à publication `supabase_realtime`.
>
> **v6.5.14:** Fluxo de execução de pedidos na farmácia redesenhado — `PharmacyOrderActions` substituído por um stepper visual de 6 etapas (Liberado → Recebido → Manipulação → Pronto → Enviado → Entregue) que exibe o progresso completo do pedido com ícones coloridos (verde = concluído, azul = etapa atual, cinza = próximas). Cada botão de ação agora tem descrição contextual clara. Stepper posicionado em largura total acima do grid principal para máxima visibilidade. Validação de `pharmacy_cost = 0` no formulário de produto: aviso âmbar exibido quando o repasse à farmácia está zerado e o preço está preenchido, prevenindo pedidos onde a farmácia recebe R$ 0,00.
>
> **v6.5.13:** Fix `order/[id]/page.tsx` sem `force-dynamic` — página de detalhe do pedido podia servir versão em cache após confirmação de pagamento e conclusão de repasse, exibindo a timeline desatualizada. Adicionado `export const dynamic = 'force-dynamic'`. Fix do script CI: `npm run test:coverage` inexistente causava falha em todos os pushes; adicionado script `"test:coverage": "vitest run --coverage"` ao `package.json`.
>
> **v6.5.12:** Fix modal de confirmação de pagamento travado — `confirmPayment` tentava definir `payments.status = 'PROCESSING'` como guarda atômica de concorrência, mas a tabela `payments` tem CHECK constraint que só aceita `PENDING | UNDER_REVIEW | CONFIRMED | FAILED | REFUNDED`; o valor `PROCESSING` existe apenas em `consultant_commissions` (migrations 019/020). O UPDATE falhava silenciosamente (0 linhas retornadas), o serviço retornava `{ error: 'Pagamento já está sendo processado' }`, o toast de erro aparecia e o modal nunca fechava. Fix: removido o passo `PROCESSING` do `confirmPayment` (a checagem `status !== 'PENDING'` já é proteção suficiente para ação manual de admin); adicionado guard `if (loading) return` no modal para duplos cliques; teste atualizado para cobrir o path real (rejeitar status ≠ PENDING).
>
> **v6.5.11:** "Minha Farmácia" para PHARMACY_ADMIN — nova rota `/my-pharmacy` com perfil completo da farmácia (CNPJ, responsável, email, telefone, endereço, dados bancários, produtos, repasses recentes, pedidos ativos). Rota `/my-pharmacy/edit` com `PharmacyForm` — CNPJ bloqueado para edição, campos de contato/endereço/banco editáveis; `services/pharmacies.updatePharmacy` aberto para `PHARMACY_ADMIN` com ownership check + strip de `cnpj`/`status` para impedir alterações não autorizadas. `PharmacyForm` recebe `disableCnpj` e `redirectAfterSave` props. Sidebar: "Minha Farmácia" (ícone Store) adicionado como primeiro item específico de PHARMACY_ADMIN.
>
> **v6.5.10:** Auditoria completa do fluxo da farmácia — 6 problemas corrigidos: (1) Dashboard `pharmacy-dashboard.tsx` consultava orders/transfers sem filtrar por `pharmacy_id`, expondo dados de outras farmácias; migrado para `adminClient` com filtro explícito. (2) Dashboard não mostrava `READY_FOR_REVIEW` (revisão de documentos), a principal ação da farmácia; adicionado card "Revisar documentos" com alerta visual quando há pedidos aguardando. (3) `services/products.ts` bloqueava `PHARMACY_ADMIN` via `requireRole`; agora permite com validação de ownership (só cria/edita produtos da própria farmácia). (4) ProductForm recebe `defaultPharmacyId` para pré-selecionar e bloquear a farmácia em novos produtos. (5) Páginas `/products`, `/products/new` e `/products/[id]/edit` abertas para `PHARMACY_ADMIN` com escopo por membership. (6) Sidebar: `PHARMACY_ADMIN` removido de "Catálogo" (que é para compradores) e adicionado a "Produtos" (gerenciamento). Status labels do dashboard traduzidos para português via `STATUS_LABELS`.
>
> **v6.5.9:** Fluxo da farmácia nos pedidos completamente redesenhado — (1) Bug crítico em `reviewDocument`: coluna inexistente `order_items_id` na query PostgREST causava `data: null` → "documento não encontrado"; corrigido para `select('id, order_id')`. (2) `DocumentManager`: campo de motivo de rejeição agora sempre visível por documento (estado independente por `doc.id`), sem confusão de estado compartilhado. (3) Upload bloqueado para `PHARMACY_ADMIN` via prop `canUpload`. (4) Catálogo em modo gerenciamento para farmácia: detecta role server-side, filtra por `pharmacy_id`, exibe "Meus produtos" com CTA "Editar produto" + badge de status. (5) `PharmacyOrderActions`: fluxo completo de 5 etapas (RELEASED_FOR_EXECUTION → RECEIVED_BY_PHARMACY → IN_EXECUTION → READY → SHIPPED com campo de código de rastreamento → DELIVERED).
>
> **v6.5.8:** Fix crítico de validação UUID com Zod v4 — o projeto usa Zod `^4.3.6` que introduziu regex de UUID estrita (RFC 4122: terceiro grupo `[1-8]`, quarto grupo `[89ab]`). IDs seed como `b1000000-0000-0000-0000-000000000002` e alguns UUIDs reais do `gen_random_uuid()` do Supabase reprovavam essa validação, gerando erro "Invalid UUID" em qualquer formulário que enviasse um ID (criar usuário, criar pedido via validators, cupons, tickets). Corrigido em `services/users.ts`, `services/support.ts`, `services/coupons.ts` e `lib/validators/index.ts` — todos agora usam `uuidLoose` (regex 8-4-4-4-12 hex sem exigir version/variant bits), padrão já adotado em `services/orders.ts`.
>
> **v6.5.7:** Fix `notFound()` em `/clinics/[id]` — a query usava join embutido PostgREST (`.select('*, sales_consultants(...)')`) que falhava silenciosamente em produção retornando `data: null` e disparando `notFound()`. Substituído por duas queries independentes (`select('*')` na clínica + query separada para o consultor via `consultant_id`). Adicionado `console.error` para logar erros de query nos logs do Vercel. Padrão agora consistente com farmácias e médicos.
>
> **v6.5.6:** Fix crítico de posicionamento do `export const dynamic = 'force-dynamic'` — o prettier auto-formatter estava inserindo a diretiva no meio de blocos `import {` (incluindo imports multi-linha) em 31 páginas privadas. O Next.js ignora a diretiva quando ela não é um export de módulo válido, fazendo a página cair em SSG silenciosamente. Resultado: páginas de detalhe como `/clinics/[id]` retornavam 404 em produção mesmo após a migração para `adminClient`. Corrigido: diretiva movida para após o último `import` em todos os arquivos afetados.
>
> **v6.5.5:** Correção de gaps de segurança introduzidos pela migração para `adminClient` — ao remover o RLS como segunda camada de defesa, o isolamento entre tenants passou a ser responsabilidade do código. Três gaps foram identificados e corrigidos: (1) `/orders/[id]`: `CLINIC_ADMIN` podia acessar pedido de outra clínica via UUID; (2) `/doctors/[id]`: `CLINIC_ADMIN` podia acessar médico não vinculado à sua clínica; (3) `createOrder` (service): `CLINIC_ADMIN` podia criar pedido com `clinic_id` de outra clínica. Todos os três agora fazem verificação de membership pós-fetch ou pré-insert. Testes de `orders.test.ts` atualizados para refletir o novo check de membership.
>
> **v6.5.4:** Varredura completa de páginas de detalhe e criação — todas as páginas `[id]/page.tsx`, `[id]/edit/page.tsx` e `new/page.tsx` da área privada que ainda usavam `createServerClient`/`createClient` (RLS) foram migradas para `adminClient` + `force-dynamic`. Páginas corrigidas: `clinics/[id]`, `clinics/[id]/edit`, `doctors/[id]`, `doctors/[id]/edit`, `pharmacies/[id]`, `pharmacies/[id]/edit`, `products/[id]`, `products/[id]/edit`, `products/new`, `consultants/[id]`, `consultants/[id]/edit`, `support/[id]`, `users/[id]`, `users/new`, `categories`, `consultant-transfers`, `settings`, `support`, `orders/new`.
>
> **v6.5.3:** Fix SSG cache em páginas privadas — todas as 20 páginas de listagem da área privada receberam `export const dynamic = 'force-dynamic'`. Sem essa diretiva o Next.js gerava HTML estático no build (quando o banco está vazio) e servia esse cache em produção indefinidamente. Causa raiz do problema de listas vazias em `/clinics` e `/doctors` após deploy. `createAdminClient` agora lança erro explícito se `SUPABASE_SERVICE_ROLE_KEY` estiver ausente.
>
> **v6.5.2:** Varredura completa de RLS bootstrap — corrigidas 11 pages da área privada que usavam `createClient()` (RLS) e retornavam listas vazias: `/doctors`, `/clinics`, `/pharmacies`, `/products`, `/payments`, `/consultants`, `/audit` (afetavam `SUPER_ADMIN`/`PLATFORM_ADMIN`). Todas as pages da área privada agora usam `adminClient` com filtro de escopo explícito.
>
> **v6.5.1:** Varredura e correção de RLS bootstrap em 4 páginas — `/orders` (lista vazia para `CLINIC_ADMIN`), `/catalog` (farmácias vazias no filtro), `/catalog/[slug]` (produto podia 404 por join com `pharmacies`), `/transfers` (`PHARMACY_ADMIN` via lista vazia; `CLINIC_ADMIN` isolado com filtro explícito). Todas as pages agora usam `adminClient` com filtro de escopo explícito, padrão já adotado em `/orders/new` e `/orders/[id]`.
>
> **v6.5.0:** Fluxo de revisão de documentos pela farmácia — migration 033 (`order_documents.status/rejection_reason`, `order_items.doc_status`, `orders.docs_deadline`); endpoint `/api/documents/[id]/download` (URL assinada, 5 min); `services/document-review.ts` com `reviewDocument`, `evaluateOrderDocuments` (avanço automático para `AWAITING_PAYMENT` ou bloqueio para `AWAITING_DOCUMENTS` com prazo de 3 dias úteis) e `removeOrderItem` (clínica remove item rejeitado, pedido recalculado, cancelado se ficar vazio); cron `/api/cron/expire-doc-deadlines` (cancela pedidos com prazo expirado); UI `DocumentManager` com download, badges de status, controles de aprovar/rejeitar por documento; `order-detail` com badge `doc_status` por item e botão de remoção para `CLINIC_ADMIN`. 7 novos testes unitários.
>
> **v6.4.5:** Upload de documentos tipado — cada arquivo recebe tipo explícito (`PRESCRIPTION`, `IDENTITY`, `MEDICAL_REPORT`, `AUTHORIZATION`, `OTHER`) com seletor inline no formulário de criação. Tipo padrão inteligente: `PRESCRIPTION` quando carrinho tem produto com `requires_prescription`, `OTHER` caso contrário. Status avança automaticamente para `READY_FOR_REVIEW` quando pelo menos um documento é enviado na criação.
>
> **v6.4.4:** Fix carrinho perdido ao navegar para `/doctors/new` — carrinho serializado como `?cart=id:qty,id:qty` na URL; restaurado ao voltar para `/orders/new`. `parseCartParam` extraído para `lib/orders/doctor-field-rules.ts` com 7 testes unitários.
>
> **v6.4.3:** Fix redirect pós-cadastro de médico — `CLINIC_ADMIN` era jogado para `/unauthorized` ao salvar médico (página de detalhe exigia `SUPER_ADMIN`). `/doctors/[id]` aberto para `CLINIC_ADMIN`. `DoctorForm` aceita `redirectTo` prop; para `CLINIC_ADMIN` redireciona para `/orders/new` após cadastro. Página de novo médico informa que o médico será vinculado automaticamente.
>
> **v6.4.2:** Fix crítico no fluxo de pedidos — `adminClient` usado nas queries de `clinic_members` e `doctor_clinic_links` para contornar bootstrap de RLS (usuário não conseguia ler sua própria clínica com o client de usuário). `CLINIC_ADMIN` pode agora cadastrar médicos em `/doctors/new` com auto-vínculo à sua clínica. Atalhos no form de pedido: link "Cadastrar novo médico" ao lado do campo, e callout âmbar quando a clínica não tem médicos vinculados. 2 novos testes unitários.
>
> **v6.4.1:** Refactor — lógica de visibilidade/obrigatoriedade do campo médico extraída para `lib/orders/doctor-field-rules.ts` (função pura `resolveDoctorFieldState`). 5 novos testes unitários cobrem todas as combinações de médicos vinculados × produtos com receita.
>
> **v6.4.0:** Fluxo de criação de pedidos corrigido — clínica auto-detectada pelo papel do usuário (sem dropdown para `CLINIC_ADMIN`), médico solicitante condicional: obrigatório apenas quando o carrinho contém produto com `requires_prescription = true`, opcional quando a clínica tem médicos vinculados, oculto quando não tem. Migration 032 torna `orders.doctor_id` nullable. Médicos exibidos são apenas os vinculados à clínica do pedido.
>
> **v6.3.0:** Push FCM frontend completo — `PushInitializer` component montado no layout privado (solicita permissão, registra token, exibe toasts em foreground). Ícones PWA criados (`public/icons/`). Guia de produção Evolution API/WhatsApp em `docs/infra/evolution-api-setup.md`. 13 novos testes.
>
> **v6.2.0:** Varredura e correção de 5 gaps "infraestrutura presente, funcionalidade incompleta": (1) pharmacy-order-actions migrado para /advance (gate de prescrição garante todos os agentes); (2) página admin de Risco de Churn com score persistido em `clinic_churn_scores`; (3) SMS nos fluxos principais (aprovação, pedido, stale); (4) Push notifications wired nos eventos de pedido; (5) WhatsApp nos eventos de aprovação/rejeição/pedido. Migration 031 aplicada. 26 novos testes.
>
> **v6.1.1:** Campos de receita médica expostos no formulário de produto (seção "Receita Médica"). `Product` type + `productSchema` atualizados. Produtos do catálogo inicial classificados em produção via API.
> **v6.1.0:** Enforcement completo de receitas médicas — migration 030, `lib/prescription-rules.ts`, `POST /api/orders/[id]/advance` (gate único), `POST /api/orders/[id]/prescriptions` (upload por item), `PrescriptionManager` UI. 16 novos testes. 786 testes passando.
> **v6.0.3:** 4 gaps da auditoria interna corrigidos em `lib/ai.ts`: validação de enum/boolean em `analyzeSentiment`, `temperature 0` em contratos, circuit breakers separados por feature. 3 novos TCs. 770 testes passando.
> **v6.0.2:** Plano de auditoria de QA e segurança (incl. IA) — `docs/audit-qa-plena-2026-04.md` (~242 casos explícitos + matriz de expansão RBAC para 40 rotas API). Alinhado a `known-limitations`, LGPD e roadmap.
> **v6.0.1:** Cobertura completa para features de IA — 44 novos testes (lead-score, lib/ai, 4 jobs Inngest, OCR route, recommendations route, 3 crons). Migration 029 aplicada em produção. `OPENAI_API_KEY` configurada no Vercel (Production + Preview). 767 testes passando.
> **v6.0.0:** Integração de IA com 8 features em produção: score de leads, detecção de churn, alerta preditivo de recompra, triagem automática de tickets (GPT-4o-mini), análise de sentimento em suporte, geração automática de contratos, OCR de documentos (GPT-4o Vision), recomendações de produtos (Apriori SQL). Migration 029 criada. 3 novos crons.
> **v5.3.2:** Fix erro `'use server'` em `services/coupons.ts` (exportação de schema Zod violava restrição do App Router). Sidebar "Cupons" reposicionado para posição 4. Teste de conformidade `use server` adicionado.
> **v5.3.1:** Melhorias na feature de cupons — UX admin com `SearchableSelect`, `used_count` atômico, resumo financeiro em pedidos, alertas de expiração (cron diário). 14 novos testes.
> **v5.3.0:** Cupons de desconto por produto e por clínica — admin cria, clínica ativa uma vez, auto-aplica por unidade, plataforma absorve. Migrations 027 e 028.
> **v5.2.1:** Migration 026 aplicada em produção. 21 novos testes unitários + 2 E2E. Fix da suite vitest (Node.js 18 compatível). 701 testes passando.
> **v5.2.0:** Captura de leads de cadastro — rascunhos anônimos + envio sem documentos (PENDING_DOCS). Admin vê 3 camadas: interesses incompletos, sem docs, completos.
> **v5.1.4:** `/terms` adicionado às `PUBLIC_ROUTES` do middleware (Termos de Uso inacessível sem autenticação). Cobertura E2E adicionada: 3 novos testes em `smoke.test.ts` e `01-auth.test.ts` previnem regressão.
> **v5.1.3:** Causa raiz definitiva identificada e corrigida — `DropdownMenuLabel` usava `MenuPrimitive.GroupLabel` do Base UI sem o `Group` context obrigatório, lançando error #31 ao abrir o menu do header.
> **v5.1.2:** `PrivateLayout` com tratamento defensivo de erros. Página `/profile` restaurada com funcionalidades completas.
> **v5.1.1:** Página `/profile` criada (versão inicial).
> **v5.1.0:** Política de Privacidade (`/privacy`) e Termos de Uso (`/terms`) implementados — LGPD, ANVISA, Marco Civil. Pendência #6 concluída. 685 testes passando.

---

## 🔴 BLOQUEANTES — Obrigatórios antes do primeiro cliente real

Sem estes itens a plataforma não pode operar comercialmente (jurídico, fiscal ou tecnicamente inviável).

| #     | Pendência                                       | Razão                                                                                              | Como resolver                                                                                       |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1     | **CNPJ da empresa**                             | Pré-requisito de TUDO abaixo                                                                       | Abrir empresa com contadora                                                                         |
| 2     | **Asaas → Produção**                            | Sem CNPJ, zero pagamentos reais processados                                                        | Conta Asaas PJ → API Key prod → atualizar `ASAAS_API_KEY` + `ASAAS_API_URL` no Vercel               |
| ~~3~~ | ~~**NF-e / NFS-e**~~                            | ✅ **v6.8.0** — código pronto, aguarda credenciais Nuvem Fiscal + migration 042                    |
| ~~4~~ | ~~**Clicksign → Produção**~~                    | ✅ **PRODUÇÃO CONFIGURADA (2026-04-16)** — pendência manual: registrar webhook no painel Clicksign | —                                                                                                   |
| 5     | **DPA formal (LGPD)**                           | Obrigação legal com parceiros que processam dados                                                  | Elaborar com advogado LGPD — assinar com farmácias e clínicas antes do go-live                      |
| ~~6~~ | ~~**Política de Privacidade + Termos de Uso**~~ | ~~LGPD Art. 8~~                                                                                    | ✅ Implementado em `/privacy` e `/terms` — v5.1.0                                                   |
| 7     | **Migração PII encrypted**                      | Dados existentes de `phone`/`crm` ainda em plaintext                                               | Escrever e rodar script: ler plaintext → `encrypt()` → salvar em `*_encrypted` → atualizar services |

---

## 🟡 IMPORTANTES — Fazer antes de escalar (primeiros 30 dias)

Não bloqueiam o primeiro cliente, mas impactam operação, conversão e compliance.

### Infraestrutura / DevOps

| #      | Pendência                                                                                                                                                                                                     | Onde documentado                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --- |
| ~~8~~  | ~~**Supabase Staging**~~                                                                                                                                                                                      | ✅ **CONCLUÍDO (2026-04-16)** — `clinipharma-staging` criado, 42 migrations aplicadas, seed executado | —   |
| 9      | **Branch `staging` → Vercel auto-deploy** — configurar no painel Vercel: Settings → Git → branch `staging`                                                                                                    | `docs/staging-environment.md`                                                                         |
| ~~10~~ | ~~**Load testing com k6**~~ — ✅ **CONCLUÍDO (2026-04-16)** — baseline executado: health p95=265ms ✅ SLO, auth rate-limit Supabase ✅ (esperado/segurança). list-orders/export aguardam dados reais em prod. | `docs/load-testing.md`                                                                                |
| 11     | **DR simulação** — restore de backup em staging + medir RTO/RPO reais                                                                                                                                         | `docs/disaster-recovery.md`                                                                           |
| 12     | **Cloudflare WAF** — ativar OWASP Core Ruleset + rate limit 100 req/min em `/api/`                                                                                                                            | `docs/roadmap-90pts.md` A2                                                                            |
| ~~13~~ | ~~**Inngest Cloud**~~                                                                                                                                                                                         | ✅ **CONCLUÍDO (2026-04-16)** — keys configuradas, app synced, 7 funções registradas                  | —   |

### Notificações

| #      | Pendência                                                                                                                                                                                                                                                                    | Onde documentado                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --- |
| 14     | **Zenvia SMS + WhatsApp** — criar conta, obter token e senders, atualizar 3 vars Vercel. ⚠️ **Requer aprovação:** WhatsApp Business pode levar dias úteis (verificação Meta via Zenvia); SMS tende a ser mais rápido. Sandbox disponível imediatamente para testes internos. | `docs/go-live-checklist.md` item 3                                                                           |
| ~~16~~ | ~~**Clicksign webhook**~~                                                                                                                                                                                                                                                    | ✅ **CONCLUÍDO** — URL registrada + HMAC SHA256 Secret configurado no painel Clicksign produção (2026-04-16) | —   |

### Observabilidade

| #      | Pendência                                                                  | Onde documentado                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| ~~17~~ | ~~**UptimeRobot**~~                                                        | ✅ **CONCLUÍDO (2026-04-16)** — monitor `/api/health` ativo. Status page: https://stats.uptimerobot.com/gPxExgRxI7                                                   | —   |
| ~~18~~ | ~~**Sentry alertas**~~                                                     | ✅ **CONCLUÍDO (2026-04-16)** — 2 alertas configurados: "High error rate" (>10x/hora) e "New issue in production". Alerta de métrica p95 requer plano pago — adiado. | —   |
| 19     | **Vercel Log Drain** — conectar Logtail ou Axiom para persistência de logs | `docs/roadmap-90pts.md` A13                                                                                                                                          |
| 20     | **OpenTelemetry** — integrar `@vercel/otel` para spans em queries Supabase | `docs/roadmap-90pts.md` A13                                                                                                                                          |

---

## 🟠 RECOMENDADOS — Qualidade técnica (próximo sprint)

Sem impacto no go-live mas reduzem risco operacional e dívida técnica.

### Segurança

| #      | Pendência                              | Detalhe                                                                                                                                                             |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 21     | **Pentest externo**                    | Contratar Tempest, Conviso ou Kondado (R$8k–20k). Obrigatório antes de clientes regulados. Ver `docs/roadmap-90pts.md` A17                                          |
| ~~22~~ | ~~**Circuit breaker para email/SMS**~~ | ✅ **CONCLUÍDO (2026-04-16)** — `lib/email/index.ts` (Resend, 3 falhas / 60s) e `lib/zenvia.ts` (SMS+WhatsApp, 3 falhas / 30s) protegidos com `withCircuitBreaker`. | —   |
| 23     | **Testes E2E contra staging real**     | Rodar `BASE_URL=staging.clinipharma.com.br npx playwright test` após provisionar staging                                                                            |

### Produto / UX

| #      | Pendência                           | Detalhe                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~24~~ | ~~**Ícones PWA**~~                  | ✅ **v6.3.0**: `public/icons/icon-192x192.png` e `icon-512x512.png` criados                                                                                                                                                                                                            |
| 25     | **Auditoria WCAG 2.1**              | Instalar `axe-core` + corrigir issues de contraste, labels, ARIA, navegação por teclado                                                                                                                                                                                                |
| 26     | **Service Worker (cache offline)**  | Avaliar `next-pwa` ou Workbox para cache de assets estáticos                                                                                                                                                                                                                           |
| 27     | **OpenAPI / Swagger**               | Documentação interna via `zod-to-openapi` — útil para integrações futuras                                                                                                                                                                                                              |
| 28     | **2FA**                             | Autenticação em dois fatores não implementada                                                                                                                                                                                                                                          |
| 29     | **Google OAuth**                    | Preparado no Supabase, não ativado (requer Google Cloud Console)                                                                                                                                                                                                                       |
| 36     | **Substâncias controladas (SNGPC)** | Produtos psicotrópicos/entorpecentes exigem retenção física da receita e notificação ao SNGPC (ANVISA). Quando implementar: (1) flag `controlled_substance` em `products`; (2) bloquear pedido até confirmação de retenção física; (3) integrar API SNGPC para notificação automática. |

### Cobertura de testes

| #   | Pendência                        | Detalhe                                                                                                                                                                                                                                                          |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30  | **Testes Inngest (integration)** | Jobs têm cobertura de registro e lógica de filtros em unit tests. Testar com `npx inngest-cli@latest dev` para fluxo completo.                                                                                                                                   |
| 31  | **Cobertura de branches**        | Melhorar cobertura de branches em `compliance.ts`, `rate-limit.ts` (Redis path), `services/consultants.ts`. `lib/orders/doctor-field-rules.ts` 100% branches (v6.4.1). `lib/nuvem-fiscal.ts` e `services/nfse.ts` cobertos com 18 testes unitários (2026-04-16). |

### Inteligência Artificial

| #   | Pendência                          | Detalhe                                                                                                                                                 |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | **`OPENAI_API_KEY` no Staging**    | Variável configurada em Production e Preview. Quando o projeto Supabase staging for criado, adicionar também ao ambiente de desenvolvimento.            |
| 33  | **`pgvector` — busca semântica**   | Extensão não ativada. Habilitada quando Feature H2 (busca semântica de produtos) for implementada — requer `CREATE EXTENSION vector` no Supabase.       |
| 34  | **Custo OpenAI em escala**         | Monitorar via OpenAI Usage Dashboard. Configurar alerta de gasto mensal. Ver `docs/ai-aplicacoes-estudo.md` seção 6 para projeções.                     |
| 35  | **Product associations populadas** | Tabela `product_associations` criada mas vazia — o job semanal (`/api/cron/product-recommendations`) popula automaticamente após 5+ pedidos históricos. |

---

## 🟢 ONBOARDING — Após go-live técnico

Ações comerciais e operacionais (não técnicas):

| #   | Pendência                                                         |
| --- | ----------------------------------------------------------------- |
| 32  | Farmácias reais cadastradas e ativas na plataforma                |
| 33  | Catálogo real de produtos (preço, custo, prazo por SKU)           |
| 34  | Taxa de comissão dos consultores configurada em **Configurações** |
| 35  | Clínicas clientes onboardadas                                     |
| 36  | Médicos vinculados às clínicas                                    |
| 37  | Consultores de vendas cadastrados e vinculados                    |
| 38  | Primeiro pedido de ponta a ponta testado em produção real         |

---

## Bloco B — Bloqueado aguardando CNPJ

Itens do roadmap que dependem de CNPJ ativo para implementar:

| Item   | Descrição                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| ~~B1~~ | ~~**Emissão de NF-e**~~ — ✅ **v6.8.0**: NFS-e implementada via Nuvem Fiscal. Aguarda apenas credenciais + migration 042. |
| B2     | **Asaas produção completo** — split de pagamento, antecipação, relatórios fiscais                                         |
| B3     | **ANPD registro** — iniciar registro formal como controlador de dados pessoais                                            |
| B4     | **DPA template** — revisão final por advogado LGPD especializado                                                          |

---

## Resumo executivo

| Categoria                             | Qtd    | Responsável               |
| ------------------------------------- | ------ | ------------------------- |
| 🔴 Bloqueantes (pré-primeiro-cliente) | 7      | Fundador + Jurídico + Dev |
| 🟡 Importantes (30 dias)              | 13     | Dev + Fundador            |
| 🟠 Recomendados (próximo sprint)      | 16     | Dev                       |
| 🟢 Onboarding (após go-live)          | 7      | Comercial + Fundador      |
| **Total**                             | **43** |                           |

### Funcionalidades entregues (v4.7.0 → v6.1.1)

| Versão  | Feature                                                                                                        | Testes |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 4.7.0   | Explicações contextuais de SKU, Slug e Variantes no form                                                       | ✅     |
| 4.8.0   | SKU gerado automaticamente no formato `[CAT]-[FAR]-[NNNN]`                                                     | ✅     |
| 4.9.0   | Página de gerenciamento de categorias de produtos                                                              | ✅     |
| 5.0.0   | Sistema de suporte por tickets conversacional                                                                  | ✅     |
| 5.0.1   | Revisão completa do suporte: polling, UI otimista, busca                                                       | ✅     |
| 5.1.0   | Política de Privacidade e Termos de Uso (LGPD + ANVISA)                                                        | —      |
| 5.1.1   | Página `/profile` — corrige erro ao clicar no nome no header                                                   | ✅     |
| 5.1.4   | Fix middleware: `/terms` público + cobertura E2E (TC-11, TC-12)                                                | ✅     |
| 5.2.0   | Captura de leads: drafts anônimos + PENDING_DOCS + painel admin                                                | ✅     |
| 5.2.1   | Migration 026 + 21 unit tests + 2 E2E + fix Vitest Node 18 (701 testes)                                        | ✅     |
| 5.3.0   | Cupons de desconto por produto/clínica — auto-aplica por unidade                                               | ✅     |
| 5.3.1   | Melhorias cupons: SearchableSelect, used_count, resumo financeiro, alertas                                     | ✅     |
| 5.3.2   | Fix `'use server'` coupons + sidebar Cupons reposicionado (posição 4)                                          | ✅     |
| 6.0.0   | IA integrada: 8 features (churn, recompra, triagem, sentimento, OCR, contratos, recomendações, lead score)     | ✅     |
| 6.0.1   | Cobertura IA: 44 novos testes + migration 029 aplicada + OPENAI_API_KEY Vercel                                 | ✅     |
| 6.0.2   | Auditoria QA plena — `docs/audit-qa-plena-2026-04.md` (~242 casos + matriz RBAC)                               | —      |
| 6.0.3   | Fix auditoria IA: `analyzeSentiment` validação enum/bool, `temperature 0` contratos, circuit breakers          | ✅     |
| 6.1.0   | Enforcement receitas médicas: migration 030, gate `/advance`, upload por item, UI PrescriptionManager          | ✅     |
| 6.1.1   | Formulário de produto: seção "Receita Médica" com toggle, tipo e unidades por receita                          | ✅     |
| 6.4.0   | Fluxo de pedidos: clínica auto-detectada, médico condicional por `requires_prescription`, migration 032        | ✅     |
| 6.4.1   | Refactor: `lib/orders/doctor-field-rules.ts` — lógica extraída do componente, 5 testes unitários               | ✅     |
| 6.4.2   | Fix RLS bootstrap, CLINIC_ADMIN cadastra médico com auto-vínculo, atalhos no form de pedido, 2 novos testes    | ✅     |
| 6.4.3   | Fix redirect pós-cadastro de médico: `/doctors/[id]` aberto para `CLINIC_ADMIN`, volta para `/orders/new`      | ✅     |
| 6.4.4   | Fix carrinho perdido: `?cart=` serializado na URL, `parseCartParam` com 7 testes unitários                     | ✅     |
| 6.5.3–5 | Fix SSG + adminClient em todas as pages privadas + gaps de segurança de tenant isolation                       | ✅     |
| 6.5.6   | Fix posicionamento `force-dynamic`: diretiva estava dentro de blocos `import {` em 31 pages (404 em prod)      | ✅     |
| 6.5.7   | Fix `/clinics/[id]`: join embutido PostgREST falhava silenciosamente → queries independentes                   | ✅     |
| 6.5.8   | Fix Zod v4 UUID estrito: uuidLoose aplicado em users/support/coupons/validators (erro "Invalid UUID")          | ✅     |
| 6.5.9   | Fluxo farmácia nos pedidos: fix `order_items_id`, DocumentManager independente, upload bloqueado, 5 etapas     | ✅     |
| 6.5.10  | Auditoria farmácia: scoping dashboard, READY_FOR_REVIEW, ownership produtos, sidebar, labels PT-BR             | ✅     |
| 6.5.11  | Minha Farmácia (`/my-pharmacy`): perfil completo + edição com ownership check para PHARMACY_ADMIN              | ✅     |
| 6.5.12  | Fix modal pagamento travado: `PROCESSING` inválido no CHECK constraint de `payments`                           | ✅     |
| 6.5.13  | Fix `force-dynamic` em `/orders/[id]` + script `test:coverage` no CI                                           | ✅     |
| 6.5.14  | Stepper visual 6 etapas em `PharmacyOrderActions` + aviso âmbar `pharmacy_cost = 0` no form de produto         | ✅     |
| 6.5.15  | Realtime de pedidos: `OrderRealtimeUpdater`, `LiveBadge`, toast de status, migration 034                       | ✅     |
| 6.5.16  | Fix Realtime: auth race + polling fallback 20 s + cleanup com refs + tratamento `CHANNEL_ERROR`/`TIMED_OUT`    | ✅     |
| 6.5.17  | Fix acesso negado em `/products/[id]` para `PHARMACY_ADMIN` — `requireRolePage` + ownership check              | ✅     |
| 6.5.18  | Fix info-leak: margem/comissão/lucro ocultos de `PHARMACY_ADMIN` em produtos e repasses; varredura completa    | ✅     |
| 6.5.19  | Fix fluxo de precificação: farmácia define repasse, plataforma define preço; ownership em `updatePharmacyCost` | ✅     |
| 6.5.20  | Workflow de precificação: inativo ao criar, notificação push, card dashboard, badge lista, banner detalhe      | ✅     |

**O que está 100% pronto:** plataforma técnica, autenticação, pedidos, pagamentos sandbox, notificações (push/email/SMS/push), LGPD portal, auditoria, compliance CNPJ, suporte por tickets com IA, cupons de desconto, gerenciamento de categorias, SKU automático, Política de Privacidade, Termos de Uso, E2E tests, CI/CD, documentação, **8 features de IA em produção**, **enforcement completo de receitas médicas com controle por produto e por unidade**, **atualizações em tempo real via Supabase Realtime** (status do pedido sincronizado automaticamente entre clínica, farmácia e admin).

**O que bloqueia lançamento comercial:** CNPJ da empresa → Asaas produção → NF-e → DPA/LGPD (itens 1–5 e 7).

---

_Documento gerado automaticamente a partir de `docs/go-live-checklist.md`, `docs/roadmap-90pts.md` e auditorias de código. Atualizar sempre que um item for concluído._
