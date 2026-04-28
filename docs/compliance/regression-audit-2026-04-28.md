# Regression audit — 2026-04-28

**Reportado por:** André (fundador), 09:52–10:51 BRT, 28/04/2026
**Triado por:** agente coding (mesma data)
**Severidade global:** P1 (vazamento financeiro + bloqueio operacional)
**Releases impactadas:** `1aeaab8` (a11y) + ondas anteriores

---

## Sumário executivo

Catorze itens. Não é uma única regressão — é o subproduto da auditoria
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
- [ ] Onda 3 — Multi-receita por produto, consultor-as-user, logs Vercel
- [ ] Guardrails permanentes (`scripts/claims/check-rbac-view-leak.sh`, ESLint custom rule, trigger Supabase mirror)

Será atualizado on-the-fly conforme commits aterrissam.
