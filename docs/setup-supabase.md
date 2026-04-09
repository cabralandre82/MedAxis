# Setup do Supabase

> **Projeto:** `jomdntqlgrupvhrqoyai`
> **Dashboard:** https://app.supabase.com/project/jomdntqlgrupvhrqoyai

---

## Status atual (produção)

| Etapa                       | Status       |
| --------------------------- | ------------ |
| Migrations aplicadas        | ✅ Concluído |
| Buckets de storage criados  | ✅ Concluído |
| Seed de categorias/produtos | ✅ Concluído |
| Usuários iniciais criados   | ✅ Concluído |
| Auth URLs configuradas      | ✅ Concluído |

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

| Campo         | Desenvolvimento                       | Produção                                          |
| ------------- | ------------------------------------- | ------------------------------------------------- |
| Site URL      | `http://localhost:3000`               | `https://med-axis-three.vercel.app`               |
| Redirect URLs | `http://localhost:3000/auth/callback` | `https://med-axis-three.vercel.app/auth/callback` |

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
URL:   https://med-axis-three.vercel.app
Email: superadmin@medaxis.com.br
Senha: MedAxis@2026!
```

Confirme que o dashboard carrega e que o catálogo exibe os produtos seed.
