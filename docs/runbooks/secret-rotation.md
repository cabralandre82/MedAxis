# Runbook — Rotação Programada de Segredos

**Gravidade base:** P3 (programada). Escala automaticamente para P2/P1 se houver suspeita de comprometimento — nesse caso, mude imediatamente para `secret-compromise.md`.

**Owner:** SRE (executor) + Security (revisor) + DPO (notificado em rotações Tier C).

**Wave de origem:** 15 (cron + ledger + manifest); ampliado em Wave Hardening II #4 (manifest JSON publicável + este runbook).

---

## 0. Contexto (1 minuto de leitura)

A plataforma rastreia **19 segredos** divididos em 3 tiers, definidos em `lib/secrets/manifest.ts` e espelhados em `docs/security/secrets-manifest.json` (publicável). A política **automática** é executada pelo cron `/api/cron/rotate-secrets` aos domingos às 04:00 UTC.

| Tier  | Política                                       | Janela   | Quem age                                       | Exemplos                                                                                                  |
| ----- | ---------------------------------------------- | -------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A** | Auto-rotação pelo cron (random 32 bytes)       | 90 dias  | Cron (se flag `secrets.auto_rotate_tier_a` ON) | `CRON_SECRET`, `METRICS_SECRET`, `BACKUP_LEDGER_SECRET`                                                   |
| **B** | Assistida — cron enfileira; operador rotaciona | 90 dias  | SRE on-call (~30 min)                          | Resend, Asaas, Zenvia, Inngest, Clicksign, Nuvem Fiscal, Vercel token, Turnstile                          |
| **C** | Manual — janela de manutenção planejada        | 180 dias | SRE + DPO + Eng Lead (~2 h)                    | `SUPABASE_DB_PASSWORD`, `SUPABASE_JWT_SECRET`, `FIREBASE_PRIVATE_KEY`, `OPENAI_API_KEY`, `ENCRYPTION_KEY` |

> **Distinção importante:** este runbook cobre rotação **programada / preventiva**. Para resposta a **comprometimento confirmado ou suspeito** (chave vazada, exposição em log, alerta de scanner externo, dispensa de funcionário), use `secret-compromise.md`.

---

## 1. Sinais de que rotação programada é necessária

- Alerta semanal **`secrets:rotation:overdue`** (warning padrão; critical com `secrets.rotation_enforce` ON).
- `/api/health/deep` campo `secretRotation.overdueCount > 0` ou `neverRotatedCount > 0`.
- Painel Grafana **SLO-12 — Oldest secret age** > 60 dias (yellow) ou > 90 dias (red).
- Calendário de manutenção trimestral (Q1: Tier C; Q2/Q3/Q4: validação de freshness).
- Onboarding de novo segredo (deve ser registrado com `recordManualRotation` reason=`genesis`).

---

## 2. Fluxo Tier A — Auto-rotação (cron faz tudo)

### 2.1 Pré-condição

- Flag `secrets.auto_rotate_tier_a` está ON (consultar tabela `feature_flags`).
- `VERCEL_TOKEN` e `VERCEL_PROJECT_ID` configurados em produção.
- Última execução do cron registrada na ledger (verificar via `/api/health/deep`).

### 2.2 Cronologia esperada (sem ação humana)

```
Domingo 04:00 UTC → cron acorda
         04:00:01 → cron-guard: lock adquirido
         04:00:02 → getOverdueSecrets() chamado
         04:00:03 → para cada Tier A overdue:
                       random 32 bytes → vercel.rotateEnvValue → record na ledger
         04:00:NN → triggerRedeploy("Wave 15 — auto-rotation ...")
         04:00:NN → redeploy completa (~90s)
         04:01:30 → secrets novos ativos em todas as funções
         04:01:31 → ledger registra deployment_id
```

### 2.3 Verificação (segunda-feira de manhã)

- Abrir Sentry → buscar tag `module:secrets/rotate` no domingo.
- Esperar entradas `tier A rotation succeeded` para cada Tier A overdue.
- Conferir Grafana **SLO-12 → Oldest secret age** caiu para próximo de 0.
- Conferir tabela `secret_rotation_record`: novas linhas com `success=true`, `details.rotation_strategy='tier_a_auto'`.

### 2.4 Falha do cron Tier A

Se `tier A rotation FAILED` aparece:

1. Ler `error_class` no detalhe do alerta. Casos comuns:
   - `VercelConfigError`: `VERCEL_TOKEN` inválido ou `VERCEL_PROJECT_ID` errado → corrigir env e re-disparar cron manualmente via `curl -X GET .../api/cron/rotate-secrets -H "Authorization: Bearer $CRON_SECRET"`.
   - `ECONNRESET` / `ETIMEDOUT`: erro transitório da Vercel API → o cron retentará no próximo domingo; só agir se persistir 2 semanas.
2. Se `secrets:redeploy-failed` foi disparado: a chave foi rotacionada na env mas o redeploy falhou. Funções warm ainda servem o valor antigo. Executar:
   ```bash
   vercel deploy --prod --force --token=$VERCEL_TOKEN
   ```
   Aguardar 2 min e validar `/api/health/deep`.

---

## 3. Fluxo Tier B — Assistida (cron enfileira; operador roda)

### 3.1 Quando o alerta chega

O cron registra `outcome=queued-for-operator` na ledger e dispara alerta com a lista. Cada item indica `provider` e o anchor do runbook de incidente para o caso de problemas.

### 3.2 Execução (por segredo)

#### 3.2.1 RESEND_API_KEY

1. Logar em `https://resend.com/api-keys` com a conta de serviço.
2. Criar nova key com nome `clinipharma-prod-YYYY-MM-DD`.
3. Copiar valor (visível **uma única vez**).
4. `vercel env add RESEND_API_KEY production` → colar.
5. `vercel deploy --prod --force` (aguardar deploy ~90s).
6. Validar: enviar 1 e-mail de teste via /api/health/deep ou via job dedicado.
7. Voltar ao Resend e **revogar** a key antiga.
8. Registrar:
   ```bash
   curl -X POST .../api/admin/secrets/record-rotation \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"secret":"RESEND_API_KEY","reason":"manual","rotated_by":"sre-andre","success":true}'
   ```

#### 3.2.2 ASAAS_API_KEY / ASAAS_WEBHOOK_SECRET

- Mesmo padrão, mas **ASAAS_WEBHOOK_SECRET** tem janela de ~30 s onde webhooks podem 401. Coordenar com finance/comercial. Reenviar webhooks falhados via Asaas portal.

#### 3.2.3 ZENVIA_API_TOKEN

- Padrão idêntico. Verificar via envio de SMS de teste (1 destinatário interno).

#### 3.2.4 INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY

- **INNGEST_SIGNING_KEY** valida requisições FROM Inngest TO `/api/inngest`. Antes de rotacionar, esperar a fila estar vazia (`inngest dashboard → queue depth = 0`). Caso contrário, jobs in-flight 401.

#### 3.2.5 CLICKSIGN_ACCESS_TOKEN / CLICKSIGN_WEBHOOK_SECRET

- Padrão Resend. Webhook precisa do mesmo cuidado de 30 s.

#### 3.2.6 NUVEM_FISCAL_CLIENT_SECRET

- OAuth2: rotacionar em Nuvem Fiscal portal → a próxima emissão de NF-e usará o novo client secret na obtenção do access token.

#### 3.2.7 VERCEL_TOKEN (cuidado especial — é circular)

- O cron USA esse token para rotacionar outros segredos. Antes de rotacioná-lo:
  1. Pausar o cron via flag `secrets.cron_paused = true`.
  2. Criar novo token em `https://vercel.com/account/tokens`.
  3. `vercel env add VERCEL_TOKEN production` (com o NOVO valor).
  4. `vercel deploy --prod --force`.
  5. Esperar deploy ativo.
  6. Reabilitar `secrets.cron_paused = false`.
  7. Revogar o token antigo.
- Validar com 1 dry-run manual: `curl ... /api/cron/rotate-secrets?dry_run=1`.

#### 3.2.8 TURNSTILE_SECRET_KEY

- Cloudflare dashboard → Turnstile → site → secret key → rotate. Atualizar Vercel env e redeploy.

### 3.3 Encerramento (todos os Tier B)

- Conferir tabela `secret_rotation_record`: linha de sucesso para cada segredo rotacionado.
- Atualizar ticket / log de manutenção com hash da linha (`row_hash`) como prova.
- Se algum segredo ficou pendente: documentar motivo e prazo na ticket; o cron alertará novamente no próximo domingo.

---

## 4. Fluxo Tier C — Manual (janela de manutenção)

### 4.1 Antes de iniciar

- **Janela mínima:** 2 horas em horário de baixa atividade (preferencialmente domingo 23:00–01:00 BRT).
- **Comunicação:** notificar parceiros 7 dias antes (`docs/templates/incident-comms.md`); colocar `/status` em "Manutenção planejada".
- **Aprovação:** DPO + Eng Lead + um Diretor.
- **Backup:** snapshot completo do banco antes de qualquer alteração.

### 4.2 Por segredo

#### 4.2.1 SUPABASE_DB_PASSWORD

1. Supabase dashboard → Settings → Database → Reset DB password.
2. Copiar nova senha → atualizar `SUPABASE_DB_PASSWORD` em todos os ambientes.
3. Redeploy de todos os serviços que usam conexão direta (não obrigatoriamente o app — o app usa REST API).
4. Smoke test em `/api/health/deep` e em pelo menos 1 endpoint que faz query.
5. `recordManualRotation`.

#### 4.2.2 SUPABASE_JWT_SECRET ⚠️ INVALIDA TODAS AS SESSÕES

- **Pré-aviso:** publicar banner 24 h antes "Manutenção em DD/MM 23:00 — necessário re-login".
- Supabase dashboard → Settings → API → JWT Secret → Regenerate.
- Atualizar 3 envs: `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Redeploy.
- Smoke test: criar usuário novo, fazer login, fazer 3 chamadas autenticadas.
- Comunicar aos parceiros que o re-login está liberado.
- `recordManualRotation` para cada um dos 3 segredos.

#### 4.2.3 FIREBASE_PRIVATE_KEY

- Firebase Console → Project Settings → Service Accounts → Generate New Private Key.
- Atualizar 3 envs: `FIREBASE_PROJECT_ID` (provavelmente igual), `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- Redeploy.
- Validar: enviar 1 push notification de teste.

#### 4.2.4 OPENAI_API_KEY

- OpenAI portal → API keys → Create new → revoke old.
- Atualizar Vercel env, redeploy, validar com 1 chamada OCR opt-in.

#### 4.2.5 ENCRYPTION_KEY ⚠️ NÃO ROTACIONAR INGENUAMENTE

- Esta chave criptografa **todo PII em repouso** (Wave 6). Rotação simples destrói os dados.
- Procedimento correto é multi-semana:
  1. Implementar versionamento de chave (key versioning) em `lib/crypto.ts` — Wave futura.
  2. Adicionar coluna `encryption_key_version` em todas as tabelas com PII cifrado.
  3. Gerar nova chave, marcar como `version=2`, manter `version=1` válida em paralelo.
  4. Job batch que decifra com v1 e re-cifra com v2 (linha por linha, idempotente).
  5. Após 100% das linhas migradas: retirar v1 do código e do env.
  6. `recordManualRotation` reason=`provider-forced` ou `manual`.
- **Se houver suspeita de leak da v1**: pause a plataforma (modo de manutenção), abra incidente P0, vá direto para `secret-compromise.md` §4.5.

### 4.3 Pós-rotação Tier C

- Pós-mortem leve (mesmo sem incidente): cronologia, RTO observado, surpresas.
- Atualizar `docs/security/secrets-manifest.json` se algum metadado mudou: `npm run secrets:export-manifest`.
- DPO comunica formalmente o cumprimento da política à direção (e-mail interno).

---

## 5. Comandos úteis

```bash
# Estado em tempo real (do banco)
curl -sS https://app.clinipharma.com.br/api/health/deep | jq '.checks.secretRotation'

# Disparar o cron manualmente (mesmo fora do schedule)
curl -X GET https://app.clinipharma.com.br/api/cron/rotate-secrets \
  -H "Authorization: Bearer $CRON_SECRET"

# Regenerar manifesto JSON (após mudar lib/secrets/manifest.ts)
npm run secrets:export-manifest && git add docs/security/secrets-manifest.json

# Verificar drift entre TS e JSON
npm run test -- secrets-manifest-json

# Forçar reload dos feature flags em produção (se mudou auto_rotate_tier_a)
curl -X POST https://app.clinipharma.com.br/api/admin/features/refresh \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 6. Política de retenção da ledger

A tabela `secret_rotation_record` é **append-only** com hash chain (sha256). Retenção mínima: **5 anos** (alinhada à retenção de audit log). Não permitir UPDATE/DELETE direto — apenas inserção via RPC `secret_rotation_record(...)`.

A view `public.secret_inventory` agrega o último estado por segredo e expõe `secret_inventory.age_seconds` em tempo real para `/api/health/deep` e dashboards (métrica emitida: `secret_age_seconds`).

---

## 7. Cobertura de testes (CI)

- `tests/unit/lib/secrets-manifest.test.ts` — drift TS ↔ SQL (migration 056).
- `tests/unit/lib/secrets-manifest-json.test.ts` — drift TS ↔ `secrets-manifest.json`.
- `tests/unit/lib/secrets-rotate.test.ts` — orquestrador (mocks Vercel API).
- `tests/unit/lib/secrets-vercel.test.ts` — wrapper da Vercel API.

Toda alteração em `lib/secrets/manifest.ts` exige:

1. Atualizar a migration SQL (056) para refletir a mudança.
2. Rodar `npm run secrets:export-manifest`.
3. Rodar `npm run test -- secrets-` localmente.
4. Commit conjunto dos 3 artefatos.

---

## 8. Pós-rotação — checklist final

- [ ] Linha registrada na ledger com `success=true`.
- [ ] `/api/health/deep` mostra `secretRotation.overdueCount` decrementado.
- [ ] Grafana SLO-12 atualizado (sem alerta amarelo/vermelho).
- [ ] Pós-mortem (se Tier C) salvo em `docs/security/`.
- [ ] Manifest JSON regenerado se houve mudança de metadata.
- [ ] DPO notificado se Tier C ou se houve qualquer evento atípico.

---

## 9. Kill-switches & feature flags

Os dois flags abaixo governam o comportamento do cron `/api/cron/rotate-secrets`. Ambos default OFF (`enabled = false`) para permitir rampa gradual.

| `feature_flags.key`            | State default | Efeito quando ON                                                                                                                                      | Efeito quando OFF                                                          |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `'secrets.rotation_enforce'`   | OFF           | Cron `rotate-secrets` **pagina P1** para cada secret vencido (TTL estourado) — força ação imediata.                                                   | Cron só emite warning em log + envia e-mail para `security@`.              |
| `'secrets.auto_rotate_tier_a'` | OFF           | Cron **auto-rotaciona** Tier A (`CRON_SECRET`, `METRICS_SECRET`, `BACKUP_LEDGER_SECRET`): gera novo valor, faz PATCH no Vercel env, dispara redeploy. | Tier A se comporta como Tier B: apenas alerta + work-item para o operator. |

**Quando virar `secrets.rotation_enforce` ON:** depois do primeiro ciclo completo com o manifest estável (30 dias sem falsos positivos) — aí o SLA real começa a valer.

**Quando virar `secrets.auto_rotate_tier_a` ON:** somente após `VERCEL_TOKEN` com escopo `env:write` estar provisionado, testado contra staging, e 3 rotações Tier B consecutivas terem ocorrido sem drift (validando o caminho manual antes de ceder para a máquina).

**Leitura do estado atual:**

```sql
SELECT key, enabled, updated_at, description
  FROM public.feature_flags
 WHERE key IN ('secrets.rotation_enforce', 'secrets.auto_rotate_tier_a');
```

**Flip via migration** (preferencial) ou SQL emergencial:

```sql
UPDATE public.feature_flags
   SET enabled = true, updated_at = now()
 WHERE key = 'secrets.rotation_enforce';
```

Todo flip deve ser registrado em `docs/security/incidents/<id>/flags.md` ou em `docs/execution-log.md` com justificativa — a mudança afeta a cadência de páging.

## 10. Referências

- `lib/secrets/{rotate,manifest,vercel,index}.ts`
- `app/api/cron/rotate-secrets/route.ts`
- `supabase/migrations/056_secret_rotation.sql`
- `docs/security/secrets-manifest.json` (artefato publicável)
- `docs/runbooks/secret-compromise.md` (resposta a incidente — cenário P0/P1/P2)
- `vercel.json` (schedule do cron)
- LGPD art. 46 (medidas técnicas e administrativas de segurança)
- SOC 2 CC6.1, CC6.5, CC9.2 (mapeamento em `docs/compliance/soc2/controls-matrix.md`)
