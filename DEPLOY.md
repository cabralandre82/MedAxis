# Clinipharma — Guia de Deploy

---

## Infraestrutura atual (produção)

| Componente | Serviço    | URL / Referência                                      |
| ---------- | ---------- | ----------------------------------------------------- |
| Frontend   | Vercel     | https://clinipharma-three.vercel.app                  |
| Banco      | Supabase   | https://app.supabase.com/project/jomdntqlgrupvhrqoyai |
| Repo       | GitHub     | https://github.com/cabralandre82/Clinipharma          |
| Região     | Vercel GRU | São Paulo (gru1)                                      |

---

## Variáveis de ambiente (Vercel)

Configure em **Vercel → Settings → Environment Variables**:

| Variável                        | Valor                                          |
| ------------------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://jomdntqlgrupvhrqoyai.supabase.co`     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (anon key do Supabase)                         |
| `SUPABASE_SERVICE_ROLE_KEY`     | (service role key — nunca exposta no frontend) |
| `NEXT_PUBLIC_APP_URL`           | `https://clinipharma-three.vercel.app`         |

---

## Configuração do Supabase Auth

1. Acesse **Authentication → URL Configuration**
2. **Site URL**: `https://clinipharma-three.vercel.app`
3. **Redirect URLs**: adicione os dois:
   - `https://clinipharma-three.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback` (desenvolvimento)

---

## Deploy do zero (novo ambiente)

### Pré-requisitos

- Node.js 20+
- Supabase CLI (`npm i -g supabase`)
- Conta na Vercel com repositório GitHub conectado

### 1. Aplicar migrations no banco

```bash
cd b2b-med-platform
supabase link --project-ref jomdntqlgrupvhrqoyai
supabase db push --password "SENHA_DO_BANCO"
```

As migrations estão em `supabase/migrations/`:

- `001_initial_schema.sql` — todas as tabelas
- `002_functions_triggers.sql` — funções, triggers, automações
- `003_rls_policies.sql` — Row Level Security por papel

### 2. Criar buckets de storage

Executar o script de setup (cria buckets e usuários iniciais):

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://jomdntqlgrupvhrqoyai.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sua-service-role-key"
npx tsx scripts/setup-production.ts
```

O script cria:

- Bucket `product-images` (público)
- Bucket `order-documents` (privado)
- Usuários seed com papéis e vínculos de organização

### 3. Executar seed de desenvolvimento (opcional)

```bash
supabase db push --include-seed --password "SENHA_DO_BANCO"
```

O seed está em `supabase/seed.sql` e inclui categorias, farmácias, clínicas, médicos e produtos.

### 4. Deploy na Vercel

**Opção A — Via GitHub (recomendado):**

1. Acesse https://vercel.com
2. Importe o repositório `cabralandre82/Clinipharma`
3. Configure as variáveis de ambiente (seção acima)
4. Clique em **Deploy**

Todo push na branch `main` dispara um novo deploy automaticamente.

**Opção B — Via CLI:**

```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## Re-deploy manual

Para forçar um novo deploy sem alterar código:

1. Acesse https://vercel.com/dashboard
2. Selecione o projeto Clinipharma
3. Vá em **Deployments**
4. Clique nos três pontos do último deploy → **Redeploy**

---

## Configuração pós-deploy

Após o primeiro deploy em produção:

1. Atualizar **Site URL** e **Redirect URLs** no Supabase Auth
2. Executar `scripts/setup-production.ts` para criar o primeiro super admin
3. Verificar se o `NEXT_PUBLIC_APP_URL` no Vercel aponta para a URL correta
4. Testar login com o super admin criado
5. Cadastrar farmácias, produtos e clínicas iniciais

---

## Rollback

Para reverter um deploy:

1. Acesse **Vercel → Deployments**
2. Localize a última versão estável
3. Clique nos três pontos → **Promote to Production**

Para reverter uma migration de banco, consulte `docs/rollback-plan.md`.
