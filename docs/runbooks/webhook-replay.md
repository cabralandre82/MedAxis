# Runbook — Webhook replay / dedup failure

**Gravidade:** P2 (degradação — cliente afetado pode contornar; risco de double-charge / double-sign se não diagnosticado rápido).

**Alerta de origem:**

- Sentry issue com `module: webhooks/dedup` em warn/error.
- Query de monitoramento: `SELECT count(*) FROM webhook_events WHERE status='failed' AND received_at > now() - interval '1 hour'`.
- Relato manual (Asaas/Clicksign reclamando que reentrega está batendo 500).

---

## 1. Sintomas observados

Um ou mais dos seguintes:

- `webhook_events.status = 'failed'` acumulando para um mesmo `source` (geralmente `asaas` ou `clicksign`).
- `webhook_events.attempts >= 3` com `status = 'duplicate'` — sender está reentregando o mesmo evento repetidamente, sugere que estamos devolvendo 5xx e ele acha que falhamos.
- Logger emitindo `claim threw` ou `duplicate detected but row lookup failed` com `module: webhooks/dedup`.
- Cliente reportando "recebi dois e-mails de contrato assinado" ou "o pagamento confirmou duas vezes".

## 2. Impacto no cliente

- **Pior caso (fail-open + bug downstream):** duplicação de side-effects — pagamento confirmado em dobro, contrato re-assinado, notificação duplicada.
- **Caso provável:** nenhum — o handler retorna 200 para duplicate, sender para de reentregar, cliente não percebe.
- **Se dedup degradado por DB indisponível:** cada retry do sender dispara business logic inteira, risco de race condition em `orders`/`contracts`.

## 3. Primeiros 5 minutos (containment)

1. Confirmar gravidade. Rodar:

   ```sql
   SELECT source, status, count(*), max(received_at) AS last
   FROM webhook_events
   WHERE received_at > now() - interval '30 minutes'
   GROUP BY source, status
   ORDER BY source, status;
   ```

   Se `status='duplicate'` está subindo rápido (>1/min por source), é um sender em loop.

2. Se o loop é Asaas:
   - Verificar no painel Asaas (Configurações → Notificações → Webhooks) se há entregas marcadas como "falha" recentes.
   - Se sim, prosseguir com diagnóstico (seção 4).
   - Se não, pode ser replay malicioso. Conferir IP de origem em `server_logs` para o `request_id` correlato.

3. Se o loop é Clicksign:
   - Painel Clicksign → Configurações → Webhooks. Ver lista de eventos recentes com status "error".
   - Mesma lógica.

4. **Abrir issue no GitHub com label `incident`** — cronologia vai aqui, não em chat.

## 4. Diagnóstico

### 4.1 Qual evento está em loop?

```sql
SELECT id, source, event_type, idempotency_key, status,
       attempts, http_status, received_at, error
FROM webhook_events
WHERE attempts > 2
  AND received_at > now() - interval '2 hours'
ORDER BY attempts DESC, received_at DESC
LIMIT 20;
```

Olhar a coluna `error` e `http_status`. Três padrões típicos:

- `http_status = 500` + `error = 'FOO'` → o handler estourou exceção. Ver Sentry pelo `request_id` da coluna correspondente em `server_logs`.
- `http_status = 200` + `status = 'duplicate'` e mesmo assim reentregando → sender não está respeitando 200 (**bug do sender** — abrir ticket com Asaas/Clicksign).
- `status = 'received'` há mais de 5min sem `processed_at` → handler travou. Ver `server_logs` para a request.

### 4.2 Correlacionar com logs

```sql
SELECT request_id, created_at, level, message, context
FROM server_logs
WHERE request_id IN (
  SELECT request_id FROM webhook_events
  WHERE attempts > 2 AND received_at > now() - interval '2 hours'
)
ORDER BY created_at DESC
LIMIT 200;
```

Ou buscar no Sentry com filtro `tags.request_id:<uuid>`.

### 4.3 Dedup degradado

Se aparecem logs `claim threw` ou `complete threw`:

```sql
SELECT count(*) FROM webhook_events
WHERE received_at > now() - interval '10 minutes';
```

Se o volume caiu a zero, o DB está inacessível a partir do handler. Checar:

- `/api/health/ready` (retorna 503 se `service_role_key` ou pool falha).
- Supabase Dashboard → Logs → Postgres / Pool.

## 5. Mitigação

### 5.1 Sender em loop legítimo (bug do handler)

1. Identificar stack no Sentry.
2. **Se for bug em código:** hotfix + deploy. Enquanto isso:
3. **Silenciar o sender temporariamente:** Asaas / Clicksign painel → pausar webhook ou diminuir retry schedule.
4. Após hotfix deploy:
   - Forçar Asaas/Clicksign a reenviar os eventos falhados (painel tem botão "reentregar"). Eles vão hitar `claimWebhookEvent`, achar a row antiga com `status='failed'`, e o handler tentará de novo. Se o bug está corrigido, viram `processed`.

### 5.2 Sender ignorando 200 (bug do sender)

1. Marcar eventos como processados manualmente para cortar o looping:

   ```sql
   UPDATE webhook_events
   SET status = 'processed', processed_at = now()
   WHERE source = 'asaas'
     AND attempts > 5
     AND received_at > now() - interval '6 hours';
   ```

2. Abrir ticket com o sender.
3. Registrar no post-mortem.

### 5.3 Dedup degradado (DB inacessível)

Handlers fazem **fail-open** — continuam processando mesmo sem dedup. Risco: duplicação de side-effects se o sender reentregar durante o downtime.

1. Prioridade absoluta: restaurar Supabase (runbook `database-unavailable.md`).
2. Após restauração, rodar reconciliação:

   ```sql
   -- Contratos que possivelmente foram assinados 2x no intervalo do downtime
   SELECT id, status, signed_at, count(*) OVER (PARTITION BY clicksign_key) AS dup
   FROM contracts
   WHERE signed_at BETWEEN 'downtime_start' AND 'downtime_end'
   ORDER BY dup DESC;
   ```

   Idem para `payments` com `asaas_charge_id`.

3. Se houver duplicatas, criar issue `incident-reconcile-YYYY-MM-DD` e executar script de merge manualmente com aprovação do fundador (regra geral — nunca modificar dados em prod sem `audit_logs` entry).

## 6. Correção (definitiva)

Escolher com base na causa-raiz:

- **Bug de handler:** PR com fix + teste de regressão. Verificar se `completeWebhookEvent` está sendo chamado em todos os caminhos (success e error).
- **Sender hostil:** implementar rate limit mais agressivo no Edge + bloquear IPs conhecidamente abusivos em Cloudflare WAF (rule "webhook-abuse").
- **Dedup indisponível recorrentemente:** considerar fallback local (Redis) em W6 — mas provavelmente o root cause é pool exhaustion (runbook `connection-pool-exhausted.md`).

## 7. Post-incident

1. Abrir postmortem `.github/ISSUE_TEMPLATE/postmortem.md` em ≤72h se afetou cliente.
2. Adicionar teste E2E replicando o cenário observado (injeta duplicate → garante que business logic não roda 2x).
3. Se aplicável: atualizar este runbook com a nova causa-raiz na seção 4.

## 8. Links úteis

- Painel Asaas webhooks: https://www.asaas.com/config/notifications
- Painel Clicksign webhooks: https://app.clicksign.com/settings/webhooks
- Supabase Logs: Dashboard → Logs → Postgres
- Migration original: `supabase/migrations/045_webhook_cron_hardening.sql`
- Código: `lib/webhooks/dedup.ts`
- Handlers: `app/api/payments/asaas/webhook/route.ts`, `app/api/contracts/webhook/route.ts`

---

_Última revisão: 2026-04-17 (Wave 2)._
