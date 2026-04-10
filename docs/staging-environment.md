# Clinipharma — Staging Environment

## Objetivo

Ambiente isolado de staging para validar deploys antes de ir para produção, sem afetar dados reais.

## Política

- **Nunca testar fluxos destrutivos em produção** (ex: cancelamento de pedidos em massa, reset de dados)
- Todo deploy vai primeiro para staging → QA → produção
- Credenciais de staging são sempre de teste (Asaas Sandbox, Clicksign Sandbox, Twilio Test)

## Setup (a fazer)

### 1. Supabase — Projeto de Staging

1. Criar novo projeto Supabase: `clinipharma-staging`
2. Aplicar todas as migrations: `supabase db push --db-url <staging_db_url>`
3. Rodar seed de dados de teste: `npx tsx scripts/setup-production.ts`
4. Configurar variáveis de ambiente de staging (ver abaixo)

### 2. Vercel — Environment de Staging

1. No painel Vercel → Settings → Environment Variables
2. Adicionar variáveis com escopo **Preview** (não Production)
3. Ou criar projeto Vercel separado `clinipharma-staging`
4. Configurar deploy automático do branch `staging` → staging environment

### 3. Branch Strategy

```
main ──────────────────────────────── production (clinipharma.com.br)
  └── staging ─────────────────────── staging (staging.clinipharma.com.br)
        └── feature/* ─────────────── preview deployments
```

### 4. Variáveis de Ambiente de Staging

| Variável                    | Valor de Staging                     |
| --------------------------- | ------------------------------------ |
| `SUPABASE_URL`              | URL do projeto staging               |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave do projeto staging             |
| `ASAAS_API_KEY`             | Chave de **Sandbox** Asaas           |
| `ASAAS_BASE_URL`            | `https://sandbox.asaas.com/api/v3`   |
| `CLICKSIGN_TOKEN`           | Token de **Sandbox** Clicksign       |
| `CLICKSIGN_BASE_URL`        | `https://sandbox.clicksign.com`      |
| `NEXT_PUBLIC_APP_URL`       | `https://staging.clinipharma.com.br` |

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

## Status

- [ ] Projeto Supabase staging criado
- [ ] Migrations aplicadas em staging
- [ ] Seed de dados executado
- [ ] Projeto/environment Vercel staging configurado
- [ ] Branch `staging` criada e deploy automático ativo
- [ ] Domínio `staging.clinipharma.com.br` configurado

## Política de Promção

```
feature branch → PR → code review → merge em staging → QA em staging → merge em main → produção
```

_Nenhuma mudança vai direto para main sem passar por staging._
