# Setup do Supabase

> **Projeto:** `jomdntqlgrupvhrqoyai`
> **Dashboard:** https://app.supabase.com/project/jomdntqlgrupvhrqoyai

---

## Status atual (produção)

| Etapa                                          | Status                               |
| ---------------------------------------------- | ------------------------------------ |
| Migrations 001–033 aplicadas                   | ✅ Concluído                         |
| Migration 034 — Realtime orders                | ✅ Concluído (manual via SQL Editor) |
| Migration 035 — Realtime notifications         | ✅ Concluído (manual via SQL Editor) |
| Migration 036 — needs_price_review             | ✅ Concluído (manual via SQL Editor) |
| Migration 037 — CANCELED em payments/transfers | ✅ Concluído (manual via SQL Editor) |
| Buckets de storage criados                     | ✅ Concluído                         |
| Seed de categorias/produtos                    | ✅ Concluído                         |
| Usuários iniciais criados                      | ✅ Concluído                         |
| Auth URLs configuradas                         | ✅ Concluído                         |

### Migrations que exigem execução manual via SQL Editor

As migrations abaixo envolvem `ALTER PUBLICATION supabase_realtime` e alterações de schema que devem ser rodadas diretamente no [SQL Editor](https://app.supabase.com/project/jomdntqlgrupvhrqoyai/sql) do painel Supabase (o Supabase CLI não consegue aplicar publicações Realtime remotamente sem acesso direto ao banco):

**034 — Realtime para pedidos** (`supabase/migrations/034_realtime_orders.sql`)

```sql
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE public.order_operational_updates REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'order_status_history') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'order_operational_updates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_operational_updates;
  END IF;
END $$;
```

**035 — Realtime para notificações** (`supabase/migrations/035_realtime_notifications.sql`)

```sql
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
```

**036 — Flag de revisão de preço** (`supabase/migrations/036_product_needs_price_review.sql`)

```sql
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS needs_price_review boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_products_needs_price_review
  ON public.products (needs_price_review)
  WHERE needs_price_review = true;
```

**037 — Status CANCELED em payments e transfers** (`supabase/migrations/037_payment_transfer_canceled_status.sql`)

```sql
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
    CHECK (status IN ('PENDING','UNDER_REVIEW','CONFIRMED','FAILED','REFUNDED','CANCELED'));

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_status_check;
ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_status_check
    CHECK (status IN ('NOT_READY','PENDING','COMPLETED','FAILED','CANCELED'));
```

---

## 1. Aplicar as migrations

Usar o Supabase CLI (método recomendado):

```bash
supabase link --project-ref jomdntqlgrupvhrqoyai
supabase db push --password "SENHA_DO_BANCO"
```

As migrations são aplicadas na ordem:

1. `supabase/migrations/001_initial_schema.sql` — 24 tabelas
2. `supabase/migrations/002_functions_triggers.sql` — triggers e automações
3. `supabase/migrations/003_rls_policies.sql` — Row Level Security

Se preferir via SQL Editor no painel, execute os arquivos nessa mesma ordem.

---

## 2. Criar buckets de storage

Use o script de setup (recomendado):

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://jomdntqlgrupvhrqoyai.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sua-service-role-key"
npx tsx scripts/setup-production.ts
```

Ou crie manualmente no painel em **Storage**:

| Bucket            | Visibilidade | Uso                             |
| ----------------- | ------------ | ------------------------------- |
| `product-images`  | Público      | Imagens de produtos             |
| `order-documents` | Privado      | Receitas e documentos de pedido |

---

## 3. Seed de desenvolvimento

Para popular o banco com dados de teste:

```bash
supabase db push --include-seed --password "SENHA_DO_BANCO"
```

O `supabase/seed.sql` cria:

- 5 categorias de produtos
- 2 farmácias
- 2 clínicas
- 2 médicos
- 5 produtos (com preços reais)

Para os usuários de teste (com papéis e vínculos), execute adicionalmente:

```bash
npx tsx scripts/setup-production.ts
```

---

## 4. Configurar URLs de autenticação

Acesse **Authentication → URL Configuration**:

| Campo         | Desenvolvimento                       | Produção                                             |
| ------------- | ------------------------------------- | ---------------------------------------------------- |
| Site URL      | `http://localhost:3000`               | `https://clinipharma-three.vercel.app`               |
| Redirect URLs | `http://localhost:3000/auth/callback` | `https://clinipharma-three.vercel.app/auth/callback` |

---

## 5. Configurar autenticação por email

Por padrão, o Supabase exige confirmação de email. Para o MVP, os usuários são criados via Admin API com `email_confirm: true`, portanto nenhum email de confirmação é enviado ao criar usuários pelo script de setup.

Para recuperação de senha funcionar em produção, configure um servidor SMTP em **Settings → Auth → SMTP Settings**.

---

## 6. Google OAuth (inativo no MVP)

O provider Google está preparado mas desativado. Para ativar:

1. Vá em **Authentication → Providers → Google**
2. Habilite e insira `Client ID` e `Client Secret` do Google Cloud Console
3. Configure o callback URL: `https://jomdntqlgrupvhrqoyai.supabase.co/auth/v1/callback`
4. Remova o atributo `disabled` do botão "Entrar com Google" em `app/(auth)/login/login-form.tsx`

---

## 7. Row Level Security

Todas as tabelas têm RLS habilitada via `003_rls_policies.sql`. As políticas garantem:

- Usuários só acessam dados da própria organização (clínica ou farmácia)
- Admins de plataforma veem todos os dados
- Service Role Key bypassa RLS (uso exclusivo em Server Actions e scripts)

---

## 8. Verificar a configuração

Após o setup, acesse a plataforma e faça login:

```
URL:   https://clinipharma-three.vercel.app
Email: superadmin@clinipharma.com.br
Senha: Clinipharma@2026!
```

Confirme que o dashboard carrega e que o catálogo exibe os produtos seed.
