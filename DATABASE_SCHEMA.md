# Clinipharma — Schema do Banco de Dados

## Visão geral dos schemas

O banco é organizado em 5 schemas lógicos:

| Schema             | Tabelas                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `auth`             | Gerenciado pelo Supabase Auth                                                                    |
| `public.auth_ext`  | `profiles`, `user_roles`                                                                         |
| `public.orgs`      | `clinics`, `clinic_members`, `doctors`, `doctor_clinic_links`, `pharmacies`, `pharmacy_members`  |
| `public.catalog`   | `product_categories`, `products`, `product_images`, `product_price_history`, `pharmacy_products` |
| `public.orders`    | `orders`, `order_documents`, `order_status_history`, `order_operational_updates`                 |
| `public.financial` | `payments`, `commissions`, `transfers`                                                           |
| `public.system`    | `audit_logs`, `app_settings`                                                                     |
| `public.sales`     | `sales_consultants`, `consultant_commissions`, `consultant_transfers`                            |

> Na prática, todas as tabelas ficam no schema `public` do Supabase. Os agrupamentos acima são lógicos.

---

## Tabela: profiles

Extensão da tabela `auth.users` do Supabase.

```sql
id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
full_name   text NOT NULL
email       text NOT NULL
phone       text
avatar_url  text
is_active   boolean DEFAULT true
created_at  timestamptz DEFAULT now()
updated_at  timestamptz DEFAULT now()
```

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
notes              text
created_at         timestamptz DEFAULT now()
updated_at         timestamptz DEFAULT now()
```

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
active                 boolean DEFAULT true
featured               boolean DEFAULT false
created_at             timestamptz DEFAULT now()
updated_at             timestamptz DEFAULT now()
```

**Margem bruta por unidade** = `price_current − pharmacy_cost`

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

```sql
id                            uuid PRIMARY KEY DEFAULT gen_random_uuid()
code                          text NOT NULL UNIQUE
clinic_id                     uuid NOT NULL REFERENCES clinics(id)
doctor_id                     uuid NOT NULL REFERENCES doctors(id)
pharmacy_id                   uuid NOT NULL REFERENCES pharmacies(id)
product_id                    uuid NOT NULL REFERENCES products(id)
quantity                      int NOT NULL DEFAULT 1 CHECK (quantity > 0)
unit_price                    numeric(12,2) NOT NULL   -- congelado no INSERT
total_price                   numeric(12,2) NOT NULL   -- congelado no INSERT
pharmacy_cost_per_unit        numeric(12,2)            -- congelado no INSERT (products.pharmacy_cost)
platform_commission_per_unit  numeric(12,2)            -- congelado no INSERT (price_current − pharmacy_cost)
payment_status                text NOT NULL DEFAULT 'PENDING'
transfer_status               text NOT NULL DEFAULT 'NOT_READY'
order_status                  text NOT NULL DEFAULT 'DRAFT'
notes                         text
created_by_user_id            uuid NOT NULL REFERENCES profiles(id)
created_at                    timestamptz DEFAULT now()
updated_at                    timestamptz DEFAULT now()
```

> Todos os campos financeiros são populados pelo trigger `freeze_order_price` no `BEFORE INSERT`. Alterações posteriores no produto não afetam o pedido.

**Valores válidos de order_status:**
`DRAFT, AWAITING_DOCUMENTS, READY_FOR_REVIEW, AWAITING_PAYMENT, PAYMENT_UNDER_REVIEW, PAYMENT_CONFIRMED, COMMISSION_CALCULATED, TRANSFER_PENDING, TRANSFER_COMPLETED, RELEASED_FOR_EXECUTION, RECEIVED_BY_PHARMACY, IN_EXECUTION, READY, SHIPPED, DELIVERED, COMPLETED, CANCELED, WITH_ISSUE`

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
