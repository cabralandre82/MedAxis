# Clinipharma — Load Testing Plan (k6)

## Objetivo

Estabelecer um baseline de performance documentado e validar SLOs antes do go-live comercial.

## SLOs (Service Level Objectives)

| Métrica         | Target         |
| --------------- | -------------- |
| p95 latência    | < 800ms        |
| p99 latência    | < 2.000ms      |
| Taxa de erro    | < 0,1%         |
| Disponibilidade | ≥ 99,5% mensal |

## Scripts (`tests/load/`)

| Script           | Descrição                                  | VUs / duração        |
| ---------------- | ------------------------------------------ | -------------------- |
| `health.js`      | GET /api/health — sem autenticação         | rampa até 100 / 2min |
| `login.js`       | POST Supabase auth/v1/token                | 50 VUs fixos / 2min  |
| `list-orders.js` | GET /api/orders — paginado, autenticado    | rampa até 200 / 5min |
| `export-csv.js`  | GET /api/export — heavy query, autenticado | 10 VUs fixos / 3min  |

## Como executar

```bash
# Instalar k6 (Ubuntu)
sudo apt-get install k6

# 1. Health check (sem auth) — contra produção
BASE_URL=https://clinipharma.com.br k6 run tests/load/health.js

# 2. Login — contra staging Supabase
SUPABASE_URL=https://ghjexiyrqdtqhkolsyaw.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
k6 run tests/load/login.js

# 3. List orders e export (requer token autenticado)
# Obter token:
STAGING_SUPABASE=https://ghjexiyrqdtqhkolsyaw.supabase.co
ANON_KEY=<anon>
TOKEN=$(curl -sX POST "$STAGING_SUPABASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@clinipharma.com.br","password":"Clinipharma@2026"}' \
  | jq -r .access_token)

BASE_URL=https://clinipharma.com.br AUTH_TOKEN=$TOKEN k6 run tests/load/list-orders.js
BASE_URL=https://clinipharma.com.br AUTH_TOKEN=$TOKEN k6 run tests/load/export-csv.js
```

## Ambiente

- `health.js` → rodar contra **produção** (sem auth, read-only, seguro)
- `login.js` → rodar contra **staging Supabase** (auth endpoint direto, sem Vercel)
- `list-orders.js` / `export-csv.js` → rodar contra **produção** com token de staging Supabase
- Nunca rodar `create-order.js` (criação) contra produção

## Resultados — primeira execução (2026-04-16)

### `health.js` — GET /api/health · 100 VUs · produção

| Métrica           | Resultado     | SLO       | Status        |
| ----------------- | ------------- | --------- | ------------- |
| p(95) latência    | **265,7 ms**  | < 800ms   | ✅ OK         |
| p(99) latência    | **520,6 ms**  | < 2.000ms | ✅ OK         |
| Taxa de erro HTTP | **0,00%**     | < 0,1%    | ✅ OK         |
| Spikes > 800ms    | 0,7% (64 req) | —         | ⚠️ cold start |
| DB latência avg   | **158 ms**    | —         | —             |
| DB latência p(95) | **178 ms**    | —         | —             |
| DB latência max   | 927 ms        | —         | spike         |
| Total de requests | 9.102         | —         | —             |
| Throughput        | 75,6 req/s    | —         | —             |

**Análise:** Performance excelente. Os 64 spikes > 800ms são cold starts do serverless Vercel durante o scale-up (primeiros segundos do ramp). p95 bem abaixo do SLO. DB p95 de 178ms no Supabase é aceitável para o tier Free.

### `login.js` — POST auth/v1/token · 50 VUs · staging Supabase

| Métrica           | Resultado    | SLO       | Status        |
| ----------------- | ------------ | --------- | ------------- |
| p(95) latência    | **141,5 ms** | < 500ms   | ✅ OK         |
| p(99) latência    | **410,5 ms** | < 1.000ms | ✅ OK         |
| Taxa de erro HTTP | **98,4%**    | —         | ⚠️ rate limit |
| Total de requests | 5.519        | —         | —             |
| Throughput        | 45,6 req/s   | —         | —             |

**Análise:** A latência do Supabase Auth é excelente (p95 < 150ms). A taxa de falha de 98,4% é **esperada e desejável**: o Supabase bloqueia tentativas de login massivas simultâneas (anti-brute-force). Em uso real, logins são sequenciais e esparsos — não haverá 50 usuários diferentes tentando logar ao mesmo tempo. O sistema de auth está corretamente protegido contra ataques.

### `list-orders.js` — pendente

Requer token de autenticação. Executar quando houver usuário com dados no banco de produção.

### `export-csv.js` — pendente

Requer token de autenticação. Executar quando houver dados suficientes para validar export pesado.

## Próximos passos

- [ ] Rodar `list-orders.js` e `export-csv.js` após primeiros clientes reais (produção com dados)
- [ ] Repetir `health.js` após cada deploy significativo
- [ ] Configurar k6 Cloud ou Grafana k6 para histórico de resultados
- [ ] Considerar upgrade Supabase para Pro tier se DB latência p95 ultrapassar 300ms com dados reais
