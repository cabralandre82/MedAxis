# Clinipharma

**Plataforma B2B de intermediação médica** entre clínicas, médicos e farmácias parceiras.

> **Status:** ✅ MVP em produção — https://clinipharma-three.vercel.app

---

## O que é o Clinipharma

Clinipharma é uma plataforma web fechada (login obrigatório) que conecta:

- **Clínicas** — criam e acompanham pedidos de produtos farmacêuticos
- **Médicos** — solicitam produtos e anexam documentação obrigatória
- **Farmácias parceiras** — recebem pedidos, executam e entregam para clínicas
- **Plataforma administradora** — gerencia entidades, confirma pagamentos, registra repasses

Não existe paciente final no fluxo. Tudo é B2B. A entrega é sempre para a clínica.

---

## Infraestrutura de Produção

| Serviço  | URL / Referência                                                    |
| -------- | ------------------------------------------------------------------- |
| Frontend | https://clinipharma.com.br (DNS propagando)                         |
| Vercel   | https://clinipharma-5x0yoajyw-cabralandre-3009s-projects.vercel.app |
| Supabase | https://app.supabase.com/project/jomdntqlgrupvhrqoyai               |
| GitHub   | https://github.com/cabralandre82/clinipharma                        |

---

## Stack

| Camada       | Tecnologia                             |
| ------------ | -------------------------------------- |
| Frontend     | Next.js 15, TypeScript, App Router     |
| UI           | Tailwind CSS v4, shadcn/ui, Lucide     |
| Backend/BaaS | Supabase (PostgreSQL + Auth + Storage) |
| Validação    | Zod v4                                 |
| Formulários  | React Hook Form                        |
| Estado       | Zustand                                |
| Testes       | Vitest (unit) + Playwright (e2e)       |
| Deploy       | Vercel (frontend) + Supabase (backend) |

---

## Módulos implementados

| Módulo                 | Descrição                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Autenticação           | Login email/senha, recuperação de senha, middleware RBAC                              |
| Gestão de Usuários     | Criar, vincular, redefinir senha, papéis por organização                              |
| Catálogo               | Listagem paginada, filtros por categoria/farmácia, ordenação, busca, detalhe por slug |
| Pedidos                | Carrinho multi-produto, congelamento de preço por item, upload docs, timeline         |
| Pagamentos             | Confirmação manual pelo admin, exportação CSV/Excel                                   |
| Comissões              | Cálculo automático na confirmação; modelo por produto com `pharmacy_cost`             |
| Repasses               | Registro manual para farmácias e consultores, exportação CSV/Excel                    |
| Clínicas               | CRUD completo, status, membros                                                        |
| Médicos                | CRUD, vínculo com clínicas                                                            |
| Farmácias              | CRUD, dados bancários, produtos, repasses                                             |
| Produtos               | CRUD, histórico de preço e `pharmacy_cost`, análise de margem                         |
| Área da Farmácia       | Atualização de status operacional do pedido                                           |
| Documentos             | Tipos obrigatórios com checklist, upload adicional no detalhe do pedido               |
| Notificações           | Sino in-app em tempo real (realtime Supabase), marcar como lida                       |
| Busca global           | ⌘K — pedidos, clínicas, médicos, produtos em tempo real                               |
| Auditoria              | Log automático de todas as ações críticas, paginado                                   |
| Relatórios             | KPIs, gráfico de tendência mensal, alertas de pendências, exportação                  |
| Configurações          | Taxa de comissão dos consultores e parâmetros globais (SUPER_ADMIN)                   |
| Perfil                 | Edição de dados pessoais por qualquer usuário                                         |
| Dashboard              | Visão específica por papel (admin, clínica, médico, farmácia, consultor)              |
| Consultores de Vendas  | Cadastro, vinculação a clínicas, comissões automáticas por pedido                     |
| Repasses a Consultores | Registro de pagamento em batch por consultor, exportação CSV/Excel                    |

---

## Papéis de acesso

| Papel              | Acesso                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| `SUPER_ADMIN`      | Acesso total, configurações globais, gestão de consultores               |
| `PLATFORM_ADMIN`   | Acesso operacional completo exceto configurações e gestão de consultores |
| `CLINIC_ADMIN`     | Pedidos e dados da própria clínica                                       |
| `DOCTOR`           | Criação de pedidos e catálogo                                            |
| `PHARMACY_ADMIN`   | Pedidos atribuídos à farmácia e seus repasses                            |
| `SALES_CONSULTANT` | Dashboard próprio: clínicas vinculadas e extrato de comissões            |

---

## Início rápido (desenvolvimento local)

```bash
# 1. Clone o repositório
git clone https://github.com/cabralandre82/Clinipharma.git
cd Clinipharma

# 2. Configure variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com as credenciais do Supabase

# 3. Instale dependências (requer Node.js 20+)
npm install

# 4. Aplique as migrations no Supabase
supabase link --project-ref jomdntqlgrupvhrqoyai
supabase db push --password "SUA_SENHA_DB"

# 5. Execute o script de setup (buckets + usuários)
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/setup-production.ts

# 6. Rode o projeto
npm run dev
```

---

## Scripts disponíveis

```bash
npm run dev              # Servidor de desenvolvimento (http://localhost:3000)
npm run build            # Build de produção
npm run lint             # ESLint
npm run lint:fix         # ESLint com correção automática
npm run format           # Prettier
npm run test             # Vitest (unit tests)
npm run test:e2e         # Playwright (e2e tests)
npx tsx scripts/setup-production.ts   # Setup inicial de produção
```

---

## Documentação

| Arquivo                                                                                | Conteúdo                        |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| [PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)                                           | Visão geral do produto          |
| [PRD.md](./PRD.md)                                                                     | Requisitos detalhados           |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                                                   | Arquitetura técnica e estrutura |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)                                             | Schema do banco de dados        |
| [RBAC_MATRIX.md](./RBAC_MATRIX.md)                                                     | Matriz de permissões por papel  |
| [BUSINESS_RULES.md](./BUSINESS_RULES.md)                                               | Regras de negócio obrigatórias  |
| [USER_FLOWS.md](./USER_FLOWS.md)                                                       | Fluxos operacionais por papel   |
| [DEPLOY.md](./DEPLOY.md)                                                               | Guia completo de deploy         |
| [CHANGELOG.md](./CHANGELOG.md)                                                         | Histórico de versões            |
| [docs/setup-supabase.md](./docs/setup-supabase.md)                                     | Configuração do Supabase        |
| [docs/seed-users.md](./docs/seed-users.md)                                             | Credenciais dos usuários seed   |
| [docs/go-live-checklist.md](./docs/go-live-checklist.md)                               | Checklist de go-live            |
| [docs/known-limitations.md](./docs/known-limitations.md)                               | Limitações conhecidas do MVP    |
| [docs/manual-payment-confirmation-flow.md](./docs/manual-payment-confirmation-flow.md) | Fluxo de pagamento manual       |
| [docs/manual-transfer-flow.md](./docs/manual-transfer-flow.md)                         | Fluxo de repasse manual         |
| [docs/manual-price-update-flow.md](./docs/manual-price-update-flow.md)                 | Atualização de preços           |
| [docs/setup-email.md](./docs/setup-email.md)                                           | Configuração de email (Resend)  |

---

## Versão

`0.7.0` — Paginação, notificações in-app, busca global, exportação CSV/Excel, documentos por tipo, relatórios enriquecidos + Cloudflare e Resend verificados em produção
