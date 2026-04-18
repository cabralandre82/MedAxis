# Runbook — Cron double-run / lock stuck

**Gravidade:** P2 (degradação — job crítico pode estar atrasado ou em loop; ainda não é falha de cliente, mas rapidamente vira).

**Alerta de origem:**

- `cron_runs.status = 'failed'` repetido para o mesmo `job_name`.
- `cron_runs.status = 'skipped_locked'` em cadeia prolongada (>3 ciclos seguidos no mesmo job).
- Email default do GitHub Actions / Vercel em falha de cron.
- Consulta de saúde: `SELECT job_name, status, count(*) FROM cron_runs WHERE started_at > now() - interval '1 hour' GROUP BY 1,2`.

---

## 1. Sintomas observados

Um ou mais:

- Cron `X` rodou há >2h quando deveria rodar a cada 30min (um lock stuck).
- Alerta "Vercel cron X failed 3x in a row" via email.
- `cron_runs` mostra longa cadeia `skipped_locked` — lock não está sendo liberado.
- Side-effect esperado não aconteceu (stale orders não foram fechados, drafts não foram purgados, etc.).

## 2. Impacto no cliente

- **purge-drafts, purge-revoked-tokens, purge-server-logs:** nenhum impacto imediato ao cliente; dados crescem além do retention.
- **enforce-retention:** violação LGPD silenciosa — dados de usuários deletados permanecem acima do SLA contratual. P2 vira P1 se >24h sem rodar.
- **churn-check, reorder-alerts, product-recommendations:** e-mails/push de engajamento atrasados.
- **coupon-expiry-alerts:** cliente pode perder cupom sem aviso.
- **stale-orders:** pedidos abandonados não são fechados — impacto em métricas de conversion + inventário travado.
- **revalidate-pharmacies:** cache CDN desatualizado.
- **expire-doc-deadlines:** **ALTO** — contrato pode permanecer pendente após deadline legal; risco LGPD e de disputa.

## 3. Primeiros 5 minutos (containment)

1. Diagnóstico rápido:

   ```sql
   SELECT job_name, status, started_at, duration_ms, error
   FROM cron_runs
   WHERE started_at > now() - interval '6 hours'
   ORDER BY started_at DESC
   LIMIT 50;
   ```

2. Ver estado atual de locks:

   ```sql
   SELECT job_name, locked_by, locked_at, expires_at,
          (expires_at - now()) AS ttl_remaining
   FROM cron_locks
   ORDER BY locked_at DESC;
   ```

   - Se `expires_at < now()` para algum lock, ele está "órfão" — mas qualquer nova invocação vai roubá-lo automaticamente (TTL auto-steal). Não é necessário fazer nada manualmente.
   - Se `expires_at > now()` e há entrada de há >15min, runner real está provavelmente morto mas lease ainda vivo. Seção 5.1 abaixo.

3. Ver se deploy Vercel está saudável:
   - Dashboard Vercel → Deployments → última production. Erros de build / runtime?
   - `/api/health/ready` → 200?

4. Se o impacto é ALTO (ex: `expire-doc-deadlines` parado há >4h), escalar para fundador em paralelo e **abrir issue `incident`**.

## 4. Diagnóstico detalhado

### 4.1 Tipo A — Cron em loop de falha (`status = 'failed'` recorrente)

```sql
SELECT job_name, count(*) AS fails, max(error) AS sample_error
FROM cron_runs
WHERE status = 'failed'
  AND started_at > now() - interval '24 hours'
GROUP BY job_name
ORDER BY fails DESC;
```

Cruzar com logs:

```sql
SELECT request_id, created_at, level, message, context
FROM server_logs
WHERE request_id IN (
  SELECT request_id FROM cron_runs
  WHERE status = 'failed' AND job_name = 'NOME-DO-JOB'
  ORDER BY started_at DESC LIMIT 5
)
ORDER BY created_at DESC;
```

Ou filtrar no Sentry por `tags.cron_job:<nome>`.

### 4.2 Tipo B — Cron sempre `skipped_locked`

```sql
SELECT started_at, locked_by
FROM cron_runs
WHERE job_name = 'NOME-DO-JOB'
  AND status = 'skipped_locked'
ORDER BY started_at DESC
LIMIT 10;
```

Interpretação:

- Se `locked_by` muda a cada linha → invocações concorrentes reais (Vercel disparou 2 pods, ok).
- Se `locked_by` é sempre o mesmo → pod original travou mas lease ainda vivo.

### 4.3 Tipo C — Job nunca roda

```sql
SELECT max(started_at) FROM cron_runs WHERE job_name = 'NOME-DO-JOB';
```

Se o max é muito antigo, comparar com o schedule em `vercel.json`:

```bash
grep -A1 'NOME-DO-JOB' vercel.json
```

- Se schedule mudou em deploy recente → regressão.
- Se schedule está correto → Vercel não está invocando. Abrir ticket com Vercel support.

## 5. Mitigação

### 5.1 Lock órfão que não expira (Tipo B persistente)

Se confirmado que o runner original está morto e lease ainda vivo:

```sql
SELECT cron_release_lock('NOME-DO-JOB', 'LOCKED_BY_VALUE');
```

Substitua `LOCKED_BY_VALUE` pela string exata da coluna `locked_by` em `cron_locks` (formato `<deploy-id>:<uuid>`). O RPC só deleta se bater.

**Fallback (emergência):** `DELETE FROM cron_locks WHERE job_name = 'NOME-DO-JOB';` — use apenas se `cron_release_lock` não funcionar. Registre no audit_logs com comentário `incident:<id>`.

### 5.2 Cron em loop de falha (Tipo A)

1. Identificar erro no Sentry via `request_id`.
2. Se é erro transiente (DB timeout, external API 5xx): esperar próximo ciclo, monitorar.
3. Se é erro permanente (bug no código): hotfix PR + deploy.
4. **Disable temporário** enquanto corrige: editar `vercel.json` para remover o cron e deploy → ou, se não quer redeploy, setar `CRON_SECRET` inválido temporariamente (mas isso bloqueia todos). Melhor: aplicar migration ad-hoc:

   ```sql
   -- Bloqueia invocação colocando um lock permanente (até remover manualmente)
   INSERT INTO cron_locks (job_name, locked_by, expires_at)
   VALUES ('NOME-DO-JOB', 'manual-disable:incident-<id>', now() + interval '365 days')
   ON CONFLICT (job_name) DO UPDATE SET
     locked_by = EXCLUDED.locked_by,
     expires_at = EXCLUDED.expires_at;
   ```

   **Lembre-se de deletar a entrada após o fix.**

5. Forçar execução manual após fix (via cURL autenticado):

   ```bash
   curl -X GET \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://app.clinipharma.com/api/cron/NOME-DO-JOB
   ```

### 5.3 Cron não está sendo invocado (Tipo C)

1. Verificar `vercel.json` no último commit em `main`. Schedule presente?
2. Vercel Dashboard → Project → Settings → Cron Jobs. Listado? Ativo?
3. Se ausente: redeploy + verificar.
4. Se presente mas não invoca: ticket Vercel.

## 6. Correção (definitiva)

- **Bug no handler:** PR com fix + teste unitário. Cron está isolado por `runCronGuarded`, então falha não quebra outros jobs.
- **Handler mais lento que o TTL (900s):** aumentar `ttlSeconds` no `withCronGuard` do job específico. Exemplo atual: `revalidate-pharmacies` usa `1800s`. Considerar quebrar o job em batches se precisar >1800s.
- **Dependência externa instável:** adicionar circuit breaker (`lib/circuit-breaker.ts`) no lado do handler.
- **Job sem retention:** adicionar `cron_runs` purge job em W15 (particionamento). Por ora, volume está OK.

## 7. Post-incident

1. Post-mortem em 72h para qualquer P2 que impactou cliente.
2. Alerta proativo: criar cron `cron-health-check` em W6 que consulta `cron_runs` e abre Sentry issue se algum job não rodou há >2x seu schedule.
3. Adicionar caso reproduzindo falha ao `tests/unit/lib/cron-guarded.test.ts` ou `tests/unit/api/<job>.test.ts`.

## 8. Links úteis

- Migration: `supabase/migrations/045_webhook_cron_hardening.sql`
- Wrapper: `lib/cron/guarded.ts`
- Schedule: `vercel.json`
- Vercel Dashboard → Cron: https://vercel.com/<team>/<project>/settings/cron-jobs
- Supabase SQL editor (staging): https://supabase.com/dashboard/project/<staging>/sql
- Supabase SQL editor (prod): https://supabase.com/dashboard/project/<prod>/sql

---

_Última revisão: 2026-04-17 (Wave 2)._
