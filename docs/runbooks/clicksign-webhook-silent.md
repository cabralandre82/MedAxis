# Runbook — `clicksign-webhook-silent`

**Gravidade:** 🟡 P3 quando há 0 contratos esperando · 🟠 P2 quando há contratos `SENT`/`VIEWED` aguardando há > 6h
**Alerta de origem:** cron `*/15 * * * *` em `/api/cron/clicksign-webhook-watch` (outcome `silent_with_pending`) OU regra Grafana `ClicksignWebhookSilent`
**SLO:** triage < 30 min · resolution < 2 h
**Owner:** on-call engineer
**Introduzido por:** Pre-Launch Onda S2 / T4 (2026-05-07)

---

## 0. Companion skill

Não há skill dedicado. Runbook curto, decisão majoritariamente em portal externo (Clicksign).

---

## 1. Sintomas observados

O Clicksign assina cada delivery com HMAC SHA-256 sobre o raw body (header `Content-Hmac`). O handler `app/api/contracts/webhook` retorna 401 quando a assinatura falha — **antes** de gravar em `webhook_events`. Logo, qualquer rotação acidental de `CLICKSIGN_WEBHOOK_SECRET` faria todos os deliveries virarem 401 silenciosamente; um contrato em `SENT` ou `VIEWED` ficaria parado indefinidamente.

T4 cobre isso de 3 maneiras:

1. **Counter no handler:** `clicksign_webhook_total{outcome}` separa `hmac_verified`, `hmac_dev_bypass`, `hmac_failed`. Drift em `dev_bypass > 0` em prod = `CLICKSIGN_WEBHOOK_SECRET` caiu.
2. **Cron 15-min watchdog:** mede staleness + contratos esperando. Outcome `silent_with_pending` = canal silente E há contratos esperando há > 6h.
3. **Sinal contra-baseline:** evita falso positivo em pre-launch — "0 webhooks 24h" só é alerta quando há contratos esperando.

Sintomas que disparam este runbook:

- Log `[clicksign-watch] webhook channel may be silent` com `pendingContractsAged > 0`.
- Métrica `clicksign_webhook_last_received_age_seconds > 21600` (6 h) **E** `clicksign_pending_contracts_aged > 0` por > 30 min.
- Métrica `clicksign_webhook_total{outcome="hmac_failed"} > 5` por 5 min sustentado em prod (ataque ou config drift no portal Clicksign).
- Métrica `clicksign_webhook_total{outcome="hmac_dev_bypass"} > 0` em prod (NUNCA deveria acontecer — env caiu).

**Sintomas que NÃO disparam este runbook:**

- `outcome="silent_no_pending"` → 0 contratos `SENT/VIEWED` em prod. Esperado em pre-launch; cron registra info, não warn.
- `clicksign_webhook_last_received_age_seconds = -1` → nunca houve delivery (sentinel). Verifica se já existem contratos em `SENT`; se não, fluxo normal.

---

## 2. Impacto no cliente

- **Cliente final (clínica/médico/farmácia/consultor):** alto. Contrato fica em `SENT` indefinidamente — usuário não vê confirmação de assinatura mesmo que tenha assinado no portal Clicksign. Onboarding bloqueado.
- **Operador:** vê painel `/registrations` com contratos travados; sem este runbook, demora a perceber que o problema é canal de webhook (não atraso da clínica).
- **LGPD:** zero impacto direto. Logs de webhook continuam em `webhook_events` (failed) se chegarem.

---

## 3. Containment imediato (pré-diagnóstico)

Se o impacto for confirmado (contrato real travado por > 6 h, signatário relata "já assinei mas plataforma não sabe"):

```bash
# 0. Confirmar: qual contrato e qual signatário?
psql "$PSQL_URI" -c "
SELECT id, type, status, clicksign_document_key, created_at
  FROM contracts
 WHERE status IN ('SENT', 'VIEWED')
   AND created_at < now() - interval '6 hours'
 ORDER BY created_at;
"

# 1. Cross-check com portal Clicksign — está como `running`/`closed`?
#    (manual, no portal: https://app.clicksign.com)
```

Se Clicksign reporta documento `closed` (assinado) mas nosso DB está em `SENT`/`VIEWED`, o gap é exclusivamente o webhook. **Não há mitigation autônoma** — corrigir o canal é a única saída. Mas o operador pode marcar o contrato como SIGNED manualmente:

```sql
-- ÚLTIMO RECURSO — só após validar manualmente que Clicksign confirmou.
-- Loga ação no audit trail.
UPDATE contracts
   SET status = 'SIGNED',
       signed_at = now(),
       document_url = '<URL DO PDF NO CLICKSIGN>'
 WHERE id = '<UUID>';

INSERT INTO audit_logs (resource_id, action, actor_user_id, details, ...)
VALUES ('<UUID>', 'CONTRACT_FORCE_SIGNED', '<your_user_id>',
        jsonb_build_object('reason','clicksign-webhook-silent runbook',
                           'verified_at_clicksign','<DATETIME>'));
```

Esse passo desbloqueia o usuário, mas **NÃO substitui** corrigir o canal de webhook.

---

## 4. Diagnóstico

### 4.A. Verificar env var em Vercel

```bash
vercel env ls --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" \
  | grep -i CLICKSIGN_WEBHOOK_SECRET
```

Se a env existe mas o counter `hmac_failed` está crescendo, o problema é **mismatch** entre o secret no Vercel e o secret no portal Clicksign.

Se a env NÃO existe, o counter `hmac_dev_bypass` está crescendo silenciosamente em prod — bug do operador (alguém deletou). Recriar agora (passo 5.A).

### 4.B. Verificar configuração no portal Clicksign

1. Login em https://app.clicksign.com → Configurações → Webhooks
2. Confirmar que existe webhook habilitado para `https://clinipharma.com.br/api/contracts/webhook`.
3. Confirmar que **HMAC SHA256 Secret** mostra valor não-vazio.
4. Eventos habilitados: `sign`, `auto_close`, `deadline`, `cancel` (todos os 4 — sem isso, contrato `SENT` que recebe `view` não atualiza).

### 4.C. Verificar logs recentes do handler

```bash
# Vercel logs filtra por nome da rota
vercel logs --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" \
  | grep -i clicksign | head -50
```

Linhas relevantes:

- `clicksign duplicate delivery` → webhook está chegando; o problema é OUTRO (handler falha após HMAC).
- HTTP `401` em volume alto → HMAC mismatch (secret rotacionado de um lado só).
- HTTP `400 Bad request` `body is not valid JSON` → corpo deformado, atacante tentando bypass.
- Sem nenhum log nas últimas 6h → portal Clicksign parou de tentar (verificar passo 4.B).

### 4.D. Forçar re-entrega manual via portal Clicksign

No painel do contrato no portal Clicksign existe botão "Re-enviar webhook" — usar para 1 contrato real recente. Em < 30 s deve aparecer linha em `webhook_events`. Se aparecer e o nosso counter `hmac_verified` incrementar, **canal está OK**; o que faltava era nada — alerta foi falso. Se virar `hmac_failed`, secret está errado em algum dos dois lados.

---

## 5. Mitigação

### 5.A. CLICKSIGN_WEBHOOK_SECRET caiu da env (counter `hmac_dev_bypass > 0` em prod)

Re-adicionar no Vercel:

```bash
echo -n "<SECRET DO PORTAL CLICKSIGN>" | vercel env add CLICKSIGN_WEBHOOK_SECRET production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"

# Forçar redeploy para o lambda warm pegar a env nova
vercel --prod --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

Re-disparar webhook do contrato pendente via portal Clicksign para confirmar.

### 5.B. Mismatch (counter `hmac_failed` crescendo)

1. Decidir qual é a fonte da verdade. Default: portal Clicksign (foi quem mudou primeiro, geralmente).
2. Copiar secret do portal Clicksign.
3. Atualizar Vercel env (se diferente — `vercel env add` pra production e preview, com redeploy):

```bash
# Remover antiga
vercel env rm CLICKSIGN_WEBHOOK_SECRET production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID" --yes

# Adicionar nova
echo -n "<NEW SECRET>" | vercel env add CLICKSIGN_WEBHOOK_SECRET production \
  --token="$VERCEL_TOKEN" --scope="$VERCEL_ORG_ID"
```

4. Redeploy + verificar `hmac_verified` voltar a crescer e `hmac_failed` parar.

### 5.C. Webhook removido do portal Clicksign

Re-habilitar no portal:

- URL: `https://clinipharma.com.br/api/contracts/webhook`
- HMAC SHA256 Secret: gerar novo, copiar valor
- Eventos: `sign`, `auto_close`, `deadline`, `cancel`
- Atualizar `CLICKSIGN_WEBHOOK_SECRET` em Vercel (passo 5.A).

### 5.D. Contratos travados que NÃO foram resolvidos por re-delivery

Para cada contrato em `SENT`/`VIEWED` aged > 6h cujo Clicksign reporta como `closed`:

1. Buscar o PDF assinado em Clicksign → salvar em storage Supabase.
2. Aplicar UPDATE manual (ver passo 3, último SQL).
3. Disparar notificação manual ao usuário ("Seu contrato foi assinado!").

---

## 6. Verificação pós-mitigação

```promql
# 1. Counter hmac_verified deve crescer com novos webhooks
sum(rate(clicksign_webhook_total{outcome="hmac_verified"}[15m]))

# 2. hmac_failed e hmac_dev_bypass devem cair pra 0
sum(rate(clicksign_webhook_total{outcome="hmac_failed"}[15m]))
sum(rate(clicksign_webhook_total{outcome="hmac_dev_bypass"}[15m]))

# 3. Staleness baixa rapidamente após primeiro delivery
clicksign_webhook_last_received_age_seconds

# 4. pendingContractsAged volta pra 0 quando todos os contratos
#    aged forem destravados (manualmente ou via webhook normal)
clicksign_pending_contracts_aged
```

Esperado em janela de 30 min após mitigação:

- `hmac_verified` > 0 (assumindo redelivery + novo contrato real).
- `hmac_failed = 0`, `hmac_dev_bypass = 0`.
- `clicksign_pending_contracts_aged = 0` (todos destravados).

---

## 7. Post-mortem triggers

Abrir post-mortem (issue `incident-postmortem`) se qualquer destes:

- Cliente real foi impactado por > 6 h.
- Cron `clicksign-webhook-watch` ficou sem detectar o silent (gap entre incident start e alerta > 30 min).
- Causa raiz foi rotação acidental de secret sem aviso (aponta para falha do processo de rotação documentado em `lib/secrets/manifest.ts`).

---

## 8. Prevenção

- **Rotação assistida (Tier B):** ao trocar `CLICKSIGN_WEBHOOK_SECRET`, fazer mudança simultânea Vercel + portal. Ver skill `secret-rotate`.
- **Watchdog redundante:** considerar mover este cron para 5 min em vez de 15 min uma vez que volume real subir.
- **Alarme T7 (futuro Onda 3):** quando T4 do plano for promovido para fail-closed (HMAC obrigatório em prod), `hmac_dev_bypass` para de existir como caminho — mas isso só pode acontecer DEPOIS deste runbook ter sido provado.

---

## 9. Histórico

| Data       | Evento                                                          |
| ---------- | --------------------------------------------------------------- |
| 2026-05-07 | T4 introduzido. Onda 2 do pre-launch. Sem incidente real ainda. |
