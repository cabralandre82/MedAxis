# Changelog

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
- Deploy realizado na Vercel — https://med-axis-three.vercel.app
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
