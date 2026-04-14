# Clinipharma — Schema do Banco de Dados

## Visão geral dos schemas

O banco é organizado em 5 schemas lógicos:

| Schema             | Tabelas                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`             | Gerenciado pelo Supabase Auth                                                                                                                       |
| `public.auth_ext`  | `profiles`, `user_roles`                                                                                                                            |
| `public.orgs`      | `clinics`, `clinic_members`, `doctors`, `doctor_clinic_links`, `pharmacies`, `pharmacy_members`                                                     |
| `public.catalog`   | `product_categories`, `products`, `product_images`, `product_price_history`, `pharmacy_products`, `product_variants`                                |
| `public.orders`    | `orders`, `order_items`, `order_documents`, `order_status_history`, `order_operational_updates`, `order_templates`, `order_tracking_tokens`         |
| `public.financial` | `payments`, `commissions`, `transfers`                                                                                                              |
| `public.system`    | `audit_logs`, `app_settings`, `notifications`, `product_interests`, `registration_requests`, `registration_documents`, `sla_configs`, `access_logs` |
| `public.sales`     | `sales_consultants`, `consultant_commissions`, `consultant_transfers`                                                                               |
| `public.push`      | `fcm_tokens`                                                                                                                                        |
| `public.contracts` | `contracts`                                                                                                                                         |

> Na prática, todas as tabelas ficam no schema `public` do Supabase. Os agrupamentos acima são lógicos.

---

## Tabela: profiles

Extensão da tabela `auth.users` do Supabase.

```sql
id                        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
full_name                 text NOT NULL
email                     text NOT NULL
phone                     text
avatar_url                text
is_active                 boolean DEFAULT true
registration_status       text NOT NULL DEFAULT 'APPROVED'
                          CHECK (registration_status IN ('PENDING','PENDING_DOCS','APPROVED','REJECTED'))
notification_preferences  jsonb NOT NULL DEFAULT '{}'
created_at                timestamptz DEFAULT now()
updated_at                timestamptz DEFAULT now()
```

`registration_status` é `APPROVED` para todos os usuários criados pelo admin. Para usuários vindos do auto-cadastro público (`/registro`), começa como `PENDING` e evolui conforme o fluxo de aprovação.

`notification_preferences` armazena as preferências do usuário para tipos silenciáveis. Formato: `{"STALE_ORDER": false, "PRODUCT_INTEREST": false}`. Chave ausente = tipo habilitado. Tipos críticos (`ORDER_CREATED`, `ORDER_STATUS`, `PAYMENT_CONFIRMED`, `DOCUMENT_UPLOADED`) ignoram esta configuração e são sempre enviados. Migration: `012_notification_preferences.sql`.

## Tabela: user_roles

```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
role       text NOT NULL CHECK (role IN ('SUPER_ADMIN','PLATFORM_ADMIN','CLINIC_ADMIN','DOCTOR','PHARMACY_ADMIN','SALES_CONSULTANT'))
created_at timestamptz DEFAULT now()
UNIQUE(user_id, role)
```

## Tabela: clinics

```sql
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
corporate_name   text NOT NULL
trade_name       text NOT NULL
cnpj             text NOT NULL UNIQUE
state_registration text
email            text NOT NULL
phone            text
address_line_1   text NOT NULL
address_line_2   text
city             text NOT NULL
state            text NOT NULL
zip_code         text NOT NULL
status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED'))
notes            text
created_at       timestamptz DEFAULT now()
updated_at       timestamptz DEFAULT now()
```

## Tabela: clinic_members

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
clinic_id       uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
membership_role text NOT NULL DEFAULT 'STAFF' CHECK (membership_role IN ('ADMIN','STAFF'))
created_at      timestamptz DEFAULT now()
UNIQUE(clinic_id, user_id)
```

## Tabela: doctors

```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
full_name  text NOT NULL
crm        text NOT NULL
crm_state  text NOT NULL
specialty  text
email      text NOT NULL
phone      text
status     text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED'))
created_at timestamptz DEFAULT now()
updated_at timestamptz DEFAULT now()
UNIQUE(crm, crm_state)
```

## Tabela: doctor_clinic_links

```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
doctor_id  uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE
clinic_id  uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE
is_primary boolean DEFAULT false
created_at timestamptz DEFAULT now()
UNIQUE(doctor_id, clinic_id)
```

## Tabela: pharmacies

```sql
id                 uuid PRIMARY KEY DEFAULT gen_random_uuid()
corporate_name     text NOT NULL
trade_name         text NOT NULL
cnpj               text NOT NULL UNIQUE
email              text NOT NULL
phone              text
address_line_1     text NOT NULL
address_line_2     text
city               text NOT NULL
state              text NOT NULL
zip_code           text NOT NULL
responsible_person text NOT NULL
bank_name          text
bank_branch        text
bank_account       text
pix_key            text
status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','BLOCKED'))
entity_type        text NOT NULL DEFAULT 'PHARMACY' CHECK (entity_type IN ('PHARMACY','DISTRIBUTOR'))
notes              text
created_at         timestamptz DEFAULT now()
updated_at         timestamptz DEFAULT now()
```

`entity_type` discrimina farmácias de manipulação (`PHARMACY`) de distribuidoras de produtos industrializados (`DISTRIBUTOR`). Ambos os tipos compartilham a mesma tabela, o mesmo fluxo de pedidos/pagamentos/repasses e o mesmo role `PHARMACY_ADMIN`. A única diferença de negócio é que distribuidoras não podem ter produtos com `is_manipulated = true` (ver tabela `products`).

## Tabela: pharmacy_members

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
pharmacy_id     uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE
user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
membership_role text NOT NULL DEFAULT 'STAFF' CHECK (membership_role IN ('ADMIN','STAFF'))
created_at      timestamptz DEFAULT now()
UNIQUE(pharmacy_id, user_id)
```

## Tabela: product_categories

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
name        text NOT NULL
slug        text NOT NULL UNIQUE
description text
is_active   boolean DEFAULT true
sort_order  int DEFAULT 0
created_at  timestamptz DEFAULT now()
updated_at  timestamptz DEFAULT now()
```

## Tabela: products

```sql
id                     uuid PRIMARY KEY DEFAULT gen_random_uuid()
category_id            uuid NOT NULL REFERENCES product_categories(id)
pharmacy_id            uuid NOT NULL REFERENCES pharmacies(id)
sku                    text NOT NULL UNIQUE
name                   text NOT NULL
slug                   text NOT NULL UNIQUE
concentration          text NOT NULL
presentation           text NOT NULL
short_description      text NOT NULL
long_description       text
characteristics_json   jsonb DEFAULT '{}'
price_current          numeric(12,2) NOT NULL
pharmacy_cost          numeric(12,2) NOT NULL DEFAULT 0.00  -- repasse fixo à farmácia por unidade
currency               text NOT NULL DEFAULT 'BRL'
estimated_deadline_days int NOT NULL
active                 boolean DEFAULT true  -- derivado de status (status != 'inactive')
status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable','inactive'))
featured               boolean DEFAULT false
is_manipulated         boolean NOT NULL DEFAULT false
created_at             timestamptz DEFAULT now()
updated_at             timestamptz DEFAULT now()
```

`is_manipulated = true` indica produto magistral/composto (produzido sob demanda na farmácia). Distribuidoras (`pharmacies.entity_type = 'DISTRIBUTOR'`) não podem ter produtos com este flag — o serviço de criação de produtos força `is_manipulated = false` ao detectar uma distribuidora como proprietária.

**Status possíveis:**
| Valor | Descrição |
|---|---|
| `active` | Disponível no catálogo para pedido |
| `unavailable` | Aparece no catálogo com visual de indisponível + botão "Tenho interesse" |
| `inactive` | Oculto do catálogo |

**Margem bruta por unidade** = `price_current − pharmacy_cost`

## Tabela: registration_requests

Solicitações de cadastro enviadas por clínicas e médicos via auto-cadastro público.

```sql
id             uuid        PRIMARY KEY DEFAULT gen_random_uuid()
type           text        NOT NULL CHECK (type IN ('CLINIC', 'DOCTOR'))
status         text        NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','PENDING_DOCS','APPROVED','REJECTED'))
form_data      jsonb       NOT NULL DEFAULT '{}'  -- dados do formulário (varia por tipo)
user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL
entity_id      uuid        -- clinic_id ou doctor_id após aprovação
admin_notes    text        -- motivo de reprovação
requested_docs jsonb       -- [{type, label, custom_text}]
reviewed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL
reviewed_at    timestamptz
created_at     timestamptz NOT NULL DEFAULT now()
updated_at     timestamptz NOT NULL DEFAULT now()
```

**RLS:**

- Solicitante (owner) pode ver e atualizar sua própria solicitação
- `SUPER_ADMIN` e `PLATFORM_ADMIN` veem todas (SUPER_ADMIN pode atualizar)
- `service_role` acesso total

## Tabela: registration_documents

Documentos enviados junto à solicitação de cadastro (ou em resposta a pedido de documentos).

```sql
id            uuid        PRIMARY KEY DEFAULT gen_random_uuid()
request_id    uuid        NOT NULL REFERENCES registration_requests(id) ON DELETE CASCADE
document_type text        NOT NULL  -- 'CNPJ_CARD' | 'OPERATING_LICENSE' | 'RESPONSIBLE_ID' | 'CRM_CARD' | 'IDENTITY_DOC' | 'OTHER'
label         text        NOT NULL  -- label legível
filename      text        NOT NULL
storage_path  text        NOT NULL  -- bucket: registration-documents
public_url    text
uploaded_at   timestamptz NOT NULL DEFAULT now()
```

**RLS:**

- Owner (via request_id → user_id) pode inserir e ver seus próprios documentos
- `SUPER_ADMIN` e `PLATFORM_ADMIN` veem todos
- `service_role` acesso total

**Storage bucket:** `registration-documents` (privado)

## Tabela: product_interests

Registros de interesse de clínicas/médicos em produtos com `status = 'unavailable'`.

```sql
id          uuid        PRIMARY KEY DEFAULT gen_random_uuid()
product_id  uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE
user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
name        text        NOT NULL   -- nome fornecido pelo interessado
whatsapp    text        NOT NULL   -- WhatsApp fornecido pelo interessado
created_at  timestamptz NOT NULL DEFAULT now()
```

**RLS:**

- Usuário autenticado pode inserir e ver seus próprios interesses
- `SUPER_ADMIN` e `PLATFORM_ADMIN` veem todos
- `service_role` acesso total

## Tabela: product_images

```sql
id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
storage_path text NOT NULL
public_url   text
alt_text     text
sort_order   int DEFAULT 0
created_at   timestamptz DEFAULT now()
```

## Tabela: product_price_history

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_id          uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
old_price           numeric(10,2) NOT NULL
new_price           numeric(10,2) NOT NULL
changed_by_user_id  uuid NOT NULL REFERENCES profiles(id)
reason              text NOT NULL
created_at          timestamptz DEFAULT now()
```

## Tabela: pharmacy_products

```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
pharmacy_id       uuid NOT NULL REFERENCES pharmacies(id)
product_id        uuid NOT NULL REFERENCES products(id)
active            boolean DEFAULT true
operational_notes text
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()
UNIQUE(pharmacy_id, product_id)
```

## Tabela: orders

> Desde v0.6.0: `orders` é o **cabeçalho** do pedido. Os campos de produto/quantidade/preço por item migraram para `order_items`.

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
code                text NOT NULL UNIQUE             -- gerado por trigger: CP-YYYY-NNNNNN
clinic_id           uuid NOT NULL REFERENCES clinics(id)
doctor_id           uuid NOT NULL REFERENCES doctors(id)
pharmacy_id         uuid NOT NULL REFERENCES pharmacies(id)
total_price         numeric(12,2) NOT NULL DEFAULT 0 -- recalculado por trigger após insert/update em order_items
payment_status      text NOT NULL DEFAULT 'PENDING'
transfer_status     text NOT NULL DEFAULT 'NOT_READY'
order_status        text NOT NULL DEFAULT 'DRAFT'
notes               text
created_by_user_id  uuid NOT NULL REFERENCES profiles(id)
created_at          timestamptz DEFAULT now()
updated_at          timestamptz DEFAULT now()
```

**Valores válidos de order_status:**
`DRAFT, AWAITING_DOCUMENTS, READY_FOR_REVIEW, AWAITING_PAYMENT, PAYMENT_UNDER_REVIEW, PAYMENT_CONFIRMED, COMMISSION_CALCULATED, TRANSFER_PENDING, TRANSFER_COMPLETED, RELEASED_FOR_EXECUTION, RECEIVED_BY_PHARMACY, IN_EXECUTION, READY, SHIPPED, DELIVERED, COMPLETED, CANCELED, WITH_ISSUE`

## Tabela: order_items

> Criada na migration `008_order_items.sql`. Cada linha representa um produto de um pedido com valores congelados.

```sql
id                            uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id                      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE
product_id                    uuid NOT NULL REFERENCES products(id)
quantity                      int NOT NULL DEFAULT 1 CHECK (quantity > 0)
unit_price                    numeric(12,2) NOT NULL   -- congelado no INSERT por trigger
total_price                   numeric(12,2) NOT NULL   -- unit_price * quantity, congelado no INSERT
pharmacy_cost_per_unit        numeric(12,2)            -- products.pharmacy_cost no momento da criação
platform_commission_per_unit  numeric(12,2)            -- unit_price − pharmacy_cost no momento da criação
created_at                    timestamptz NOT NULL DEFAULT now()
```

> Triggers: `trg_order_items_freeze_price` (BEFORE INSERT) congela os valores; `trg_order_items_recalc_total` (AFTER INSERT/UPDATE/DELETE) recalcula `orders.total_price`.

## Tabela: order_documents

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE
document_type       text NOT NULL
storage_path        text NOT NULL
original_filename   text NOT NULL
mime_type           text NOT NULL
file_size           bigint NOT NULL
uploaded_by_user_id uuid NOT NULL REFERENCES profiles(id)
created_at          timestamptz DEFAULT now()
```

## Tabela: order_status_history

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE
old_status          text
new_status          text NOT NULL
changed_by_user_id  uuid NOT NULL REFERENCES profiles(id)
reason              text
created_at          timestamptz DEFAULT now()
```

## Tabela: order_operational_updates

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE
pharmacy_id         uuid NOT NULL REFERENCES pharmacies(id)
status              text NOT NULL
description         text NOT NULL
created_by_user_id  uuid NOT NULL REFERENCES profiles(id)
created_at          timestamptz DEFAULT now()
```

## Tabela: payments

```sql
id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id              uuid NOT NULL REFERENCES orders(id)
payer_profile_id      uuid REFERENCES profiles(id)
gross_amount          numeric(10,2) NOT NULL
status                text NOT NULL DEFAULT 'PENDING'
payment_method        text NOT NULL DEFAULT 'MANUAL'
reference_code        text
proof_storage_path    text
confirmed_by_user_id  uuid REFERENCES profiles(id)
confirmed_at          timestamptz
notes                 text
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()
```

## Tabela: commissions

```sql
id                       uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id                 uuid NOT NULL REFERENCES orders(id)
commission_type          text NOT NULL DEFAULT 'PERCENTAGE'
commission_percentage    numeric(5,2)
commission_fixed_amount  numeric(10,2)
commission_total_amount  numeric(10,2) NOT NULL
calculated_by_user_id    uuid REFERENCES profiles(id)
created_at               timestamptz DEFAULT now()
```

## Tabela: transfers

```sql
id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id              uuid NOT NULL REFERENCES orders(id)
pharmacy_id           uuid NOT NULL REFERENCES pharmacies(id)
gross_amount          numeric(10,2) NOT NULL
commission_amount     numeric(10,2) NOT NULL
net_amount            numeric(10,2) NOT NULL
status                text NOT NULL DEFAULT 'PENDING'
transfer_reference    text
proof_storage_path    text
processed_by_user_id  uuid REFERENCES profiles(id)
processed_at          timestamptz
notes                 text
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now()
```

## Tabela: audit_logs

```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
actor_user_id   uuid REFERENCES profiles(id)
actor_role      text
entity_type     text NOT NULL
entity_id       text NOT NULL
action          text NOT NULL
old_values_json jsonb
new_values_json jsonb
metadata_json   jsonb
ip              text
user_agent      text
created_at      timestamptz DEFAULT now()
```

## Tabela: sales_consultants

```sql
id           uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL  -- login do consultor
full_name    text NOT NULL
email        text NOT NULL UNIQUE
cnpj         text NOT NULL UNIQUE
phone        text
bank_name    text
bank_agency  text
bank_account text
pix_key      text
status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED'))
notes        text
created_at   timestamptz DEFAULT now()
updated_at   timestamptz DEFAULT now()
```

> `commission_rate` foi removido na migration 005. A taxa é agora global em `app_settings.consultant_commission_rate`.

## Tabela: clinics (campo adicionado)

```sql
consultant_id  uuid REFERENCES sales_consultants(id) ON DELETE SET NULL  -- migration 004
```

## Tabela: consultant_commissions

Comissão gerada automaticamente na confirmação de pagamento de cada pedido.

```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id          uuid NOT NULL REFERENCES orders(id)
consultant_id     uuid NOT NULL REFERENCES sales_consultants(id)
order_total       numeric(12,2) NOT NULL
commission_rate   numeric(5,2) NOT NULL   -- taxa vigente no momento da geração
commission_amount numeric(12,2) NOT NULL
status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','CANCELLED'))
transfer_id       uuid REFERENCES consultant_transfers(id) ON DELETE SET NULL
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()
```

## Tabela: consultant_transfers

Registro de repasse em batch para um consultor.

```sql
id                 uuid PRIMARY KEY DEFAULT gen_random_uuid()
consultant_id      uuid NOT NULL REFERENCES sales_consultants(id)
total_amount       numeric(12,2) NOT NULL
transfer_reference text NOT NULL
notes              text
processed_by_user_id uuid REFERENCES profiles(id)
processed_at       timestamptz DEFAULT now()
created_at         timestamptz DEFAULT now()
updated_at         timestamptz DEFAULT now()
```

## Tabela: app_settings

```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
key                 text NOT NULL UNIQUE
value_json          jsonb NOT NULL
description         text
updated_by_user_id  uuid REFERENCES profiles(id)
updated_at          timestamptz DEFAULT now()
```

**Chaves de configuração em produção:**

| key                          | tipo    | descrição                                                         |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `consultant_commission_rate` | numeric | Percentual global de comissão para todos os consultores (ex: `5`) |
| `platform_name`              | string  | Nome exibido na plataforma                                        |
| `platform_support_email`     | string  | Email de suporte exibido ao usuário                               |

---

## Tabela: notifications

> Criada na migration `009_notifications.sql`. Notificações in-app por usuário com suporte a realtime Supabase.

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
type        text NOT NULL   -- ORDER_CREATED, ORDER_STATUS, PAYMENT_CONFIRMED, TRANSFER_REGISTERED, CONSULTANT_TRANSFER, DOCUMENT_UPLOADED, GENERIC
title       text NOT NULL
body        text
link        text            -- URL relativa para navegação ao clicar
read_at     timestamptz     -- null = não lida
created_at  timestamptz NOT NULL DEFAULT now()
```

**RLS:** cada usuário acessa apenas suas próprias notificações. `service_role` tem acesso total para inserção nos server actions.

**Índices:**

- `idx_notifications_user` em `(user_id, created_at DESC)` — listagem do sino
- `idx_notifications_unread` em `(user_id) WHERE read_at IS NULL` — contagem de não lidas

---

## Tabela: product_variants

> Criada na migration `014`. Variações de um produto (concentração, apresentação, quantidade) com preço e custo independentes.

```sql
id                        uuid PRIMARY KEY DEFAULT gen_random_uuid()
product_id                uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE
name                      text NOT NULL                -- ex: "500mg / Comprimido / 30un"
attributes                jsonb NOT NULL DEFAULT '{}'  -- ex: {concentracao: "500mg", apresentacao: "Comprimido"}
price_current             numeric(12,2) NOT NULL
pharmacy_cost             numeric(12,2) NOT NULL DEFAULT 0
platform_commission_type  text NOT NULL DEFAULT 'PERCENTAGE' CHECK (IN 'PERCENTAGE','FIXED')
platform_commission_value numeric(12,2) NOT NULL DEFAULT 0
is_default                boolean NOT NULL DEFAULT false
is_active                 boolean NOT NULL DEFAULT true
created_at                timestamptz DEFAULT now()
updated_at                timestamptz DEFAULT now()
```

**Regra:** apenas uma variante por produto pode ter `is_default = true`. Ao definir uma nova padrão, as demais são automaticamente desmarcadas via API route.

**RLS:** leitura pública para variantes ativas; escrita apenas para SUPER_ADMIN e PLATFORM_ADMIN.

> Produtos existentes foram migrados automaticamente com uma variante "Padrão" usando os valores do produto original.

---

## Tabela: order_templates

> Criada na migration `014`. Templates de pedido reutilizáveis, com escopo por clínica.

```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE
name        text NOT NULL
items       jsonb NOT NULL DEFAULT '[]'
-- items: [{product_id, variant_id, quantity, pharmacy_id, unit_price, pharmacy_cost_per_unit, product_name}]
created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
created_at  timestamptz DEFAULT now()
updated_at  timestamptz DEFAULT now()
```

**RLS:** membros da clínica gerenciam templates da própria clínica; admins têm acesso total.

---

## Tabela: order_tracking_tokens

> Criada na migration `014`. Token único por pedido para rastreamento público sem autenticação.

```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE UNIQUE
token      text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex')
expires_at timestamptz    -- null = não expira; definido como 30 dias após entrega
created_at timestamptz DEFAULT now()
```

**RLS:** leitura pública (validação do token feita na API route); escrita somente via `service_role`.

**Endpoint público:** `GET /api/tracking?token=<token>` → retorna status, timeline (sem dados financeiros), ETA.  
**Página pública:** `/track/[token]` — acessível sem login.

---

## Tabela: sla_configs

> Criada na migration `014`. Configurações de SLA por status de pedido, com suporte a overrides por farmácia.

```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
pharmacy_id   uuid REFERENCES pharmacies(id) ON DELETE CASCADE  -- null = global
order_status  text NOT NULL
warning_days  int NOT NULL DEFAULT 2
alert_days    int NOT NULL DEFAULT 3
critical_days int NOT NULL DEFAULT 5
created_at    timestamptz DEFAULT now()
updated_at    timestamptz DEFAULT now()
UNIQUE(pharmacy_id, order_status)
```

**Lógica de resolução:** ao verificar SLA de um pedido de uma farmácia, o sistema busca o override específico da farmácia; se não existir, usa o global (`pharmacy_id IS NULL`).

**RLS:** somente SUPER_ADMIN pode gerenciar; leitura via `service_role`.

**Seed padrão:** 11 status configurados com `warning=2, alert=3, critical=5` (financeiro) e `warning=3, alert=5, critical=8` (operacional).

---

## Tabela: access_logs

> Criada na migration `014`. Histórico de acesso dos usuários com detecção de novos dispositivos.

```sql
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
event         text NOT NULL DEFAULT 'SESSION_START'
              CHECK (IN 'LOGIN','LOGOUT','SESSION_START','PASSWORD_RESET')
ip            text
user_agent    text
city          text
country       text DEFAULT 'BR'
is_new_device boolean NOT NULL DEFAULT false
created_at    timestamptz DEFAULT now()
```

**RLS:** cada usuário vê apenas seus próprios logs; SUPER_ADMIN e PLATFORM_ADMIN veem todos.

**Retenção:** 90 dias (aplicação não purga automaticamente no MVP — recomendado adicionar job de limpeza em produção).

**Alerta:** se `is_new_device = true`, uma notificação in-app é disparada automaticamente via `lib/session-logger.ts`.

**Índices:** `idx_access_logs_user_id`, `idx_access_logs_created_at`
