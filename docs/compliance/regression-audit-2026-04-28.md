# Regression audit — 2026-04-28

**Reportado por:** André (fundador), 09:52–10:51 BRT, 28/04/2026
**Triado por:** agente coding (mesma data)
**Severidade global:** P1 (vazamento financeiro + bloqueio operacional)
**Releases impactadas:** `1aeaab8` (a11y) + ondas anteriores

---

## Sumário executivo

Catorze itens originais + 3 follow-ups (multi-receita, hydration, FB SDK)

- épico do consultor (issues #16/#17 → #30). **Todos fechados em
  2026-04-28** com guardrails permanentes (verifier RBAC view-leak, ESLint
  `no-raw-status-render`, trigger Supabase `auth → profiles` mirror,
  suite de testes pinando os contratos de view-mode/onboarding/email).

Não foi uma única regressão — é o subproduto da auditoria
WCAG ter passado por dezenas de componentes e ter exposto problemas
**latentes** que estavam invisíveis antes. Eles agrupam em 5 famílias:

| Família                                | Itens                          | Causa-raiz                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 RBAC view (farmácia ↔ preço venda)  | 5×                             | Não existe um helper central que decida "qual preço esta role enxerga". Cada componente toca `price_current`/`unit_price`/`total_price` diretamente. Bug v6.5.18 cobriu transfers, mas pedidos/produtos/my-pharmacy ficaram.   |
| 🔴 Workflow de documento               | 4× (timeline, badge, contador) | Estado do documento (`order_documents.status`) e estado do pedido (`orders.order_status`) não são costurados. Upload da receita não atualiza o pedido para `READY_FOR_REVIEW`; sem isso a farmácia não tem botão para análise. |
| 🟠 i18n / cor no dashboard cliente     | 1× (mas cascateia)             | `clinic-dashboard.tsx` faz `replace(/_/g, ' ')` no enum em vez de usar `STATUS_LABELS`. Status sai cru e em inglês.                                                                                                            |
| 🟠 Consultor incompleto                | 4×                             | `sales_consultants` é tabela isolada, não é um `profile`. Sem login, sem email, sem dashboard, sem `/users`. Form não tem campo `status`, dialog filtra `ACTIVE` mas só foi visto stale data.                                  |
| 🟡 Diversos (cupom, hydration, FB SDK) | 3×                             | Cada um tem sua própria causa.                                                                                                                                                                                                 |

**Princípio do plano:** cada onda fecha o eixo + adiciona um guardrail
(teste, lint ou verifier `claims-audit`) que torna a regressão visível
no próximo PR.

---

## Mapa item × arquivo × causa-raiz

| #   | Sintoma reportado                                                                                   | Severid.   | Arquivo(s)                                                                                                             | Causa-raiz                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cupom ativo da clínica não mostra desconto no catálogo                                              | P2         | `components/catalog/catalog-grid.tsx`, `app/(private)/catalog/page.tsx`                                                | Catálogo não pré-busca cupons aplicáveis ao buyer; só aplica no `createOrder`. Order-detail mostra desconto após criação.              |
| 2   | Farmácia vê **preço de venda** em `/orders` (lista)                                                 | **P1**     | `components/orders/orders-table.tsx`, `app/(private)/orders/page.tsx`                                                  | `total_price` mostrado para todos. Farmácia precisa do total de repasse `Σ qty × pharmacy_cost_per_unit`.                              |
| 3   | Farmácia vê **preço de venda** em `/my-pharmacy` (produtos)                                         | **P1**     | `app/(private)/my-pharmacy/page.tsx`                                                                                   | Query seleciona `price_current`. Falta `pharmacy_cost`.                                                                                |
| 4   | Farmácia vê **preço de venda** em `/products` (lista)                                               | **P1**     | `app/(private)/products/page.tsx`                                                                                      | Mesma — coluna "Preço" sempre `price_current`.                                                                                         |
| 5   | Farmácia vê **preço de venda** em `/orders/[id]` (itens do pedido)                                  | **P1**     | `components/orders/order-detail.tsx` (linhas 308–317, 376)                                                             | Tabela de itens não tem branch por role.                                                                                               |
| 6   | Receita anexada mas badge à direita "aguardando documentação"                                       | **P1**     | `components/orders/document-manager.tsx`, `services/orders.ts` (`uploadOrderDocument`), `lib/orders/status-machine.ts` | Upload de prescrição não transiciona `AWAITING_DOCUMENTS → READY_FOR_REVIEW`.                                                          |
| 7   | Sem botão "Concluí a análise da receita"                                                            | **P1**     | `components/orders/document-manager.tsx`, `components/orders/pharmacy-order-actions.tsx`                               | `canReview` só fica true em `READY_FOR_REVIEW`; como item 6 trava a transição, nunca aparece.                                          |
| 8   | Timeline mostra "aguardando documentação" mesmo após envio                                          | **P1**     | mesmo bug do 6 — sem nova entrada em `order_status_history`                                                            | idem 6.                                                                                                                                |
| 9   | Dashboard farmácia "Revisar documentos = 0" mas há pedido parado                                    | **P1**     | `components/dashboard/pharmacy-dashboard.tsx`                                                                          | Conta apenas `READY_FOR_REVIEW`. Como nada chega lá (item 6), contador zera.                                                           |
| 10  | Botão "Novo pedido" aparece para farmácia                                                           | P2         | `app/(private)/orders/page.tsx` (linha 101)                                                                            | `!isAdmin` engloba farmácia. Falta excluir `isPharmacy`.                                                                               |
| 11  | Multi-receita: pedido com vários itens controlados não diz **quais** + sem upload por item          | P3         | `components/orders/document-manager.tsx`, `components/orders/prescription-manager.tsx`                                 | Mensagem genérica + UI já tem `prescription-manager` mas só ativa quando `max_units_per_prescription !== null`. Deveria sempre listar. |
| 12  | Dashboard clínica em inglês ("AWAITING DOCUMENTS") + sem cor                                        | P2         | `components/dashboard/clinic-dashboard.tsx` (linha 109)                                                                | `replace(/_/g, ' ')` em vez de `STATUS_LABELS[…]`; `Badge variant="outline"` sem mapa de cores.                                        |
| 13  | Lista de usuários: todos "Ativos"; detalhe mostra "Desativado"                                      | P2         | `app/(private)/users/page.tsx`, `app/(private)/users/[id]/page.tsx`                                                    | Lista lê `profiles.is_active`; detalhe lê `auth.users.banned_until`. Mirror da função `deactivateUser` é best-effort.                  |
| 14  | Consultor cadastrado não aparece para vincular à clínica                                            | P2         | `components/consultants/assign-consultant-dialog.tsx`                                                                  | Dialog filtra `status === 'ACTIVE'`. Após `requireRole(['SUPER_ADMIN'])` a página da clínica pode ter sido carregada antes da criação. |
| 15  | Não consigo mudar status do consultor                                                               | P2         | `components/consultants/consultant-form.tsx`                                                                           | Form não tem campo `status`. RPC `updateConsultantStatus` existe mas sem UI.                                                           |
| 16  | Consultor não recebe email de cadastro / venda / vínculo de clínica                                 | P3         | `services/consultants.ts`, `lib/email/templates.ts`                                                                    | Templates só existem para `consultantTransfer`. Sem onboarding/sale notifications.                                                     |
| 17  | Consultor não tem dashboard / não aparece em `/users` (junto com farmácias/clínicas/médicos/admins) | P3 (épico) | múltiplos                                                                                                              | `sales_consultants` é tabela própria, sem profile. É feature, não bug pontual.                                                         |

### Sentry

| #   | Issue                                                            | Causa-raiz                                                                                                                                                       | Arquivo                  |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| S1  | **Hydration Error** em `/orders/[id]` (Edge/Windows)             | `formatDateTime` em `lib/utils.ts` usa `date-fns format` sem `timeZone` explícito → SSR (UTC) ≠ client (BRT) → mismatch.                                         | `lib/utils.ts`           |
| S2  | **FirebaseError messaging/unsupported-browser** em iPhone Safari | `lib/firebase/client.ts` usa `getMessaging()` direto. Firebase 9+ rejeita assincronamente em browsers que faltam APIs (iOS Safari). Falta `await isSupported()`. | `lib/firebase/client.ts` |

### Logs Vercel

| #   | Sintoma                                                  | Plano                                                                                                                                                                                                    |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | "Nos logs do servidor tem varios erros e warns recentes" | Auditar via `vercel logs --since 24h --output json` (próxima onda). Esperam-se: rastros do bug do upload de prescrição, possivelmente firebase rejection capturado pelo Sentry, queries 404 do realtime. |

---

## Plano de execução em ondas

Cada onda termina com: code + teste de regressão (unit ou E2E) + verifier do
claims-audit (quando aplicável) + commit isolado. PR draft só ao final.

### Onda 1 — Crítico (Mesma sessão de hoje)

| Eixo                                         | Bundle                                         | Itens fechados | Guardrail                                                                                                 |
| -------------------------------------------- | ---------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| 🔴 RBAC view farmácia                        | `lib/orders/view-mode.ts` + 4 lugares          | 2, 3, 4, 5     | `tests/unit/rbac-view-mode.test.ts` afirma que pharmacy nunca vê `unit_price`/`total_price` rendered text |
| 🔴 Hydration error (Sentry S1)               | `lib/utils.ts` timezone explícito              | S1             | `tests/unit/utils.test.ts` dado SSR-em-UTC vs client-em-BRT, `formatDateTime` é determinístico            |
| 🟡 Firebase silent on iOS Safari (Sentry S2) | `await isSupported()` em `client.ts`           | S2             | `tests/unit/firebase-client.test.ts` mocka window com APIs faltantes → função retorna null sem throw      |
| 🟠 Dashboard clínica i18n + cor              | `clinic-dashboard.tsx` + reuso `STATUS_LABELS` | 12             | `tests/unit/dashboard-i18n.test.tsx` SSR snapshot + grep no claims-audit                                  |
| 🟡 Botão "Novo pedido" sumir p/ farmácia     | `app/(private)/orders/page.tsx`                | 10             | snapshot test                                                                                             |
| 🟠 Contador "Revisar documentos"             | `components/dashboard/pharmacy-dashboard.tsx`  | 9 (parcial)    | conta `READY_FOR_REVIEW` ∪ `AWAITING_DOCUMENTS` com `order_documents` pendentes                           |

### Onda 2 — Workflow de documento + cupom + consultor (próxima sessão)

| Eixo                                       | Bundle                                                                                                                                                       | Itens fechados | Guardrail                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------- |
| 🔴 Workflow de documento                   | server action `submitOrderDocuments` transiciona `AWAITING_DOCUMENTS → READY_FOR_REVIEW` + DocumentManager full review (aprovar/rejeitar por doc) + timeline | 6, 7, 8, 9     | E2E em `tests/e2e/order-document-flow.test.ts`                       |
| 🟠 Cupom no catálogo                       | `app/(private)/catalog/page.tsx` busca cupons ativos do buyer + `catalog-grid` preview                                                                       | 1              | unit test `getActiveCouponsForCatalog`                               |
| 🟠 Lista de usuários consistente           | `app/(private)/users/page.tsx` cruzar com `auth.admin.listUsers()` ou unificar via trigger                                                                   | 13             | unit test SSR — assert "Desativado" badge para user com banned_until |
| 🟠 Consultor: status na form               | `consultant-form.tsx` ganha select `ACTIVE/INACTIVE/SUSPENDED` no modo edit                                                                                  | 15             | snapshot                                                             |
| 🟠 Consultor: dialog empty state + refresh | `assign-consultant-dialog.tsx` melhora UX quando lista vazia + linkar para `/consultants/new`                                                                | 14             | snapshot                                                             |

### Onda 3 — Multi-receita + consultor-as-user (épico, separar PR)

| Eixo                           | Bundle                                                                                               | Itens fechados | Notas                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| 🟡 Multi-receita por produto   | `prescription-manager.tsx` sempre lista cada item controlado, mesmo sem `max_units_per_prescription` | 11             | Pode exigir migration p/ tabela `order_item_prescriptions` se ainda não existe. |
| 🟡 Consultor como usuário      | sales_consultants ↔ profiles (1:1), seed `CONSULTANT` role, dashboard próprio, emails de comissão    | 16, 17         | Migration nova + nova rota `/consultant-dashboard` + integration tests          |
| 🟢 Logs Vercel / observability | `vercel logs` 24h, classificar warns/errors, abrir issues por classe                                 | L1             | Próxima sessão.                                                                 |

---

## Guardrails permanentes (one-time)

Após Onda 1 + 2 implementadas:

1. **`scripts/claims/check-rbac-view-leak.sh`** — varre `components/orders/*`, `app/(private)/products/*`, `app/(private)/my-pharmacy/*` por `price_current` ou `total_price` sem branch por `isPharmacy`/`viewMode`. Roda no `run-all.sh`.
2. **`tests/e2e/rbac-pharmacy-view.test.ts`** — Playwright loga como `pharmacy@e2e.test`, navega `/orders`, `/orders/[id]`, `/products`, `/my-pharmacy`, e afirma com `expect(page).not.toContainText(formatCurrency(pricePartilha))`.
3. **ESLint custom rule `no-raw-status-render`** — proíbe `${status}.replace(/_/g, ' ')` ou `<Badge>{order.order_status}</Badge>` sem passar por `STATUS_LABELS`.
4. **Trigger Supabase** `auth_user_to_profile_active_mirror` — `auth.users.banned_until IS NOT NULL ↔ profiles.is_active = false` automatizado, encerrando a janela onde o mirror best-effort falha.

---

## Status

- [x] Triage (este documento)
- [x] **Onda 1 — concluída em 2026-04-28** (commit a seguir)
  - [x] `lib/orders/view-mode.ts` criado (helper RBAC view central)
  - [x] `app/(private)/orders/page.tsx` — passa `viewMode` + remove botão "Novo pedido" para farmácia
  - [x] `components/orders/orders-table.tsx` — coluna "Repasse" + total via `visibleOrderTotal()`
  - [x] `components/orders/order-detail.tsx` — itens, unit, subtotal, total e cupom respeitam viewMode
  - [x] `app/(private)/products/page.tsx` — coluna "Repasse" + ordering + status pill
  - [x] `app/(private)/my-pharmacy/page.tsx` — `pharmacy_cost` em vez de `price_current`
  - [x] `lib/utils.ts` — `formatDate`/`formatDateTime` timezone-pinned em `America/Sao_Paulo` (corrige Sentry S1)
  - [x] `lib/firebase/client.ts` — gate `await isSupported()` antes de `getMessaging()` (corrige Sentry S2)
  - [x] `lib/orders/status-machine.ts` — `STATUS_BADGE_COLORS`, helpers `statusLabel()`/`statusBadgeClass()`
  - [x] `components/dashboard/clinic-dashboard.tsx` — usa `statusLabel()`+cor (corrige inglês cru)
  - [x] `components/dashboard/pharmacy-dashboard.tsx` — "Revisar documentos" inclui `AWAITING_DOCUMENTS` com docs `PENDING`
  - [x] `tests/unit/lib/orders/view-mode.test.ts` — 17 testes pinando o contrato RBAC (1938 → 1955 → confirmado)
  - [x] `tests/unit/lib/firebase-client.test.ts` — 4 testes do gate iOS Safari
  - [x] `tests/unit/utils.test.ts` — 3 testes timezone-pinned
  - [x] `npx tsc --noEmit` ✓
  - [x] `npx vitest run` ✓ 1938/1938 passing
  - [x] `npx eslint` ✓ zero errors
- [x] **Onda 2 — concluída em 2026-04-28** (commit a seguir)
  - [x] `lib/orders/document-transitions.ts` — `advanceOrderAfterDocumentUpload()` costura upload de documento → `AWAITING_DOCUMENTS → READY_FOR_REVIEW` + linha em `order_status_history`. Idempotente, com guarda otimista de race.
  - [x] `app/api/documents/upload/route.ts` — pluga a transição após o loop de upload. Resposta passou a incluir `order_status` e `transitioned`.
  - [x] `tests/unit/lib/orders/document-transitions.test.ts` — 6 testes (transition, no-op em outros status, falha de update vs falha de history não rola back, custom reason)
  - [x] `lib/coupons/preview.ts` — `previewDiscountedUnitPrice()` (puro, isomórfico) — único lugar onde a matemática vive.
  - [x] `services/coupons.ts` — `getActiveCouponsByProductForBuyer()` para o catálogo (PERCENT/FIXED + max + valid_until).
  - [x] `app/(private)/catalog/page.tsx` — busca cupons aplicáveis ao buyer e injeta no grid.
  - [x] `components/catalog/catalog-grid.tsx` — preview com preço riscado + chip "Cupom XYZ aplicado".
  - [x] `tests/unit/lib/coupons-preview.test.ts` — 7 testes pinando a matemática (PERCENT, FIXED, cap, clamp).
  - [x] `app/(private)/users/page.tsx` — cruza `auth.users.banned_until` com `profiles.is_active` para alinhar lista vs detalhe.
  - [x] `components/consultants/consultant-status-actions.tsx` — switcher 3-state (ACTIVE/INACTIVE/SUSPENDED) com confirm + transition.
  - [x] `app/(private)/consultants/[id]/page.tsx` — pluga o switcher acima do header.
  - [x] `components/consultants/assign-consultant-dialog.tsx` — empty-state explícito quando nenhum consultor ACTIVE existe + link para cadastrar/abrir lista.
  - [x] `npx tsc --noEmit` ✓
  - [x] `npx vitest run` ✓ **1951/1951 passing**
  - [x] `npx eslint` em todos arquivos modificados ✓ zero erros
- [x] **Onda 4 — concluída em 2026-04-28** (issue #11 fechada)
  - [x] **Fase 1 — visibilidade no cart**: badge "Receita" + emoji 💊 no dropdown da `new-order-form.tsx` + callout "Este pedido tem N produto(s) com receita obrigatória: X, Y, Z" listando explicitamente quais.
  - [x] **Fase 2 — upload por produto unificado**:
    - `lib/prescription-rules.ts` — Model A passa a aceitar AMBOS os caminhos: legacy `order_documents.PRESCRIPTION` E `order_item_prescriptions` (sem dupla contagem).
    - `components/orders/prescription-manager.tsx` — filter agora `requires_prescription` (cobre Model A + Model B). Para Model A, status binário "Receita enviada / pendente"; para Model B, barra de progresso preservada.
    - `components/orders/order-detail.tsx` — condição de render mudou de `max_units !== null` para `requires_prescription`. Header passou a ser "Receitas médicas (por produto)".
    - `app/api/orders/[id]/prescriptions/route.ts` — após upload, chama `getPrescriptionState` + `advanceOrderAfterDocumentUpload` se TODAS as receitas chegaram. Erros na transição não falham o upload.
  - [x] **Fase 3 — testes**: 3 novos casos em `tests/unit/lib/prescription-rules.test.ts` (TC-RX-10/11/12 — Model A via per-item path, dupla via legacy+per-item, mixed cart) + 3 em `tests/unit/api/prescription-upload.test.ts` (TC-RXU-11/12/13 — transition triggered, transition gated, transition error não falha upload).
  - [x] `npx tsc --noEmit` ✓
  - [x] `npx vitest run` ✓ **1966/1966 passing** (+6)
  - [x] `npx eslint .` ✓ zero erros
  - [x] `./scripts/claims/run-all.sh` ✓ 16/16 verifiers verde
- [x] **Épico — Consultor como usuário (login + dashboard + emails) — concluído em 2026-04-28** (issue #30)
  - [x] **Descoberta**: schema `sales_consultants` já tinha `user_id` + RLS keyed por `auth.uid()` (migration 004). Role `SALES_CONSULTANT` já existia em `types/index.ts`. `ConsultantDashboard` já estava pronto em `components/dashboard/consultant-dashboard.tsx` (KPIs A receber / Total recebido / Total gerado + lista de clínicas + histórico de comissões). **O gap era runtime, não schema**: nada criava o `auth.users` row + `user_roles` row no fluxo de cadastro.
  - [x] `lib/email/templates.ts` — 3 templates novos: `consultantWelcomeEmail` (link de definir senha + taxa), `consultantSaleConfirmedEmail` (comissão pendente após confirmPayment), `consultantClinicLinkedEmail` (clínica vinculada).
  - [x] `services/consultants.ts#createConsultant` — fluxo unificado: insere `sales_consultants` → cria `auth.users` (idempotente: se email já existir, reusa o usuário existente em vez de erro) → upsert `profiles` mirror (defensivo) → upsert `user_roles { user_id, SALES_CONSULTANT }` com `onConflict 'user_id,role'` → linka `sales_consultants.user_id` → gera `auth.admin.generateLink({ type: 'recovery' })` → envia welcome email. Email é fire-and-forget (nunca bloqueia o cadastro). Roll-back de auth user se role falhar.
  - [x] `services/consultants.ts#assignConsultantToClinic` — quando `consultantId` não-nulo, dispara `consultantClinicLinkedEmail`. Falha de email não bloqueia o write.
  - [x] `services/payments.ts#confirmPayment` — após insert de `consultant_commissions`, dispara `consultantSaleConfirmedEmail` para o consultor da clínica. Best-effort (try/catch + warn). Não roda se o insert da comissão falhou.
  - [x] `lib/orders/view-mode.ts` — adicionado mode `'consultant'` defensivo: força 0 em `visibleUnitAmount`/`visibleLineTotal`/`visibleOrderTotal` (consultor nunca vê preço de venda nem repasse — só comissão, que vem de `consultant_commissions.commission_amount` direto). Labels de coluna ganham "Comissão" / "Comissão/un.". `resolveViewMode` ranqueia consultant ABOVE buyer/admin (least-privilege).
  - [x] `components/users/users-table.tsx` — `ROLE_LABELS` + `ROLE_COLORS` ganham `SALES_CONSULTANT` ('Consultor', teal). Como `/users` já consulta `profiles.user_roles(role)`, novos consultores aparecem automaticamente assim que `createConsultant` semeia o `user_roles` row.
  - [x] `tests/setup.ts` — global mock de `@/lib/email/templates` ganhou `consultantWelcomeEmail`, `consultantSaleConfirmedEmail`, `consultantClinicLinkedEmail` para evitar `TypeError: not a function` em qualquer suite que toque os services novos.
  - [x] `tests/unit/services/consultants.test.ts` — bloco "full onboarding (auth provisioning)" pinando 4 invariantes: createUser chamado, user_roles upsertado com `SALES_CONSULTANT` e `onConflict 'user_id,role'`, generateLink chamado com `type: 'recovery'`, sendEmail chamado com link (`tok-abc`) embutido. Segundo teste: idempotência por email já existente — listUsers reusa user pré-existente em vez de erro 23505. Bloco "assignConsultantToClinic — clinic-linked email" pinando que email é enviado em link mas NÃO em unlink.
  - [x] `tests/unit/lib/orders/view-mode.test.ts` — bloco "consultant view-mode never leaks sales price or repasse" + casos de ranking (PHARMACY_ADMIN > consultant > admin/buyer).
  - [x] **Limitação conhecida — backfill**: consultores **antigos** que já existiam em `sales_consultants` antes deste commit (com `user_id IS NULL`) continuam sem login. Não há migration que re-execute `auth.admin.createUser` (é runtime API). Caminho ops: re-criar via `/consultants/new` ou abrir um one-shot script `scripts/backfill-consultant-users.ts` quando necessário. Documento aqui para rastreio futuro.
  - [x] `npx tsc --noEmit` ✓
  - [x] `npx vitest run` ✓ **1978/1978 passing** (+12 vs Onda 4)
  - [x] `npx eslint` ✓ zero erros
  - [x] `./scripts/claims/run-all.sh` ✓ 16/16 verifiers verde, zero findings
- [x] **Guardrails permanentes — concluídos em 2026-04-28**
  - [x] `scripts/claims/check-rbac-view-leak.sh` — varre superfícies pharmacy-facing por `price_current`/`unit_price`/`total_price`; aceita gates explícitos (import de `lib/orders/view-mode`, `isPharmacyAdmin`, `viewMode`, `// @rbac-view: ok`). 29 arquivos no scope, 0 leaks.
  - [x] `scripts/claims/run-all.sh` — verifier integrado ao run weekly.
  - [x] **Achados ao instalar o verifier (corrigidos no mesmo commit):**
    - `components/dashboard/pharmacy-dashboard.tsx` — selecionava `total_price` na query de orders sem render. Field removido do `select`.
    - `components/products/product-variants-manager.tsx` — exibia `price_current` de cada variante mesmo quando aberto pela farmácia. Adicionado `isPharmacyAdmin` que esconde preço de venda + margem + input de "Preço ao cliente".
    - `app/(private)/orders/new/page.tsx`, `components/orders/new-order-form.tsx`, `components/orders/templates/save-template-modal.tsx`, `components/orders/templates/templates-list.tsx` — buyer-only (clínica/médico), marcados com `// @rbac-view: ok` + rationale.
  - [x] `eslint-rules/no-raw-status-render.js` + `eslint.config.mjs` — proíbe `<*>.<…_status>.replace(/_/g, …)` em todo o repo. Erro, não warning.
  - [x] **Achado ao ativar a rule:** `components/dashboard/doctor-dashboard.tsx` tinha exatamente o mesmo bug do clinic-dashboard pré-Onda 1 — corrigido com `statusLabel()` + `statusBadgeClass()`.
  - [x] `tests/unit/eslint-no-raw-status-render.test.ts` — 13 casos (6 valid, 7 invalid) via ESLint `RuleTester`.
  - [x] `supabase/migrations/060_profile_active_mirror_from_auth.sql` — trigger `AFTER UPDATE OF banned_until ON auth.users` espelha `profiles.is_active` automaticamente. Inclui backfill bounded e smoke test que aborta a migration se houver drift remanescente. Fecha a janela onde `services/users.ts#deactivateUser` falha em best-effort.
  - [x] `tests/unit/migration-060-profile-active-mirror.test.ts` — 8 testes pinando shape do DDL (SECURITY DEFINER, search_path pinned, WHEN clause, semântica de `banned_until < now()`, smoke test, GRANT EXECUTE).
  - [x] `npx tsc --noEmit` ✓
  - [x] `npx vitest run` ✓ **1960/1960 passing**
  - [x] `npx eslint .` ✓ zero erros (warnings pre-existentes em `scripts/claims/*.mjs`)
  - [x] `./scripts/claims/run-all.sh` ✓ 16 verifiers passando, zero findings
- [x] **Auditoria de logs Vercel — concluída em 2026-04-28**
  - Build logs (deployment `dpl_5rP1ksc6yZhg2GP2HT7pzgVqEtE4`): apenas warnings cosméticos do SDK do Sentry (5×) — `DEPRECATION WARNING` para `sentry.client.config.ts` / `autoInstrumentMiddleware` / `autoInstrumentServerFunctions` e o aviso "Could not find onRequestError hook in instrumentation file". Tudo no Sentry SDK ≥9, não bloqueante. Tracked como Onda 3 housekeeping.
  - Runtime logs históricos: Vercel não expõe via REST API pública (sem log drain configurado, sem plano Observability+). A fonte autoritativa para erros runtime é o **Sentry**, e os 2 issues reportados (S1 hydration `/orders/[id]`, S2 firebase `/dashboard` iOS) já foram fixados na Onda 1 com testes pinando o gate.

- [x] **Cupom — follow-up 2026-04-28: estender desconto para `/catalog/[slug]` e `/orders/new`** (issue #1 reaberta + corrigida)
  - **Causa-raiz da regressão**: a Onda 2 só plugou o preview do cupom no `CatalogGrid`. As outras duas superfícies que mostram preço para o buyer (a página de detalhe do produto e o cart de novo pedido) continuavam exibindo `price_current` cheio, embora o `services/orders.ts#createOrder` aplicasse o desconto via trigger DB no insert. O resultado era exatamente a queixa: "vejo cupom ativo, mas no detalhe e no cart o preço continua cheio".
  - **Helper central**: `lib/orders/buyer-coupon-context.ts` (`resolveBuyerCouponPreview`) — resolve `clinic_id` (CLINIC_ADMIN) ou `doctor_id` (DOCTOR), consulta `getActiveCouponsByProductForBuyer` e retorna `Record<productId, CatalogCouponPreview>`. Pharmacy admins recebem `{}` (gate explícito antes de tocar DB). Anonymous + empty productIds + buyer sem registro → `{}`. Catálogo, detail e new-order agora chamam o MESMO helper — uma fonte de verdade.
  - **`app/(private)/catalog/page.tsx`**: trocou ~40 linhas de buyer-resolution inline por uma chamada a `resolveBuyerCouponPreview(currentUser, productIds)`.
  - **`app/(private)/catalog/[slug]/page.tsx`**: passou a buscar `couponPreview` para o produto e propagar via prop ao `ProductDetail`.
  - **`components/catalog/product-detail.tsx`**: aceita prop `coupon`. Quando há desconto >0, a "Price Box" azul renderiza preço com desconto + valor cheio riscado + chip "Cupom XYZ aplicado" (consistente com o card do grid).
  - **`app/(private)/orders/new/page.tsx`**: chama `resolveBuyerCouponPreview` para todos os `availableProducts` e injeta `couponPreviewByProduct` no `NewOrderForm`.
  - **`components/orders/new-order-form.tsx`**: helper local `priceFor(productId, unitPrice)` retorna `{ unit, full, perUnitDiscount, coupon }`. Aplicado em 5 superfícies: (1) linha do carrinho mostra preço/un riscado + descontado + chip do cupom + total da linha riscado quando houver desconto; (2) dropdown "Adicionar produto" mostra `R$ X,XX (cupom CODE)`; (3) `total` agora soma `unit` (com desconto), não `full`; (4) Resumo do pedido mostra subtotal riscado + linha "Desconto (cupons) − R$ X,XX" em verde + total final; (5) tooltip do chip explica `-N%` ou `-R$ X` por unidade.
  - **Testes**: `tests/unit/lib/orders/buyer-coupon-context.test.ts` (8 casos pinando: anônimo → vazio, productIds vazio → vazio, PHARMACY_ADMIN → vazio sem tocar DB, CLINIC_ADMIN → forward com `clinic_id`, DOCTOR → forward com `doctor_id`, sem membership → vazio, sem doctor row → vazio, dual-role PHARMACY+CLINIC → pharmacy gate vence). Os testes existentes do `previewDiscountedUnitPrice` (7 casos) continuam pinando a matemática.
  - **Verificações**: `npx tsc --noEmit` ✓, `npx vitest run` ✓ **1986/1986** (+8), `npx eslint` ✓ zero erros, `./scripts/claims/run-all.sh` ✓ 17/17 verifiers.

- [x] **Dependabot alert #11 — `uuid < 14.0.0` (GHSA-w5hq-g745-h8pq) — dispensado em 2026-04-28** (`tolerable_risk`)
  - Auditoria do call site de uuid em todos os deps transitivos (`firebase-admin`, `svix`, `@google-cloud/storage`, `google-gax`, `gaxios`, `teeny-request`, `exceljs`): **100% das 11 chamadas usam `v4()`**, que **não é vulnerável** (a própria advisory confirma — apenas `v3/v5/v6` com `buf`+`offset` caller-controlled estão afetados). Nosso código não importa `uuid` direto.
  - **Não foi feito override** porque uuid@12+ é ESM-only (CJS dropped) — forçaria quebra de todos os deps CJS acima. Não há backport patched para 8.x/9.x/10.x/11.x.
  - **Guardrail novo**: `scripts/claims/check-uuid-vulnerable-call.mjs` (verifier #17) varre `app/`, `components/`, `lib/`, `services/`, `scripts/` por chamadas a `v3/v5/v6` com 3+ argumentos (= buffer passado). Falha o build se algum PR futuro adicionar uma chamada vulnerável. 385 arquivos varridos, 0 leaks. Sanity-checkado com fixture de 6 cenários (3 fails legítimos + 3 passes corretos).
  - **Documentação**: `docs/security/known-acceptable-vulns.md` ganhou VULN-002 com vetor CVSS 4.0 6.3 medium, evidência da auditoria do call site, justificativa técnica do "por que não fazemos override", mitigações compensatórias e gatilhos de re-revisão (próxima em 2026-07-28).

### Próximos itens (não nesta janela)

- **Sentry SDK upgrade**: Resolve os 5 DEPRECATION warnings cosméticos do build (`sentry.client.config.ts` → `instrumentation-client.ts`, `autoInstrumentMiddleware` → `webpack.autoInstrumentMiddleware`, etc). Housekeeping; não bloqueia produção.
- **Backfill de consultores antigos** (opcional): para os consultores em `sales_consultants` com `user_id IS NULL` cadastrados antes do commit do épico #30, criar `scripts/backfill-consultant-users.ts` que itere e dispare a mesma lógica de auth provisioning. Não é regressão — é one-shot ops.

Será atualizado on-the-fly conforme commits aterrissam.
