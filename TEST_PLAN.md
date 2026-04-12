# Clinipharma — Plano de Testes

## Testes Unitários (Vitest)

### validators/

- `productSchema` — validação de produto
- `orderSchema` — validação de pedido
- `clinicSchema` — validação de clínica
- `doctorSchema` — validação de médico
- `pharmacySchema` — validação de farmácia

### lib/payments/

- `calculateCommission(grossAmount, percentage)` — cálculo correto
- `calculateNetAmount(gross, commission)` — resultado correto
- Casos de borda: percentual 0%, 100%, valor 0

### lib/rbac/

- `hasRole(user, role)` — retorna true/false corretamente
- `canPerformAction(user, action)` — verifica permissão
- `requireRole(roles)` — lança erro se não autorizado

### lib/utils/

- `formatCurrency(value)` — `1000` → `R$ 1.000,00`
- `formatDate(date)` — formatação correta
- `generateOrderCode(year, sequence)` — `CP-2026-000001`

## Testes E2E (Playwright)

### TC-01: Login com email/senha

1. Acessa /login
2. Preenche credenciais válidas
3. Verifica redirecionamento para /dashboard

### TC-02: Login com credenciais inválidas

1. Preenche credenciais erradas
2. Verifica mensagem de erro

### TC-03: Catálogo carrega

1. Faz login
2. Acessa /catalog
3. Verifica que produtos aparecem

### TC-04: Página de produto

1. Clica em um produto no catálogo
2. Verifica campos: nome, preço, prazo, farmácia, descrição

### TC-05: Criar pedido

1. Acessa página de produto
2. Clica em "Solicitar Pedido"
3. Preenche formulário
4. Faz upload de documento
5. Confirma pedido
6. Verifica redirecionamento para detalhe do pedido
7. Verifica status: AWAITING_PAYMENT

### TC-06: Admin confirma pagamento

1. Login como PLATFORM_ADMIN
2. Acessa /payments
3. Confirma pagamento pendente
4. Verifica mudança de status no pedido

### TC-07: Admin registra repasse

1. Login como PLATFORM_ADMIN
2. Acessa /transfers
3. Registra repasse como concluído
4. Verifica que order_status é RELEASED_FOR_EXECUTION

### TC-08: Farmácia atualiza status

1. Login como PHARMACY_ADMIN
2. Acessa /orders
3. Vê pedido liberado
4. Atualiza para IN_EXECUTION
5. Atualiza para SHIPPED
6. Verifica timeline no detalhe do pedido

### TC-09: Timeline visível

1. Acessa detalhe de pedido com histórico
2. Verifica que todos os status anteriores aparecem na timeline

### TC-10: Isolamento de dados

1. Login como CLINIC_ADMIN da Clínica A
2. Verifica que não vê pedidos da Clínica B

### TC-11: Páginas legais acessíveis sem autenticação

**Arquivo:** `tests/e2e/01-auth.test.ts`

1. Sem sessão ativa, acessa `/terms`
2. Verifica que **não** redireciona para `/login`
3. Verifica que o body da página está visível
4. Repete para `/privacy`

**Regressão cobre:** bug v5.1.4 — `/terms` ausente de `PUBLIC_ROUTES` no middleware.

### TC-12: Smoke — rotas públicas carregam sem erro

**Arquivo:** `tests/e2e/smoke.test.ts`

Para cada rota em `['/login', '/terms', '/privacy']`:

1. Sem sessão ativa, navega para a rota
2. Verifica body visível e ausência de overlay de erro Next.js
3. Verifica ausência de erros críticos no console
