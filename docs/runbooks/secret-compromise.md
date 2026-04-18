# Runbook — Secret Compromise / Rotation

**Gravidade:** P1 (confirmed leak), P2 (suspected leak), P3 (scheduled rotation overdue).
**Owner:** Security + SRE. DPO obrigatório quando há evidência de exfiltração.
**Wave:** 15 — `lib/secrets/` + migration `056_secret_rotation.sql`.

---

## 0. Contexto

A plataforma rastreia 19 secrets divididos em três tiers (manifest:
[`lib/secrets/manifest.ts`](../../lib/secrets/manifest.ts), espelhado pela
view SQL `public.secret_inventory`). O cron semanal
`/api/cron/rotate-secrets` (Domingo 04:00 UTC) detecta secrets além do
prazo e dispara este runbook quando ação humana é necessária.

| Tier | Política                                                           | Janela | Exemplos                                                                                                  |
| ---- | ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| A    | Auto-rotação pelo cron (apenas se `secrets.auto_rotate_tier_a` ON) | 90 d   | `CRON_SECRET`, `METRICS_SECRET`, `BACKUP_LEDGER_SECRET`                                                   |
| B    | Assistida (cron enfileira + alerta; operador executa)              | 90 d   | Resend, Asaas, Zenvia, Inngest, Clicksign, Nuvem Fiscal, Vercel token, Turnstile                          |
| C    | Manual obrigatório (cron só alerta; janela de manutenção)          | 180 d  | `SUPABASE_DB_PASSWORD`, `SUPABASE_JWT_SECRET`, `FIREBASE_PRIVATE_KEY`, `OPENAI_API_KEY`, `ENCRYPTION_KEY` |

> ⚠️ **`ENCRYPTION_KEY` é destrutiva.** Rotacionar sem migração de
> envelope encryption inutiliza todos os dados PII em repouso. NUNCA
> rotacione naively. Se houver leak suspeito, pause o platform
> antes de tomar qualquer ação — abra incidente P0 e siga §4.5.

---

## 1. Sintomas observados

- Alerta **`secrets:rotation:overdue`** disparado pelo cron semanal
  (`severity=warning` enquanto `secrets.rotation_enforce` OFF;
  `severity=critical` quando ON).
- Alerta **`secrets:redeploy-failed`**: rotação Tier A teve sucesso
  na Vercel API mas o redeploy automático falhou — secrets antigos
  ainda em uso pelas funções warm.
- Alerta **`secrets:cron:misconfigured`**: cron não rodou (DB
  inalcançável, RPCs ausentes, env vars faltando).
- `/api/health/deep` campo `secretRotation.ok = false` com
  `neverRotatedCount > 0` ou `overdueCount > 0` quando flag ON.
- Painel Grafana **SLO-12 · Oldest secret age (days)** acima de 60d
  (yellow) ou 90d (red).
- Aviso externo (BugCrowd, GitHub leak scanner, vendor disclosure)
  apontando que um secret específico vazou.

---

## 2. Primeiros 5 minutos

### 2.1 Identificar o cenário

| Cenário                                                            | Vá para |
| ------------------------------------------------------------------ | ------- |
| Cron alertou que secret está overdue (sem evidência de leak)       | §3      |
| Suspeita de leak (employee offboarding, repo público, log exposto) | §4      |
| Confirmação de leak (vendor avisou, atacante usou em prod)         | §4 + §6 |
| Tier A rotacionou mas redeploy falhou                              | §5      |

### 2.2 Snapshot do estado (sempre antes de mitigar)

```bash
# Inventory atual (idade + última rotação por secret)
curl -s -X POST "https://api.supabase.com/v1/projects/${SB_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT secret_name, tier, age_days, last_rotated_at FROM public.secret_inventory ORDER BY age_seconds DESC;"}' | jq

# Histórico recente do ledger (últimas 50 rotações)
curl -s -X POST "https://api.supabase.com/v1/projects/${SB_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT rotated_at, secret_name, tier, trigger_reason, success, rotated_by, error_message FROM public.secret_rotations ORDER BY seq DESC LIMIT 50;"}' | jq

# Hash chain integrity
curl -s -X POST "https://api.supabase.com/v1/projects/${SB_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"WITH ordered AS (SELECT row_hash, prev_hash, LAG(row_hash) OVER (ORDER BY seq) AS expected FROM public.secret_rotations) SELECT COUNT(*) FILTER (WHERE prev_hash IS DISTINCT FROM expected AND expected IS NOT NULL) AS chain_breaks FROM ordered;"}' | jq
```

`chain_breaks > 0` significa que alguém adulterou o ledger — escalar
para `audit-chain-tampered.md` imediatamente.

---

## 3. Rotação programada (sem leak suspeito)

### 3.1 Tier A — auto

Estado normal: o cron já rotacionou sozinho. Verifique no ledger
`trigger_reason='cron-due'` e `success=true`. Se você está aqui, é
porque o flag `secrets.auto_rotate_tier_a` está OFF — ligue:

```sql
UPDATE public.feature_flags
   SET enabled = true,
       updated_at = now()
 WHERE key = 'secrets.auto_rotate_tier_a';
```

Aguarde o próximo cron (Domingo 04:00 UTC) ou force manualmente:

```bash
curl -X GET "https://clinipharma.com.br/api/cron/rotate-secrets" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

### 3.2 <a name="tier-b-assisted-rotation"></a>Tier B — assistida

O cron já registrou um evento `success=true, trigger_reason='cron-due'`
com details `rotation_strategy=tier_b_queued`. Sua tarefa: executar
a rotação no portal e gravar a confirmação no ledger.

#### 3.2.1 RESEND_API_KEY

1. Resend dashboard → API Keys → "Create API Key" (mesmas permissões da atual).
2. Copie o novo valor.
3. Vercel CLI:
   ```bash
   vercel env rm RESEND_API_KEY production --yes
   echo -n "<NEW_VALUE>" | vercel env add RESEND_API_KEY production
   vercel deploy --prod --force
   ```
4. Aguarde o deploy ficar `READY`. Teste enviando 1 email transacional via:
   ```bash
   curl -X POST "https://clinipharma.com.br/api/admin/email-test" \
     -H "Authorization: Bearer ${OPS_TOKEN}" \
     -d '{"to":"ops@clinipharma.com.br","template":"smoke"}'
   ```
5. Resend dashboard → revogue a key antiga.
6. Grave no ledger:
   ```sql
   SELECT public.secret_rotation_record(
     'RESEND_API_KEY', 'B', 'resend-portal',
     'manual', 'operator:<seu-uuid>', true, NULL,
     '{"deployment_id":"<dpl_...>","old_key_revoked_at":"<iso>"}'::jsonb
   );
   ```

#### 3.2.2 ASAAS_API_KEY + ASAAS_WEBHOOK_SECRET

⚠️ **Coordenado.** O webhook secret afeta verificação HMAC; fora de
sincronia, webhooks são rejeitados (401). Janela tolerável < 60 s.

1. Asaas portal → Integrações → Chaves de API → "Gerar nova".
2. Copie + atualize Vercel env (`ASAAS_API_KEY`).
3. Asaas portal → Webhooks → Editar → atualize o secret.
4. Imediatamente atualize Vercel env (`ASAAS_WEBHOOK_SECRET`).
5. `vercel deploy --prod --force` (uma única vez para os dois).
6. Teste: dispare webhook de teste do Asaas. Deve aparecer
   `webhook_events.status='processed'`.
7. Asaas portal → revogue a chave antiga.
8. Ledger:
   ```sql
   SELECT public.secret_rotation_record('ASAAS_API_KEY','B','asaas-portal','manual','operator:<uuid>',true,NULL,'{}'::jsonb);
   SELECT public.secret_rotation_record('ASAAS_WEBHOOK_SECRET','B','asaas-portal','manual','operator:<uuid>',true,NULL,'{}'::jsonb);
   ```

#### 3.2.3 CLICKSIGN_ACCESS_TOKEN + CLICKSIGN_WEBHOOK_SECRET

Mesmo padrão do Asaas.

#### 3.2.4 ZENVIA_API_TOKEN

1. app.zenvia.com → Developers → Tokens → "Revoke + Create new"
   (Zenvia força create-then-revoke; ordem inversa derruba SMS por ~30s).
2. Vercel env update + deploy.
3. Teste: SMS para o número de QA.
4. Ledger.

#### 3.2.5 INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY

1. **Drene a fila primeiro:** app.inngest.com → Functions → pause as
   funções principais. Aguarde `In-Flight = 0`.
2. Gere novas keys.
3. Vercel env update (ambas) + deploy.
4. Resume as funções.
5. Ledger.

#### 3.2.6 NUVEM_FISCAL_CLIENT_SECRET

1. nuvemfiscal.com.br → API → Credenciais → "Renovar secret".
2. Atualize Vercel env + deploy.
3. Smoke: emita uma NFS-e de teste.
4. Ledger.

#### 3.2.7 VERCEL_TOKEN

⚠️ **Circular.** Se o cron usar este token para rotacionar Tier A,
rotacionar `VERCEL_TOKEN` enquanto o cron roda quebra a próxima
execução. Pause o cron antes:

```bash
# Desabilita temporariamente via flag — nenhum cron tier A vai correr
curl -X POST "https://api.supabase.com/v1/projects/${SB_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -d '{"query":"UPDATE public.feature_flags SET enabled=false WHERE key=$$secrets.auto_rotate_tier_a$$;"}'
```

1. Vercel dashboard → Tokens → "Create Token" (escopo: full or scoped to project).
2. Update Vercel env (`VERCEL_TOKEN`) + deploy.
3. Re-habilite o flag.
4. Vercel dashboard → revogue token antigo.
5. Ledger.

#### 3.2.8 TURNSTILE_SECRET_KEY

1. Cloudflare dashboard → Turnstile → seu site → "Rotate secret key".
2. Vercel env update + deploy.
3. Smoke: tente uma submissão pública (formulário de contato).
4. Ledger.

### 3.3 <a name="tier-c-manual-rotation"></a>Tier C — manual com janela

Tier C exige planejamento. Antes de qualquer ação:

1. Comunicar stakeholders: criar issue `[security] Tier C rotation:
<SECRET>` com no mínimo 7d de antecedência.
2. Agendar **janela de manutenção** (≥ 30 min) em horário low-traffic
   (Domingo 02:00 BRT).
3. Confirmar com DPO se a rotação tem implicação LGPD (ENCRYPTION_KEY:
   sim, sempre).
4. Notificar usuários se `invalidatesSessions=true` (ver `manifest.ts`).

#### 3.3.1 SUPABASE_DB_PASSWORD

Drops todas conexões diretas (psql, Inngest workers, scripts).
**Não afeta** PostgREST / supabase-js (usam JWT, não senha).

1. Supabase dashboard → Settings → Database → "Reset database password".
2. Copie o novo valor.
3. Atualize **simultaneamente**:
   - Vercel env (`SUPABASE_DB_PASSWORD`)
   - Quaisquer secrets stores externos (Inngest, GitHub Actions)
4. `vercel deploy --prod --force`.
5. Teste conexão direta:
   ```bash
   PGPASSWORD=<new> psql "postgresql://postgres@db.${SB_REF}.supabase.co:5432/postgres" -c "select 1"
   ```
6. Ledger:
   ```sql
   SELECT public.secret_rotation_record(
     'SUPABASE_DB_PASSWORD','C','supabase-mgmt',
     'manual','operator:<uuid>',true,NULL,
     '{"window":"<inicio>..<fim>","downtime_observed_seconds":<n>}'::jsonb
   );
   ```

#### 3.3.2 SUPABASE_JWT_SECRET (e siblings)

⚠️ **Invalida TODAS as sessões.** Todo usuário precisará re-login.
Coordenar com Marketing para anúncio in-app 24h antes.

1. Anúncio in-app + email ≥ 24h antes da janela.
2. Janela de manutenção: Supabase dashboard → Settings → API → "Rotate JWT secret".
3. Capture os 3 valores novos:
   - `SUPABASE_JWT_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Vercel env update **simultâneo** (todos os 3) + deploy.
5. Smoke: `/api/health/deep` deve retornar 200.
6. Smoke: cron `/api/cron/rls-canary` deve rodar com `violations=0`
   (porque o canary forja JWT contra o novo secret).
7. Ledger (3 entradas: o secret + as 2 derivadas com siblings nos details):
   ```sql
   SELECT public.secret_rotation_record(
     'SUPABASE_JWT_SECRET','C','supabase-mgmt',
     'manual','operator:<uuid>',true,NULL,
     '{"siblings_rotated":["SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_ANON_KEY"],"sessions_invalidated":<estimate>}'::jsonb
   );
   ```

#### 3.3.3 FIREBASE_PRIVATE_KEY

1. Firebase Console → Project Settings → Service Accounts →
   "Generate new private key" (gera um novo service account JSON).
2. Decompor em 3 envs (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` — note o formato `\n` escapado).
3. Vercel env update + deploy.
4. Smoke: envie 1 push notification de teste.
5. Firebase Console → revogue a service account antiga.
6. Ledger.

#### 3.3.4 OPENAI_API_KEY

1. OpenAI dashboard → API keys → "Create new secret key".
2. Vercel env update + deploy.
3. Smoke: chame `/api/admin/ai-smoke` ou similar.
4. OpenAI dashboard → revogue a chave antiga.
5. Ledger.

#### 3.3.5 ENCRYPTION_KEY (PROCEDIMENTO DESTRUTIVO)

**Pré-requisito ausente:** ainda não implementamos envelope encryption
com versionamento de chave. Rotacionar `ENCRYPTION_KEY` neste estado
**inutiliza todos os dados PII em repouso** (telefones, CPFs, números
de conta). Se a chave estiver comprometida e uma rotação for
inevitável:

1. Pause a plataforma (modo manutenção).
2. Backup full de TODAS as colunas encrypted (a partir do schema).
3. Decrypt TODAS as linhas com a chave atual e armazene em buffer
   transitório (cuidado: dados em claro).
4. Gere `ENCRYPTION_KEY` nova.
5. Re-encrypt todas as linhas com a chave nova.
6. Atualize Vercel env + deploy.
7. Despause + smoke.
8. Ledger com `details.destroyed_data=false, manual_reencryption_run=true`.

Esta operação é multi-hora. Se o tempo for crítico, considere
abandonar campos não-essenciais e re-coletar.

---

## 4. Suspeita / confirmação de leak

### 4.1 Triagem inicial (≤ 15 min)

1. **Qual secret?** Identifique exatamente qual env var vazou. Se a
   evidência mostra um valor conhecido, compare o **fingerprint** (8 chars
   sha256) com o ledger:
   ```sql
   SELECT secret_name, rotated_at, details->>'new_value_fingerprint' AS fp
     FROM public.secret_rotations
    WHERE details->>'new_value_fingerprint' = '<8chars>';
   ```
2. **Qual o blast radius?** Cheque `lib/secrets/manifest.ts`. Tier A
   = baixo (CRON_SECRET só permite chamar /api/cron). Tier C =
   crítico (acesso DB, JWT, etc).
3. **Há evidência de uso indevido?**
   - Logs de acesso anômalo (Sentry, Vercel)
   - Auditoria Supabase (Logs Explorer)
   - Spike de `webhook_events` ou `audit_logs` recentes
4. Decisão: rotação imediata (suspeita) ou planejada (sem evidência)?

### 4.2 Rotação imediata (qualquer tier) — § siga §3 com:

- `trigger_reason = 'incident-suspected-leak'` ou
  `'incident-confirmed-leak'`
- Pular janela de manutenção mesmo para Tier C — aceitar o impacto.
- Notificar DPO em paralelo, NÃO depois.
- Para Tier C com sessions invalidadas: anúncio in-app é
  posterior, o leak é mais crítico que UX de re-login.

### 4.3 Communication paths

| Audiência  | Canal               | Prazo após containment                          |
| ---------- | ------------------- | ----------------------------------------------- |
| DPO        | Slack #security     | 15 min                                          |
| Operations | Slack #ops          | 30 min                                          |
| Founders   | WhatsApp directos   | 1 h                                             |
| Customers  | Email + status page | 24 h (se afetados)                              |
| ANPD       | Formulário portal   | 72 h (LGPD Art. 48 — se confirmed PII exposure) |

### 4.4 Incident postmortem

Após containment + rotação + verificação:

1. Issue GitHub `[postmortem] Secret leak: <SECRET>` baseado em
   `.github/ISSUE_TEMPLATE/postmortem.md`.
2. Linha do tempo (descoberta → contenção → rotação → verificação).
3. Root cause (origem do leak: `.env` em commit, log exposto,
   employee offboarding sem rotação, third-party breach).
4. Action items:
   - Pre-commit hook bloqueia secrets em diffs?
   - GitHub secret scanning alertou?
   - Por que offboarding não tinha checklist de rotação?
5. Update este runbook com o aprendizado.

### 4.5 ENCRYPTION_KEY leak — caso especial

Se `ENCRYPTION_KEY` vazar:

1. Pause plataforma imediatamente (modo manutenção total).
2. Avalie quem tem acesso ao banco (não-encriptado, attacker pode
   ler PII direto se tiver tanto a key quanto o ciphertext).
3. Se houver evidência de exfil do banco recente: notifique ANPD +
   todos os usuários afetados em 72h (LGPD Art. 48).
4. Execute o procedimento §3.3.5.
5. Considere migração emergencial para envelope encryption
   (worker para outra wave, mas pré-requisito de re-rotação).

---

## 5. Tier A rotation succeeded but redeploy failed

Estado: ledger mostra rotação bem-sucedida + Vercel env atualizado,
mas alerta `secrets:redeploy-failed` disparou. Funções warm ainda
servem o valor antigo (em memória). Não é um security event ainda
(o valor antigo é válido), mas é uma window onde dois valores
co-existem.

1. Force redeploy:
   ```bash
   vercel deploy --prod --force
   # ou via API
   curl -X POST "https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM_ID}" \
     -H "Authorization: Bearer ${VERCEL_TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"name":"'${VERCEL_PROJECT_ID}'","project":"'${VERCEL_PROJECT_ID}'","target":"production","gitSource":{"type":"github","ref":"main"}}'
   ```
2. Aguarde `READY`.
3. Smoke: cron `/api/cron/stale-orders` deve aceitar o novo `CRON_SECRET`.
4. Resolve o alerta no PagerDuty.

---

## 6. Verificação pós-rotação

Para qualquer rotação (programada ou incidental):

```sql
-- 1. Idade reset?
SELECT secret_name, age_days, last_rotated_at, last_trigger_reason
  FROM public.secret_inventory
 WHERE secret_name = '<SECRET>';
-- age_days deve ser < 1.

-- 2. Hash chain íntegra?
WITH ordered AS (
  SELECT row_hash, prev_hash, LAG(row_hash) OVER (ORDER BY seq) AS expected
    FROM public.secret_rotations
)
SELECT COUNT(*) AS chain_breaks
  FROM ordered
 WHERE prev_hash IS DISTINCT FROM expected AND expected IS NOT NULL;
-- Deve ser 0.

-- 3. Sem rotation_failures recentes?
SELECT COUNT(*) FROM public.secret_rotations
 WHERE rotated_at > now() - interval '24 hours' AND success = false;
-- Deve ser 0.
```

```bash
# 4. Deep health verde no campo secretRotation?
curl -s "https://clinipharma.com.br/api/health/deep" \
  -H "Authorization: Bearer ${CRON_SECRET}" | jq '.checks.secretRotation'

# 5. Métricas atualizadas?
curl -s "https://clinipharma.com.br/api/metrics" \
  -H "Authorization: Bearer ${METRICS_SECRET}" | grep -E "secret_(oldest|overdue|never)"
```

---

## 7. Pré-requisitos operacionais

Para que tudo acima funcione:

- [ ] `VERCEL_TOKEN` configurado em production env (escopo de
      env-write necessário para Tier A auto)
- [ ] `VERCEL_PROJECT_ID` e `VERCEL_TEAM_ID` configurados
- [ ] `SUPABASE_ACCESS_TOKEN` (apenas para SREs, em ferramentas
      locais — NÃO em production)
- [ ] Feature flag `secrets.auto_rotate_tier_a` ON em produção
      (após validação de 30d em modo OFF)
- [ ] Feature flag `secrets.rotation_enforce` ON em produção (idem)
- [ ] PagerDuty routing key configurada
- [ ] On-call rotation atualizada em `docs/on-call.md`
- [ ] Calendário compartilhado com janelas Tier C planejadas

---

## 8. Links

- Migration: [`supabase/migrations/056_secret_rotation.sql`](../../supabase/migrations/056_secret_rotation.sql)
- Manifest: [`lib/secrets/manifest.ts`](../../lib/secrets/manifest.ts)
- Orchestrator: [`lib/secrets/rotate.ts`](../../lib/secrets/rotate.ts)
- Cron route: [`app/api/cron/rotate-secrets/route.ts`](../../app/api/cron/rotate-secrets/route.ts)
- SLO-12 details: [`docs/slos.md`](../slos.md#sla-12--secret-freshness-hard)
- SLI queries: [`docs/sli-queries.md`](../sli-queries.md#slo-12--secret-freshness-hard)
- Grafana dashboard: `monitoring/grafana/security.json`, painéis 11-16.
- LGPD obligation reference: Lei 13.709/2018 Art. 46-49.
