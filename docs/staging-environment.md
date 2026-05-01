# Clinipharma — Staging Environment

## Objetivo

Ambiente isolado de staging para validar deploys antes de ir para produção, sem afetar dados reais.

## Política

- **Nunca testar fluxos destrutivos em produção** (ex: cancelamento de pedidos em massa, reset de dados)
- Todo deploy vai primeiro para staging → QA → produção
- Credenciais de staging são sempre de teste (Asaas Sandbox, Clicksign Sandbox, Zenvia Sandbox)

## Setup

### 1. Supabase — Projeto de Staging

1. Criar novo projeto Supabase: `clinipharma-staging`
2. Aplicar todas as migrations: `supabase db push --db-url <staging_db_url>`
3. Rodar seed de dados de teste: `npx tsx scripts/setup-production.ts`
4. Configurar variáveis de ambiente de staging (ver abaixo)

### 2. Vercel — Environment de Staging ✅ CONCLUÍDO (2026-04-17)

- Auto-deploy da branch `staging` já ativo — qualquer push dispara um deploy automaticamente
- Domínio `staging.clinipharma.com.br` vinculado à branch `staging` via API Vercel (`gitBranch: "staging"`, status: `verified`)
- Cada push para `staging` atualiza automaticamente `https://staging.clinipharma.com.br`

### 3. Branch Strategy

```
main ──────────────────────────────── production (clinipharma.com.br)
  └── staging ─────────────────────── staging (staging.clinipharma.com.br)
        └── feature/* ─────────────── preview deployments
```

### 4. Variáveis de Ambiente de Staging

| Variável                        | Valor de Staging                       |
| ------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL do projeto staging                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do projeto staging          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Chave service role do projeto staging  |
| `ASAAS_API_KEY`                 | Chave de **Sandbox** Asaas             |
| `ASAAS_API_URL`                 | `https://sandbox.asaas.com/api/v3`     |
| `CLICKSIGN_ACCESS_TOKEN`        | Token de **Sandbox** Clicksign         |
| `CLICKSIGN_API_URL`             | `https://sandbox.clicksign.com/api/v1` |
| `ZENVIA_API_TOKEN`              | Token **Sandbox** Zenvia               |
| `ZENVIA_SMS_FROM`               | Keyword sandbox Zenvia                 |
| `ZENVIA_WHATSAPP_FROM`          | Keyword sandbox Zenvia                 |
| `NEXT_PUBLIC_APP_URL`           | `https://staging.clinipharma.com.br`   |

### 5. Dados de Teste (Seed)

```bash
# Rodar após configurar banco de staging
SUPABASE_URL=<staging_url> \
SUPABASE_SERVICE_ROLE_KEY=<staging_key> \
npx tsx scripts/setup-production.ts
```

O seed cria:

- 1 usuário Super Admin (`staging@clinipharma.com.br`)
- 1 farmácia de teste
- 10 produtos de teste
- 1 clínica de teste
- 1 médico de teste

## Checklist de Provisionamento (a fazer)

> **Prioridade:** Fazer antes do primeiro go-live comercial com clientes reais.

### Passo a Passo

```bash
# 1. Criar projeto Supabase staging em https://supabase.com/dashboard
#    Nome sugerido: clinipharma-staging
#    Região: sa-east-1 (São Paulo) — mesma da produção

# 2. Copiar credenciais do projeto staging para um arquivo temporário
STAGING_DB_URL="postgresql://postgres:<senha>@db.<ref-staging>.supabase.co:5432/postgres"
STAGING_SUPABASE_URL="https://<ref-staging>.supabase.co"
STAGING_ANON_KEY="eyJ..."
STAGING_SERVICE_KEY="eyJ..."

# 3. Aplicar migrations em staging
cd /home/usuario/b2b-med-platform
npx supabase db push --db-url "$STAGING_DB_URL"

# 4. Rodar seed de dados de teste
SUPABASE_URL="$STAGING_SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$STAGING_SERVICE_KEY" \
npx tsx scripts/setup-production.ts

# 5. Criar branch staging no repositório
git checkout -b staging main
git push origin staging

# 6. No Vercel: Settings → Git → configurar branch "staging" → Environment "Preview"
#    Adicionar variáveis de ambiente de staging no scope Preview
```

### Variáveis de Ambiente a Adicionar no Vercel (scope: Preview, branch: staging)

| Variável                        | Observação                                                 |
| ------------------------------- | ---------------------------------------------------------- |
| `SUPABASE_URL`                  | URL do projeto **staging**                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL do projeto **staging**                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Chave do projeto **staging**                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do projeto **staging**                          |
| `ASAAS_API_KEY`                 | Chave **Sandbox** Asaas                                    |
| `ASAAS_BASE_URL`                | `https://sandbox.asaas.com/api/v3`                         |
| `CLICKSIGN_ACCESS_TOKEN`        | Token **Sandbox** Clicksign                                |
| `CLICKSIGN_API_URL`             | `https://sandbox.clicksign.com/api/v1`                     |
| `ZENVIA_API_TOKEN`              | Token **Sandbox** Zenvia                                   |
| `ZENVIA_SMS_FROM`               | Keyword sandbox Zenvia                                     |
| `ZENVIA_WHATSAPP_FROM`          | Keyword sandbox Zenvia                                     |
| `NEXT_PUBLIC_APP_URL`           | `https://staging.clinipharma.com.br` ou URL preview Vercel |

> As demais variáveis (Sentry, Resend, Inngest, Firebase) podem ser reutilizadas do ambiente de produção/preview atual.

## Credenciais de Staging

| Campo                       | Valor                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase projeto**        | `clinipharma-staging`                                                                                                                                                                                                         |
| **Região**                  | South America (São Paulo) — `sa-east-1`                                                                                                                                                                                       |
| **Database password**       | `dtLOMU2rOWVkcvq9`                                                                                                                                                                                                            |
| **Project URL**             | `https://ghjexiyrqdtqhkolsyaw.supabase.co`                                                                                                                                                                                    |
| **Anon key**                | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoamV4aXlycWR0cWhrb2xzeWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzU2ODEsImV4cCI6MjA5MTk1MTY4MX0.MmxwF0GwZw-K3Dq72d4TT37J39fBk8ePQt-YBLYfxA8`            |
| **Service role key**        | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoamV4aXlycWR0cWhrb2xzeWF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM3NTY4MSwiZXhwIjoyMDkxOTUxNjgxfQ.uW9AUe7yIqI6nbVvkd2Ytyl95FHzQx950sqBW75eyY4` |
| **Connection string (URI)** | `postgresql://postgres:dtLOMU2rOWVkcvq9@db.ghjexiyrqdtqhkolsyaw.supabase.co:5432/postgres`                                                                                                                                    |

## Status

- [x] Projeto Supabase `clinipharma-staging` criado ✅ (2026-04-16) — `ghjexiyrqdtqhkolsyaw`
- [x] Migrations `001–042` aplicadas em staging ✅ (2026-04-16)
- [x] Migrations `043–081` aplicadas em staging ✅ (2026-05-01) — schema agora 100% sincronizado com produção (81 migrations, 75 tabelas em `public`)
- [x] Seed de dados de teste executado ✅ (2026-04-16) — 5 usuários criados (senha: `Clinipharma@2026`)
- [x] Branch `staging` criada no repositório ✅ (2026-04-16)
- [x] Variáveis de ambiente de staging adicionadas no Vercel (scope Preview, branch: staging) ✅ (2026-04-16)
- [x] Deploy automático branch `staging` configurado no Vercel ✅ (2026-04-17)
- [x] Domínio `staging.clinipharma.com.br` configurado ✅ (2026-04-17)

### Notas de aplicação 2026-05-01

- O pooler Supabase (`aws-1-sa-east-1.pooler.supabase.com`) suporta tanto modo
  transaction (`6543`) quanto session (`5432`). Para `supabase db push`, ambos
  retornam `cannot insert multiple commands into a prepared statement (42601)`
  porque a CLI usa prepared statements e o pgbouncer rejeita statements
  multi-query (mesmo em session mode).
- **Workaround documentado**: aplicar cada migration individualmente via
  `psql -f` direto (sem prepared statements), depois marcar manualmente em
  `supabase_migrations.schema_migrations`. O bloco abaixo automatiza:

  ```bash
  DB_URL="postgres://postgres.ghjexiyrqdtqhkolsyaw:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
  for VER in $(seq -f "%03g" <inicio> <fim>); do
    FILE=$(ls supabase/migrations/${VER}_*.sql 2>/dev/null | head -1) || continue
    NAME=$(basename "$FILE" .sql)
    PGPASSWORD='<senha>' psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$FILE" \
      && PGPASSWORD='<senha>' psql "$DB_URL" -At -c \
         "INSERT INTO supabase_migrations.schema_migrations(version, name) \
          VALUES ('$VER', '$NAME') ON CONFLICT DO NOTHING;"
  done
  ```

## Política de Promção

```
feature branch → PR → code review → merge em staging → QA em staging → merge em main → produção
```

_Nenhuma mudança vai direto para main sem passar por staging._
