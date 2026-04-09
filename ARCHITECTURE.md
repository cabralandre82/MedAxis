# Clinipharma — Arquitetura Técnica

## Visão geral

```
Browser (Next.js App Router)
    │
    ├── Server Components (leitura de dados, sem JS no cliente)
    ├── Client Components (interatividade, formulários)
    └── Server Actions (mutações seguras, validadas com Zod)
          │
          ▼
    Supabase (BaaS)
    ├── Auth (JWT, sessões, cookies via @supabase/ssr)
    ├── PostgreSQL (banco principal + RLS)
    └── Storage (imagens de produtos, documentos de pedidos)
```

## Estrutura do projeto

```
b2b-med-platform/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Rotas públicas (login, forgot-password, callback)
│   └── (private)/          # Rotas privadas (dashboard, catálogo, pedidos...)
├── components/
│   ├── ui/                 # shadcn/ui (gerado automaticamente)
│   ├── layout/             # Sidebar, Header, Shell
│   ├── catalog/            # Componentes do catálogo
│   ├── orders/             # Componentes de pedidos
│   ├── dashboard/          # Widgets e KPIs
│   ├── forms/              # Formulários reutilizáveis
│   └── shared/             # Componentes genéricos
├── lib/
│   ├── auth/               # Helpers de autenticação e sessão
│   ├── db/                 # Helpers de banco (Supabase client)
│   ├── rbac/               # Guards e helpers de permissão
│   ├── audit/              # Logger de auditoria
│   ├── payments/           # Lógica de pagamentos e comissão
│   ├── transfers/          # Lógica de repasses
│   ├── validators/         # Schemas Zod
│   └── utils/              # Utilitários gerais
├── hooks/                  # React hooks customizados
├── stores/                 # Zustand stores
├── services/               # Camada de serviços (acesso ao Supabase)
├── types/                  # TypeScript types e interfaces
├── supabase/
│   ├── migrations/         # SQL migrations numeradas
│   └── seed/               # Seeds de desenvolvimento
└── tests/
    ├── unit/               # Vitest
    └── e2e/                # Playwright
```

## Autenticação

- Supabase Auth com cookies via `@supabase/ssr`
- Middleware Next.js intercepta todas as rotas privadas
- Sessão renovada automaticamente pelo middleware
- Papéis (roles) carregados da tabela `user_roles` após login
- Role armazenado no Zustand para uso nos componentes

## RBAC (Role-Based Access Control)

```typescript
// Exemplo de guard no servidor
import { requireRole } from '@/lib/rbac'

export async function action() {
  const user = await requireRole(['PLATFORM_ADMIN', 'SUPER_ADMIN'])
  // ... resto da lógica
}
```

Regra: **nunca confiar apenas no frontend**. Toda Server Action e Route Handler valida permissão.

## Fluxo de dados

### Leitura (Server Component)

```
page.tsx (Server Component)
  └── services/products.ts (Supabase server client)
        └── PostgreSQL (com RLS aplicado)
```

### Mutação (Server Action)

```
form.tsx (Client Component) → action.ts (Server Action)
  ├── Zod validation
  ├── requireRole() check
  ├── Supabase server client
  ├── DB mutation
  └── audit log
```

## Supabase Storage

Dois buckets:

- `product-images` — imagens de produtos (público, somente leitura para autenticados)
- `order-documents` — documentos de pedidos (privado, RLS por organização)

## Deploy

- **Frontend**: Vercel (conectado ao GitHub, auto-deploy na branch `main`)
- **Backend**: Supabase Cloud (projeto `jomdntqlgrupvhrqoyai`)
- **Migrations**: rodadas via `supabase db push` ou SQL Editor do Supabase

## Variáveis de ambiente

Todas as variáveis estão documentadas em `.env.example`.
Variáveis prefixadas com `NEXT_PUBLIC_` são seguras para expor ao browser.
`SUPABASE_SERVICE_ROLE_KEY` é usado apenas em Server Actions/Route Handlers — nunca no cliente.
