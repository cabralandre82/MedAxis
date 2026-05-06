# Runbook — `asaas-reconcile`

**Gravidade:** 🟡 P3 (steady-state) · 🟠 P2 quando `reconciled > 0` repetidamente
**Alerta de origem:** cron `*/15 * * * *` em `/api/cron/asaas-reconcile`
**SLO:** triage < 30 min · containment < 4 h · resolution < 24 h
**Owner:** on-call engineer
**Introduzido por:** Pre-Launch Onda S1 / F5 (2026-05-06)

---

## 0. Companion skill

Não há skill dedicado — o runbook é curto o suficiente para ser
consultado direto. Se virar tema recorrente, abrir
`.cursor/skills/asaas-reconcile/SKILL.md`.

---

## 1. Sintomas observados

O cron `asaas-reconcile` faz parte da estratégia em camadas para
garantir que **todo pagamento Asaas confirmado vire entrada no
ledger** (commissions / transfers / consultant_commissions):

```
camada 1 — webhook Asaas (lib/jobs/asaas-webhook.ts via Inngest)  ← F1
camada 2 — cron reconcile (este job)                               ← F5
camada 3 — super-admin manual (página admin de pagamentos)
```

Em steady state, **camada 1 dá conta**. F5 só registra
`scanned > 0`, `reconciled = 0`. Sintomas que disparam este runbook:

- Log `[asaas-reconcile] cron recovered payment(s) — webhook missed`
  com `reconciled > 0` em qualquer execução.
- Métrica `asaas_reconcile_recovered_total > 0` em janela de 1 h.
- Métrica `asaas_reconcile_total{outcome="error_gateway_unavailable"}`
  > 5 em uma janela de 30 min (Asaas instável).
- Métrica `asaas_reconcile_total{outcome="error_local_advance"}`
  > 0 — a função compartilhada com F1 falhou ao confirmar; provável
  > bug no RPC ou drift de schema.
- `cron_runs` mostra `failed` para `job_name = 'asaas-reconcile'`.
- `asaas_reconcile_last_run_ts` parado há > 60 min — cron parou.

---

## 2. Impacto no cliente

- **Cliente final:** indireto. Em steady state nenhum. Quando F5
  recupera, o pedido **só agora** chega à fila da farmácia (atraso
  de até 15 min em vez de < 30 s do happy path).
- **Farmácia:** vê o pedido entrar com até 15 min de atraso.
- **Plataforma:** se F5 falhar continuamente _e_ webhook estiver
  quebrado, pagamentos confirmados ficam sem ledger → comissão de
  consultor não é gerada → relatórios financeiros divergem.
- **Compliance:** sem impacto direto. Trilha de auditoria continua
  íntegra (a confirmação eventual via F5 não falsifica timestamp;
  ela registra `notes='Confirmed via Asaas webhook (PAYMENT_RECONCILED)'`).

---

## 3. Primeiros 5 minutos (containment)

1. **Confirme se é o cron de fato (e não falso positivo de teste):**

   ```bash
   gh run list --workflow=ci.yml --limit=3
   # ou
   curl -s -H "Authorization: Bearer $CRON_SECRET" \
        https://clinipharma.com.br/api/cron/asaas-reconcile | jq
   ```

2. **Verificar a saúde da camada 1 (webhook). Se F1 está vivo,
   `reconciled > 0` é um GLITCH; se F1 está morto, F5 está
   compensando — investigar `asaas-webhook` antes de mexer no F5:**

   ```sql
   -- Cron recente
   select status, started_at, finished_at, result
   from cron_runs
   where job_name in ('asaas-reconcile')
   order by started_at desc limit 10;

   -- Ledger via webhook estagnado?
   -- Quantidade de PENDING > 7 dias com asaas_payment_id
   select count(*) from payments
   where status='PENDING'
     and asaas_payment_id is not null
     and created_at > now() - interval '7 days';
   ```

3. **Abrir issue se `reconciled > 0` em ≥ 2 execuções consecutivas
   ou `error_local_advance > 0`:**

   ```bash
   gh issue create \
     --title "P2 — asaas-reconcile recovering payments (webhook miss)" \
     --label "incident,severity:p2,payments" \
     --body "..."
   ```

4. **NÃO** desabilite F5 mesmo que esteja "ruidoso". Ele é a rede
   de segurança. O barulho é a feature.

---

## 4. Diagnóstico

### 4.1 — É o webhook que está quebrado?

```sql
-- Inngest events processados nas últimas 6h
-- (substitua pela query do dashboard Inngest se preferir)
select status, count(*)
from webhook_events
where created_at > now() - interval '6 hours'
  and source='asaas'
group by status;
```

Se `status='failed'` ou Inngest mostra dead-letter, é problema do
webhook (camada 1). Vá para `webhook-replay.md` —
F5 está fazendo o trabalho dele e sozinho não resolve a causa.

### 4.2 — É a Asaas que está intermitente?

```bash
# Health da Asaas
curl -s -H "access_token: $ASAAS_API_KEY" \
     https://api.asaas.com/v3/myAccount | jq
```

Se Asaas está degradada, `error_gateway_unavailable` vai cair
sozinho assim que voltar — ver `external-integration-down.md`.
Considere abrir circuit breaker se sustentado.

### 4.3 — É a RPC `confirm_payment_atomic` que está retornando

erro?

```sql
-- Logs do webhook ledger nas últimas 24h
select route, message, context, created_at
from server_logs
where route ilike '%/cron/asaas-reconcile%'
  and level='error'
  and created_at > now() - interval '24 hours'
order by created_at desc;
```

Se `error_local_advance` aparece consistentemente, é provável
bug de schema ou RPC. Não tente corrigir em produção; abra
`atomic-rpc-mismatch.md`.

### Decision tree

```
reconciled > 0, errors=0  →  webhook miss em camada 1, ver §5.A
errors > 0 mas reconciled também  →  Asaas intermitente, §5.B
errors > 0 sem reconciled  →  algo quebrou no F5 ou RPC, §5.C
sem run há > 60 min  →  cron parou, §5.D
```

---

## 5. Mitigação

### 5.A — Webhook miss real (reconciled > 0, errors = 0)

F5 já fez o trabalho. Investigue _por que_ camada 1 falhou:

1. Confira `webhook-replay.md` para retentar eventos órfãos.
2. Verifique Inngest dashboard
   (`https://app.inngest.com/env/production/functions/asaas-webhook`).
3. Se padrão recorrente: abra ADR para revisar política de retry.

Tempo esperado: ≤ 30 min de análise. Reversível: N/A (F5 já agiu).

### 5.B — Asaas intermitente (`error_gateway_unavailable` em surto)

Aguarde — F5 vai retomar quando a Asaas voltar; a próxima execução
em 15 min reprocessará todo o backlog (pendings com gateway_id).
Se sustentado por > 1 h, consulte `external-integration-down.md`
e considere abrir circuit breaker.

Não há mitigação local — não saímos do contrato com a Asaas.

### 5.C — Erro local (`error_local_advance > 0`)

Possíveis causas:

- RPC `confirm_payment_atomic` quebrada por uma migration recente.
- `payments.lock_version` ficou dessincronizado (migration faltando).
- `SYSTEM_USER_ID` não existe (migration 084 revertida).

Comando de verificação imediato:

```sql
-- system user existe?
select id, email, is_active from auth.users
where id = '00000000-0000-0000-0000-000000000000';

-- RPC compila?
select pg_get_functiondef('public.confirm_payment_atomic'::regproc);
```

Se algum dos dois falha, é problema estrutural — siga
`atomic-rpc-mismatch.md` ou reverta a migration culpada.

### 5.D — Cron parado (`last_run_ts` antigo)

```sql
select * from cron_runs
where job_name='asaas-reconcile'
order by started_at desc
limit 5;
```

Se `skipped_locked` repetido: lock órfão — ver `cron-double-run.md`.
Se `failed` repetido: leia o `error` da última run e rote pela §5.C.
Se vazio: cron sumiu do `vercel.json` — checar deploy mais recente.

### 5.E — Kill-switch (último recurso, NÃO recomendado)

F5 não tem feature flag dedicado. Para desabilitá-lo, remover a
entrada de `vercel.json`:

```diff
-    {
-      "path": "/api/cron/asaas-reconcile",
-      "schedule": "*/15 * * * *"
-    }
```

Faça isso APENAS se F5 estiver causando dano (improvável dado o
desenho idempotente). O custo é perder a rede de segurança até
fix do webhook.

---

## 6. Verificação pós-mitigação

- [ ] Próximo ciclo de F5 (~15 min) registra `errors=0`.
- [ ] `asaas_reconcile_recovered_total` para de subir.
- [ ] `cron_runs` para `asaas-reconcile` mostra `success`.
- [ ] Sem erros novos em `server_logs` para esta route.
- [ ] (se 5.A): nova execução do webhook (Inngest) volta a
      processar PENDING normalmente.

---

## 7. Post-mortem

Obrigatório se:

- F5 recuperou ≥ 5 pagamentos em 24 h (sintoma de problema
  sistêmico no webhook).
- Houve `error_local_advance > 0` (problema estrutural).

Template em `.github/ISSUE_TEMPLATE/postmortem.md`. Linha do
tempo, causa raiz, ação para evitar repetição.

---

## 8. Prevenção

- F5 ele mesmo é uma camada de prevenção contra falhas da camada 1.
- Manter `tests/unit/lib/payments/asaas-reconcile.test.ts` cobrindo
  novos status que a Asaas adicione.
- Atualizar `classifyAsaasStatus` quando novos enums aparecerem
  na API da Asaas (treat-as-unknown gera log warn, não dano).
- Considerar contador de "tempo desde última execução com
  `errors=0`" para alerta proativo (Wave futura).

---

## Links

- Código: `lib/payments/asaas-reconcile.ts`,
  `lib/payments/confirm-via-webhook.ts`,
  `app/api/cron/asaas-reconcile/route.ts`
- Tests: `tests/unit/lib/payments/asaas-reconcile.test.ts`
- Métricas: `docs/observability/metrics.md` §
  `asaas_reconcile_*`
- ADRs: `docs/decisions/` (F1/F5 ADR pendente)
- Runbooks relacionados: `webhook-replay.md`,
  `external-integration-down.md`, `cron-double-run.md`,
  `cron-job-failing.md`, `atomic-rpc-mismatch.md`

---

_Last updated: 2026-05-06 · Owner: solo operator + AI agents_
