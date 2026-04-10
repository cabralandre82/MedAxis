# Plano de Escala: 1000+ Clínicas

> Documento técnico — Auditoria Pré-Release Clinipharma.  
> Atualizado em Abril 2026 com plano revisado por impacto/esforço real.

---

## Status de execução

| Semana       | Status       | Itens                                                                                                                                                                 |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semana 1** | ✅ Concluída | Fix N+1 notificações, singleton admin, cache dashboard, cursor pagination (orders), streaming export                                                                  |
| **Semana 2** | ✅ Concluída | pg_stat_statements (migration 017), 11 índices por análise de código, cursor pagination (payments/audit/transfers), StaleOrdersWidget com filtro DB + cache 10min     |
| **Mês 2**    | ✅ Concluído | /api/health, error boundaries, loading skeletons, rate-limit Redis-ready, Sentry ativo (DSN + Upstash configurados no Vercel), cursor pagination consultant-transfers |
| **Mês 3**    | ⏳ Pendente  | Particionamento tabelas, Inngest, read replica                                                                                                                        |

---

## Por que o plano original estava errado

O primeiro plano (`docs/scale-1000-clinics.md` v1) listava itens por categoria — não por ROI. Erros críticos:

1. **Propunha Redis antes de resolver N+1 queries** — cache sobre código lento ainda é código lento.
2. **Propunha 14 novos índices sem medir primeiro** — índices desnecessários custam em escrita.
3. **Não mencionava cursor pagination** — offset a `OFFSET 50000` é pior que falta de índice.
4. **Não mencionava singleton do admin client** — cada request criava nova instância Supabase.

---

## Semana 1 — Zero custo, só código (✅ Implementado)

### 1. Fix N+1 em `createNotificationForRole`

**Problema:** Para cada usuário com aquele papel, chamava `isTypeEnabled()` que fazia 1 query separada. Com 10 admins, eram 10 queries. Com 100 usuários num papel, 100 queries.

**Solução implementada:** Uma única query batch em `profiles` via `.in('id', userIds)`, depois filtrar em memória.

```typescript
// Antes: O(n) queries
for (const r of roles) {
  const enabled = await isTypeEnabled(r.user_id, input.type) // 1 query cada
  if (enabled) eligibleUserIds.push(r.user_id)
}

// Depois: O(1) queries
const { data: profiles } = await admin
  .from('profiles')
  .select('id, notification_preferences')
  .in(
    'id',
    roles.map((r) => r.user_id)
  )

const eligibleUserIds = roles
  .filter((r) => isPreferenceEnabled(profileMap[r.user_id], input.type))
  .map((r) => r.user_id)
```

---

### 2. Singleton do Admin Client

**Problema:** `createAdminClient()` instanciava um novo `SupabaseClient` a cada invocação de server action ou route handler. Em serverless quente, cada chamada reiniicializava conexão, headers, interceptors.

**Solução implementada:** Singleton por processo (reutilizado entre invocações quentes).

```typescript
let _adminInstance: ReturnType<typeof createSupabaseClient> | null = null

export function createAdminClient() {
  if (!_adminInstance) {
    _adminInstance = createSupabaseClient(url, key, opts)
  }
  return _adminInstance
}
```

---

### 3. Cache do Dashboard Admin com `unstable_cache`

**Problema:** `getDashboardData()` fazia 6 queries paralelas ao DB a cada carregamento de página — incluindo `SELECT id FROM orders LIMIT 1000` que com 50k pedidos ainda traz 1000 registros.

**Solução implementada:** `unstable_cache` do Next.js 15 com TTL de 5 minutos e revalidação por tag.

```typescript
export const getDashboardData = unstable_cache(
  async () => {
    /* 6 queries paralelas */
  },
  ['admin-dashboard'],
  { revalidate: 300, tags: ['dashboard'] }
)
```

**Custo:** Zero. Integrado ao Next.js, sem serviço externo.

**Quando revalidar:** Em `createOrder`, `confirmPayment`, `completeTransfer` chamar `revalidateTag('dashboard')`.

---

### 4. Cursor-Based Pagination na listagem de Pedidos

**Problema:** 13 páginas usavam `OFFSET/LIMIT`. Com 50.000 pedidos, `OFFSET 49800 LIMIT 20` força o Postgres a percorrer 49.800 linhas para descartar.

```sql
-- Ruim (offset): O(n) → varre 49800 linhas
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 49800;

-- Bom (cursor): O(log n) → usa o índice diretamente
SELECT * FROM orders
WHERE created_at < '2024-03-15T10:30:00Z'
ORDER BY created_at DESC LIMIT 20;
```

**Solução implementada:** Cursor via `created_at` na listagem de pedidos (a mais crítica). As outras 12 páginas mantêm offset por enquanto — crescem mais devagar.

**Critério para migrar as outras páginas:** Quando a tabela ultrapassar 10.000 registros.

---

### 5. Streaming Export CSV

**Problema:** O endpoint `/api/export` carregava TODOS os registros em memória (até `LIMIT 10000`) antes de montar o CSV. Com 50k pedidos, alocava >100MB de RAM por request.

**Solução implementada:** Paginação interna em batches de 1000 registros com `ReadableStream`. O CSV começa a ser enviado ao cliente antes de todos os dados serem buscados.

```typescript
// Dados chegam ao browser enquanto ainda estão sendo buscados do DB
const stream = new ReadableStream({
  async start(controller) {
    let cursor: string | null = null
    let isFirst = true
    do {
      const batch = await fetchBatch(cursor)
      if (isFirst) {
        controller.enqueue(header)
        isFirst = false
      }
      controller.enqueue(toCSVRows(batch.rows))
      cursor = batch.nextCursor
    } while (cursor)
    controller.close()
  },
})
```

**Nota:** XLSX permanece buffered (ExcelJS exige buffer completo para escrever o arquivo). Para exports XLSX grandes, a solução é gerar assincronamente e enviar link de download.

---

## Semana 2 — Índices por análise de código + cursor nas páginas de crescimento rápido (✅ Implementado)

```sql
-- Habilitar no Supabase Dashboard → SQL Editor
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top 20 queries mais lentas (rodar após 1 semana de produção)
SELECT
  substring(query, 1, 100) AS query_preview,
  round(mean_exec_time::numeric, 2) AS avg_ms,
  calls,
  round(total_exec_time::numeric, 2) AS total_ms
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Ação:** Adicionar índices APENAS para queries que aparecerem nessa lista com `avg_ms > 50`.

---

## Mês 2 — Ativação de serviços externos (✅ Código pronto — só faltam credenciais)

> O código já está implementado e funcionando. Abaixo o que você precisa fazer para ativar cada serviço.

### Sentry — Error Tracking ✅ Ativo

**Custo:** Free tier (5k erros/mês gratuitos)

**Status: ✅ 100% configurado no Vercel**

| Variável                 | Valor                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://c63e33b1b94125b1be02f61a38b6cb6f@o4510907598700544.ingest.us.sentry.io/4511197915381760` |
| `SENTRY_ORG`             | `cabralandre82s-org`                                                                              |
| `SENTRY_PROJECT`         | `clinipharma`                                                                                     |
| `SENTRY_AUTH_TOKEN`      | configurado como `sensitive` (production + preview)                                               |

Source maps ativos — erros no Sentry apontam para o código TypeScript original.

---

### Upstash Redis — Rate Limit Distribuído ✅ Ativo

**Custo:** Free tier (10k requests/dia gratuitos). Pago a partir de ~$10/mês em uso real.

**Status:** `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` configuradas no Vercel.  
Rate limit distribuído ativo desde o próximo deploy.

**Para referência futura (credenciais já configuradas):**

```
UPSTASH_REDIS_REST_URL   = https://subtle-mackerel-96084.upstash.io
UPSTASH_REDIS_REST_TOKEN = [configurado — ver Vercel env vars]
```

3. Adicionar no Vercel (para futuras instâncias/projetos):

```
UPSTASH_REDIS_REST_URL   = https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN = AXxx...
```

**O que acontece automaticamente após o próximo deploy:**

- `lib/rate-limit.ts` detecta as variáveis e usa Redis automaticamente
- Rate limiting passa a ser compartilhado entre todas as instâncias do Vercel (multi-instance safe)
- Sem nenhuma alteração de código

> **Nota:** Hoje o rate limiter in-memory já protege contra abuso. O Redis só se torna necessário quando o Vercel escalar para múltiplas instâncias simultâneas (geralmente com >50 clínicas ativas).

---

### Monitoramento de Uptime — `/api/health`

**Custo:** Gratuito (UptimeRobot free tier, Better Uptime free tier)

**O que você faz:**

1. [uptimerobot.com](https://uptimerobot.com) ou [betteruptime.com](https://betteruptime.com) → Add Monitor
2. URL: `https://clinipharma.com.br/api/health`
3. Intervalo: 5 minutos
4. Alerta: email + WhatsApp quando status 503

---

## Mês 3+ — Infraestrutura baseada em volume real (~R$500-2000/mês)

> Não implementar antes dos triggers abaixo. Custo real, ROI real.

| Item                             | Trigger de ativação                                                       | Como implementar                                                                           | Custo estimado           |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ |
| **Particionamento `orders`**     | Tabela `orders` > 100k registros                                          | Migration SQL com `PARTITION BY RANGE (created_at)` + cron mensal para criar partição nova | Incluído no Supabase Pro |
| **Particionamento `audit_logs`** | Tabela `audit_logs` > 500k registros                                      | Mesmo padrão de particionamento por mês                                                    | Incluído no Supabase Pro |
| **Inngest / BullMQ**             | Cron `/api/cron/stale-orders` timeout em produção, ou jobs de email > 10s | Mover para Inngest (serverless queue)                                                      | ~$25/mês                 |
| **Read replica**                 | Dashboard admin carregando > 2s mesmo com `unstable_cache`                | Supabase Pro → Read Replicas → apontar queries de leitura para replica                     | +$25/mês no Supabase Pro |
| **Vercel KV**                    | Cache `unstable_cache` inconsistente entre pods (raro)                    | Substituir por `@vercel/kv` + `revalidateTag`                                              | ~$20/mês                 |
| **Multi-região**                 | SLA contratual exigindo <99.9% downtime OU clínicas fora do Brasil        | Supabase Enterprise + Vercel Enterprise                                                    | >$500/mês                |

### Como verificar os triggers

```sql
-- Verificar tamanho das tabelas (rodar no Supabase SQL Editor)
SELECT
  relname AS tabela,
  n_live_tup AS registros_vivos,
  pg_size_pretty(pg_total_relation_size(relid)) AS tamanho_total
FROM pg_stat_user_tables
WHERE relname IN ('orders', 'audit_logs', 'payments', 'transfers', 'notifications')
ORDER BY n_live_tup DESC;

-- Verificar queries lentas (após pg_stat_statements ativo)
SELECT
  substring(query, 1, 100) AS query,
  round(mean_exec_time::numeric, 2) AS avg_ms,
  calls
FROM pg_stat_statements
WHERE calls > 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Roteiro de particionamento `orders` (quando trigger atingido)

```sql
-- 1. Renomear tabela atual
ALTER TABLE orders RENAME TO orders_legacy;

-- 2. Criar tabela particionada
CREATE TABLE orders (
  LIKE orders_legacy INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 3. Criar partições por mês
CREATE TABLE orders_2026_04 PARTITION OF orders
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- 4. Migrar dados existentes
INSERT INTO orders SELECT * FROM orders_legacy;

-- 5. Cron mensal para criar partição seguinte (adicionar em /api/cron/)
-- CREATE TABLE orders_{ano}_{mes} PARTITION OF orders
--   FOR VALUES FROM ('{ano}-{mes}-01') TO ('{proximo_mes}');
```

---

## O que 95% de cobertura de testes requer (ainda pendente)

Os testes unitários atuais cobrem **75.86% statements / 81.55% functions**.  
O que falta são os **success paths** de server actions com múltiplas chamadas DB encadeadas.

### Para chegar a 95%:

**1. Projeto Supabase de testes dedicado**

```bash
# Criar projeto no dashboard Supabase: "clinipharma-test"
# Aplicar migrations
supabase db push --project-ref <test-project-ref>

# Variáveis de ambiente para testes
SUPABASE_TEST_URL=https://xxx.supabase.co
SUPABASE_TEST_SERVICE_ROLE=eyJ...
```

**2. Configuração vitest para testes de integração**

```typescript
// vitest.integration.config.ts
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/integration/setup.ts'],
    // Sem timeout curto — queries reais levam mais tempo
    testTimeout: 30_000,
  },
})
```

**3. E2E com Playwright — fluxos críticos**

```bash
# Fluxos prioritários:
# 1. Cadastro clínica → aprovação → primeiro pedido
# 2. Pedido → pagamento → repasse à farmácia
# 3. Consultor → comissão → transferência
npx playwright test tests/e2e/critical-flows.spec.ts
```

**4. Load testing com k6**

```bash
k6 run --vus 1000 --duration 60s tests/load/order-flow.js
```

---

## Checklist de escala por faixa

| Faixa                 | ✅ Feito                                                                                                      | ⏳ Pendente                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **0–100 clínicas**    | Singleton admin, cache dashboard, fix N+1, cursor orders, streaming export, Sentry ativo, Upstash Redis ativo | Source maps Sentry (SENTRY_AUTH_TOKEN)                            |
| **100–300 clínicas**  | —                                                                                                             | pg_stat_statements, índices confirmados, Vercel KV                |
| **300–500 clínicas**  | —                                                                                                             | Particionamento tabelas, cursor pagination em todas as 13 páginas |
| **500–1000 clínicas** | —                                                                                                             | Inngest, read replica, Firebase batch 500                         |
| **1000+ clínicas**    | —                                                                                                             | Multi-região, DataDog, Supabase Enterprise                        |

---

_Atualizado em Abril 2026 — Clinipharma v1.7.x_
