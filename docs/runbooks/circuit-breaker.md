# Runbook — Circuit breaker open (CircuitBreakerOpen)

**Gravidade:** 🟠 P2 (integração externa indisponível por ≥ 5 min).
**Alerta de origem:** `CircuitBreakerOpen` em
`monitoring/prometheus/alerts.yml` — `circuit_breaker_state == 2`
(OPEN) por 5 min consecutivos.
**SLO:** triage < 15 min · containment < 1 h · resolution depende do
provider externo.
**Owner:** on-call engineer → backend lead.

---

## 1. Sintomas observados

- `circuit_breaker_state{provider="asaas|resend|openai|..."} == 2`.
- Usuários veem erros gracefully-handled: checkout diz "pagamento
  temporariamente indisponível"; email não chega; OCR não processa.
- `http_outbound_total{provider=X, outcome="error"}` spikou antes da
  abertura do breaker.
- Nenhum 5xx na aplicação — o breaker existe justamente para converter
  falhas upstream em degradação controlada.

---

## 2. Impacto no cliente

Depende do provider:

| Provider | Impacto                                                    |
| -------- | ---------------------------------------------------------- |
| Asaas    | Checkout bloqueado. Pedidos ficam em `pending_payment`.    |
| Resend   | Emails transacionais não saem. Retry queue enche.          |
| OpenAI   | OCR/análise IA paraliza. Fluxo de cadastro fica manual.    |
| Supabase | Catastrófico — ver `database-unavailable.md` em vez deste. |

---

## 3. Primeiros 5 minutos

1. **Confirmar o provider:**

   ```promql
   max by (provider) (circuit_breaker_state) == 2
   ```

2. **Checar status page do provider** (Asaas, Resend, OpenAI) — se está
   reportando incidente público, você não tem o que fazer além de esperar.

3. **Ver taxa de erros imediatamente anterior ao fechamento:**

   ```promql
   sum by (provider, outcome) (rate(http_outbound_total[15m]))
   ```

4. **Ver se queue está enchendo** (aplicável a Resend):

   ```sql
   select provider, count(*)
   from public.webhook_events
   where created_at > now() - interval '1 hour'
     and processed_at is null
   group by provider;
   ```

---

## 4. Diagnóstico

### 4.1 — Status page confirma incidente externo

Nada a fazer tecnicamente. Comunicar stakeholders, aguardar. Breaker
voltará a half-open automaticamente após o cooldown.

### 4.2 — Status page limpa, mas erros persistem

- Credenciais expiradas? Checar secret rotation ledger:
  ```sql
  select * from public.secret_ledger where secret_name like '%asaas%'
  order by rotated_at desc limit 5;
  ```
- IP do Vercel bloqueado? Provider fez allowlist change? Contatar suporte.
- DNS envenenado? Improvável mas checar resolução.

### 4.3 — Breaker "zumbi" (provider OK mas breaker não recupera)

Se o provider realmente voltou mas o breaker ainda está OPEN depois de
10 min do provider-OK → bug no breaker. Escalar para backend lead.

---

## 5. Mitigação

### 5.A — Provider realmente fora do ar

**Não feche o breaker manualmente.** Deixe o half-open retry automático
funcionar. Se o incidente do provider persistir > 30 min e for crítico:

```sql
update public.feature_flags set enabled = false where key = '<provider>.enabled';
```

Isso esconde o fluxo do usuário em vez de mostrar erro gracioso.

### 5.B — Fallback quando existir

Para emails: Resend tem fallback via SMTP manual (ver `lib/email/index.ts`).
Para OCR: rota de análise manual via painel admin (`/admin/pending-ocr`).
Para pagamentos: N/A — não há fallback de gateway hoje.

### 5.C — Reset forçado do breaker

**Raro.** Só quando temos certeza que o provider voltou mas o breaker
não foi reciclado:

```bash
# Via next.js route de admin — exige ADMIN_SECRET
curl -X POST https://app/api/admin/circuit-breaker/reset \
     -H "Authorization: Bearer $ADMIN_SECRET" \
     -d '{"provider":"asaas"}'
```

Se essa rota não existir (hoje é opcional), redeploy força reset
(breaker state é in-memory).

---

## 6. Verificação pós-mitigação

- [ ] `circuit_breaker_state{provider=X} == 0` (CLOSED).
- [ ] `http_outbound_total{provider=X, outcome="ok"}` voltou a crescer.
- [ ] Fila de retries drenando (se houver).
- [ ] Alerta `CircuitBreakerOpen` auto-resolveu.

---

## 7. Post-mortem

P2: opcional. Obrigatório se o breaker ficou aberto > 2h OR se o
impacto em receita foi > R$ 10k.

---

## 8. Prevenção

- Adicionar fallback onde não existe (e.g. gateway de pagamento 2°).
- Aumentar timeout do breaker para providers flaky conhecidos.
- Alerta antecipado: `http_outbound_total{outcome="error"}` > 10%
  por 5 min (antes do breaker abrir).

---

## Links

- Código: `lib/circuit-breaker.ts`.
- Alert: `monitoring/prometheus/alerts.yml` → `CircuitBreakerOpen`.
- Métricas: `docs/observability/metrics.md` §3.1 (`circuit_breaker_state`).
- Runbooks relacionados: `incident-response.md`, `slow-requests.md`,
  `external-integration-down.md`.

---

_Runbook version: 2026-04-18 · Owner: backend on-call_
