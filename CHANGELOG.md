# Changelog

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
