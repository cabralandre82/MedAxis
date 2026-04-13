# Usuários Seed — Clinipharma

Usuários criados pelo script `scripts/setup-production.ts` via Supabase Admin API.

> Esses usuários existem tanto no ambiente de desenvolvimento quanto no Supabase de produção (`jomdntqlgrupvhrqoyai`), pois o script foi executado em produção.

---

## Credenciais

| Email                           | Senha               | Papel          | Organização               |
| ------------------------------- | ------------------- | -------------- | ------------------------- |
| `superadmin@clinipharma.com.br` | `Clinipharma@2026!` | SUPER_ADMIN    | Plataforma (acesso total) |
| `admin@clinipharma.com.br`      | `Clinipharma@2026!` | PLATFORM_ADMIN | Operação diária           |
| `admin@clinicasaude.com.br`     | `Clinipharma@2026!` | CLINIC_ADMIN   | Clínica Saúde Total       |
| `dr.silva@clinipharma.com.br`   | `Clinipharma@2026!` | DOCTOR         | Clínica Saúde Total       |
| `admin@farmaciaforte.com.br`    | `Clinipharma@2026!` | PHARMACY_ADMIN | Farmácia Forte            |

---

## Dados seed (banco)

Inseridos via `supabase/seed.sql` (executado com `supabase db push --include-seed`):

**Categorias:**

- Hormônios e TRH
- Dermatologia
- Emagrecimento
- Suplementação
- Ginecologia

**Farmácias:**

- Farmácia Forte — CNPJ 11.222.333/0001-44
- Farmácia Verde — CNPJ 22.333.444/0001-55

**Clínicas:**

- Clínica Saúde Total — CNPJ 33.444.555/0001-66
- Clínica Vida Plena — CNPJ 44.555.666/0001-77

**Médicos:**

- Dr. Carlos Silva — CRM SP 12345
- Dra. Ana Santos — CRM RJ 67890

**Produtos (5 produtos ativos):**

- Testosterona Gel 50mg — R$ 285,00
- Progesterona Creme 100mg — R$ 195,00
- Semaglutida 1mg/ml — R$ 890,00
- Ácido Retinoico 0.05% — R$ 145,00
- DHEA 25mg — R$ 165,00

---

## Fluxo de criação de pedidos

Ao acessar `/orders/new`:

- **`CLINIC_ADMIN`** — a clínica é detectada automaticamente via `clinic_members` (usando `adminClient` para contornar RLS); nenhum dropdown é exibido.
- **`DOCTOR`** — se vinculado a uma clínica, auto-selecionada; se a múltiplas, exibe dropdown apenas das suas clínicas.
- **`SUPER_ADMIN` / `PLATFORM_ADMIN`** — dropdown com todas as clínicas ativas.

**Campo "Médico solicitante":**

| Clínica tem médicos vinculados? | Carrinho tem produto com `requires_prescription`? | Comportamento                                                  |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Não                             | Qualquer                                          | Campo oculto + callout para cadastrar médico (se CLINIC_ADMIN) |
| Sim                             | Não                                               | Opcional                                                       |
| Sim                             | Sim                                               | Obrigatório                                                    |

A coluna `orders.doctor_id` é nullable desde a migration `032_orders_doctor_optional.sql`.

**Preservação do carrinho ao cadastrar médico:**

Ao clicar em "Cadastrar novo médico" dentro do formulário de pedido, os itens do carrinho são serializados na URL (`?cart=id:qty,id:qty`) e restaurados ao retornar para `/orders/new`. A lógica de serialização/desserialização está em `lib/orders/doctor-field-rules.ts` (`parseCartParam`).

**`CLINIC_ADMIN` criando médico:**

- Acesso liberado para `/doctors/new` e `/doctors/[id]`.
- Ao salvar, o médico é automaticamente vinculado à clínica do usuário (`doctor_clinic_links`) com status `ACTIVE`.
- O redirect pós-criação vai para `/orders/new` (preservando o carrinho via URL).

**Padrão de acesso a dados (RLS bootstrap):**

Todas as pages da área privada usam `createAdminClient()` (service role) com filtro de escopo explícito (`clinic_id` ou `pharmacy_id`), em vez do client de usuário com RLS. Isso evita dois problemas:

1. **RLS bootstrap** — o RLS falha silenciosamente e retorna listas vazias para usuários recém-adicionados.
2. **SSG cache** — sem `export const dynamic = 'force-dynamic'`, o Next.js gera HTML estático no build (quando o banco está vazio) e serve esse cache indefinidamente em produção.

Todas as pages da área privada (listagem, detalhe, edição e criação) têm `export const dynamic = 'force-dynamic'` e usam `createAdminClient()`.

> ⚠️ **Posicionamento obrigatório:** a diretiva `export const dynamic` deve estar **após o último `import`** no arquivo. O Next.js ignora silenciosamente a diretiva quando ela aparece no meio de um bloco `import {` (comportamento do prettier auto-formatter). Resultado: a página cai em SSG sem aviso e retorna 404 em produção.

**Isolamento de tenant (segurança):**

Ao usar `adminClient` (que bypassa RLS), o isolamento entre tenants passa a ser responsabilidade do código. As regras aplicadas são:

| Página / Action                | Papel            | Verificação                                                              |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------ |
| `/orders/[id]`                 | `CLINIC_ADMIN`   | `clinic_members` — pedido deve pertencer à clínica do usuário            |
| `/orders/[id]`                 | `PHARMACY_ADMIN` | `pharmacy_members` — pedido deve pertencer à farmácia do usuário         |
| `/doctors/[id]`                | `CLINIC_ADMIN`   | `doctor_clinic_links` — médico deve estar vinculado à clínica do usuário |
| `createOrder`                  | `CLINIC_ADMIN`   | `clinic_members` — `clinic_id` enviado deve pertencer ao usuário         |
| `removeOrderItem`              | `CLINIC_ADMIN`   | `clinic_members` — pedido deve pertencer à clínica do usuário            |
| `reviewDocument`               | `PHARMACY_ADMIN` | `pharmacy_members` — pedido deve pertencer à farmácia do usuário         |
| `/api/documents/[id]/download` | todos            | membership em clínica ou farmácia do pedido                              |

Regra geral: **nenhuma page da área privada deve usar `createClient()`, todas devem ter `force-dynamic`, e toda ação que recebe um ID externo deve verificar se o usuário tem acesso ao recurso antes de retornar ou modificar dados**.

**Documentos no pedido:**

No formulário de criação, cada arquivo anexado recebe um tipo escolhido pela clínica via seletor inline. Os tipos disponíveis (definidos em `components/orders/document-manager.tsx`) são:

| Tipo             | Label                   | Obrigatório                              |
| ---------------- | ----------------------- | ---------------------------------------- |
| `PRESCRIPTION`   | Receita médica          | Sim (exibido como pendente no checklist) |
| `IDENTITY`       | Documento de identidade | Não                                      |
| `MEDICAL_REPORT` | Relatório médico        | Não                                      |
| `AUTHORIZATION`  | Autorização especial    | Não                                      |
| `OTHER`          | Outro                   | Não                                      |

O tipo padrão ao anexar um arquivo é:

- `PRESCRIPTION` — se o carrinho contém algum produto com `requires_prescription = true`
- `OTHER` — caso contrário

Após a criação do pedido:

- **Sem documentos** → status inicial `AWAITING_DOCUMENTS`
- **Com pelo menos um documento** → status avança automaticamente para `READY_FOR_REVIEW` com entrada no histórico

Uploads adicionais após a criação são feitos via `DocumentManager` na página de detalhe (`/orders/[id]`), com seletor de tipo e checklist visual dos tipos obrigatórios.

**Fluxo de revisão de documentos pela farmácia:**

Quando o pedido chega em `READY_FOR_REVIEW`, a farmácia analisa cada documento na página de detalhe do pedido:

- **Download**: botão por documento gera URL assinada (válida 5 min) via `/api/documents/[id]/download`
- **Aprovar**: documento marcado como `APPROVED`
- **Rejeitar**: documento marcado como `REJECTED` com motivo obrigatório (exibido para a clínica)

Após cada ação, `evaluateOrderDocuments` reavalia o pedido inteiro:

| Resultado                    | Ação automática                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Todos os itens com docs OK   | Pedido avança para `AWAITING_PAYMENT` + notifica clínica                                     |
| Algum item com doc rejeitado | Pedido volta para `AWAITING_DOCUMENTS` + prazo de 3 dias úteis + notifica clínica com motivo |

**Reenvio pela clínica:**

- Pode reenviar documentos ilimitadas vezes até o prazo expirar
- Pode remover um item com `doc_status = REJECTED_DOCS` enquanto pedido está em `AWAITING_DOCUMENTS`
  - Se restar pelo menos 1 item → pedido vai para `READY_FOR_REVIEW` automaticamente
  - Se não restar nenhum item → pedido cancelado

**Expiração de prazo:**

- Cron diário (`/api/cron/expire-doc-deadlines`, 6h) cancela pedidos em `AWAITING_DOCUMENTS` com `docs_deadline` vencido
- Clínica é notificada e deve abrir novo pedido

**Campos adicionados pela migration 033:**

- `order_documents`: `status`, `rejection_reason`, `reviewed_by_user_id`, `reviewed_at`
- `order_items`: `doc_status` (`OK` / `PENDING_DOCS` / `REJECTED_DOCS`)
- `orders`: `docs_deadline`

---

**Compliance:**

O `canPlaceOrder` valida CNPJ da farmácia via API externa. CNPJs fictícios (dados seed) serão bloqueados. Para testes, execute no Supabase SQL Editor:

```sql
UPDATE public.pharmacies
SET cnpj_validated_at = now(), cnpj_situation = 'ATIVA'
WHERE id = 'b1000000-0000-0000-0000-000000000001';
```

---

## Para criar novos usuários

Use a página de gestão de usuários em `/users/new` (requer `SUPER_ADMIN` ou `PLATFORM_ADMIN`).

---

> ⚠️ Altere as senhas dos usuários de produção antes de compartilhar acesso com clientes reais.
