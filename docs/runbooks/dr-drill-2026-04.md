# DISASTER RECOVERY DRILL — 2026 Q2

**Status:**

- ✅ EXECUTADO (modo tabletop, 5 cenários) em **2026-04-18**.
- ✅ EXECUTADO (modo **live**, Cenário 3 — restore real do offsite backup) em **2026-04-19** via workflow `restore-drill.yml`. Total **51s**, 0 erros reais, 65+23 tabelas, 9 users, 37 audit_logs restaurados de R2 → vanilla `postgres:18` ephemeral.
- 🟡 Próximo drill **live multi-cenário** (1, 2, 4, 5): 2026-Q3 — depende de provisão de staging Vercel + Supabase staging.

**Evidência tabletop:** `docs/security/dr-evidence/2026-04-18/` (postmortem incluso)
**Evidência live restore (2026-04-19):** `docs/security/dr-evidence/2026-04-19/` ([postmortem](../security/dr-evidence/2026-04-19/postmortem.md), [run](https://github.com/cabralandre82/clinipharma/actions/runs/24631516271))

---

**Data originalmente agendada:** 2026-04-30 (D-30 do go-live)
**Duração:** 4 horas (janela 14h-18h BRT) — escopo live
**Ambiente:** Staging (réplica completa do prod, dados sintéticos)
**Owner:** SRE on-call (rotativo) + DPO (observador)

---

## OBJETIVOS

1. Validar que **RTO** (Recovery Time Objective) e **RPO** (Recovery Point Objective) declarados estão dentro dos limites contratuais.
2. Exercitar os runbooks `secret-compromise.md`, `backup-missing.md`, `audit-chain-tampered.md`, `health-check-failing.md`.
3. Treinar o time on-call em decisões sob pressão.
4. Identificar gaps na automação e atualizar runbooks.
5. Gerar evidência auditável (captura de tela, transcrição, métricas) para SOC 2 / ISO 27001.

---

## ALVOS RTO/RPO

| Camada                             | RTO objetivo | RPO objetivo            | Como medimos                                           |
| ---------------------------------- | ------------ | ----------------------- | ------------------------------------------------------ |
| Aplicação Web (Vercel)             | ≤ 5 min      | 0 (stateless)           | Tempo até `/api/health` retornar 200 após failover     |
| Banco PostgreSQL (Supabase)        | ≤ 30 min     | ≤ 5 min                 | Tempo até reconexão + delta de transações no audit_log |
| Storage (Supabase Storage)         | ≤ 30 min     | ≤ 1 hora                | Reupload e diff de checksums                           |
| Filas (Inngest)                    | ≤ 15 min     | 0 (idempotente)         | Reexecução de jobs com mesmo ID                        |
| Pagamentos (Asaas)                 | ≤ 10 min     | 0 (webhook idempotente) | Reprocessamento de webhooks com same-key               |
| Notificações (Resend, Zenvia, FCM) | ≤ 15 min     | aceitável perda < 1%    | Reenfileiramento via dead-letter                       |
| Segredos (rotação)                 | ≤ 1 hora     | 0 (chain íntegro)       | Smoke do hash chain após rotação manual                |

---

## CENÁRIOS

Cada cenário é **independente**. Em cada cenário:

1. SRE injeta a falha (ou simula via feature flag).
2. Cronômetro inicia.
3. Detecção (alerta no Sentry, Pagerduty hipotético) → cronômetro de detecção.
4. Mitigação (seguindo runbook) → cronômetro de mitigação.
5. Verificação (smoke + health) → fim do cronômetro.
6. Pós-mortem em até 48h.

### CENÁRIO 1 — Banco indisponível (Supabase outage simulado)

**Como simular (staging):** desabilitar a service-role key em `.env.staging` e reiniciar a aplicação.

**Sintomas esperados:**

- `/api/health` 503 com `database.ok: false`
- Sentry: spike de `PostgrestError` ou `connection refused`
- Status page: serviço "Banco de Dados" amarelo/vermelho

**Runbook:** `docs/runbooks/health-check-failing.md`

**Ações esperadas:**

1. Confirmar via Supabase dashboard que é falha real (não config).
2. Acionar plano B: ler banco da réplica somente-leitura (se disponível).
3. Habilitar modo de manutenção (banner global com `/api/maintenance/enable`).
4. Comunicar status page (`/status`) e clientes via e-mail (Resend).
5. Após restauração: reabilitar leitura/escrita; validar audit_log hash chain.

**Critério de sucesso:** RTO ≤ 30 min, RPO ≤ 5 min (delta no `audit_log.created_at`).

**Script de simulação:** `scripts/dr/01-simulate-db-outage.sh`

---

### CENÁRIO 2 — Compromisso de segredo (Vercel env var vazada)

**Como simular:** invalidar manualmente a `ENCRYPTION_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` no Vercel staging e disparar a rotação.

**Sintomas esperados:**

- Falhas em todas as decryption attempts (DSAR, NF-e)
- Sentry: spike de `Failed to decrypt`

**Runbook:** `docs/runbooks/secret-compromise.md`

**Ações esperadas:**

1. Acionar `npm run secrets:rotate` (script disponível desde Wave 15).
2. Validar manifesto: `npm run secrets:verify-chain`.
3. Re-deploy automático no Vercel.
4. Smoke test em 5 endpoints críticos.
5. Notificar DPO e registrar evento no audit_log.

**Critério de sucesso:** RTO ≤ 1 hora, hash chain íntegro pós-rotação.

**Script de simulação:** `scripts/dr/02-simulate-secret-leak.sh`

---

### CENÁRIO 3 — Backup corrupto / restore necessário

> **EXECUTADO LIVE em 2026-04-19** via workflow `restore-drill.yml` ([postmortem](../security/dr-evidence/2026-04-19/postmortem.md)). RTO end-to-end medido: **51s** (pg_restore: 1s) num PostgreSQL 18 efêmero do CI, com 0 erros não-classificados. Backup origem: `weekly/20260419T080245Z` em R2, decryptado com chave `age` armazenada em `secrets.AGE_PRIVATE_KEY`. O drill é agora **mensal e automático** (cron `0 8 1 * *`).

**Como simular:** apagar a tabela `orders` em staging (via psql `TRUNCATE orders CASCADE` em transação revertível para safety) e iniciar restore.

**Sintomas esperados:**

- Endpoints `/orders` 500 ou listas vazias
- Sentry alerta de `relation "orders" does not exist` ou queries vazias

**Runbook:** `docs/runbooks/backup-missing.md`

**Ações esperadas:**

1. Identificar último backup íntegro (Supabase PITR — Point-in-Time Recovery).
2. Promover backup para nova instância de staging.
3. Atualizar string de conexão (`SUPABASE_URL`) por janela controlada.
4. Validar contagem de registros vs último snapshot conhecido.
5. Recomputar hash chain do audit_log.
6. Reabilitar tráfego.

**Critério de sucesso:** RTO ≤ 30 min, RPO ≤ 5 min.

**Script de simulação:** `scripts/dr/03-simulate-backup-restore.sh`

---

### CENÁRIO 4 — Audit log com hash chain quebrado (tampering)

**Como simular:** modificar manualmente uma linha em `audit_log` em staging via SQL direto (ato proibido em produção).

**Sintomas esperados:**

- Cron `/api/cron/verify-audit-chain` falha
- Sentry alerta `audit_chain_break_detected`

**Runbook:** `docs/runbooks/audit-chain-tampered.md`

**Ações esperadas:**

1. Isolar a janela de tempo afetada.
2. Identificar a operação anômala (índice `seq` quebrado).
3. Iniciar investigação forense (snapshot do banco para evidência).
4. Comunicar DPO + Diretoria Jurídica em até 1 hora.
5. Decidir: hot-patch, rollback do banco para snapshot anterior, ou registro de evento de não-conformidade.

**Critério de sucesso:** detecção em ≤ 6 horas do tampering, comunicação interna em ≤ 1 hora.

**Script de simulação:** `scripts/dr/04-simulate-audit-tamper.sh`

---

### CENÁRIO 5 — Region failure (Vercel ou Supabase região indisponível)

**Como simular:** desabilitar deployment Vercel em staging (via API) ou bloquear DNS resolução.

**Sintomas esperados:**

- 100% das requisições falhando
- DNS health check externo falhando

**Runbook (a criar se não existir):** `docs/runbooks/region-failure.md`

**Ações esperadas:**

1. Confirmar via status pages externos (status.vercel.com, status.supabase.com).
2. Ativar página estática de fallback no Cloudflare (Workers).
3. Comunicar via status page externo (Twitter, e-mail aos parceiros).
4. Aguardar restauração do provedor; durante: comunicar ETA a cada 30 min.
5. Pós-restauração: smoke + reabilitação de cron jobs (Inngest).

**Critério de sucesso:** página de fallback ativa em ≤ 5 min; tempo de comunicação a parceiros ≤ 15 min.

**Script de simulação:** `scripts/dr/05-simulate-region-failure.sh`

---

## CRONOGRAMA DO DRILL

| Hora  | Atividade                                            | Owner             |
| ----- | ---------------------------------------------------- | ----------------- |
| 13:30 | Briefing — revisão dos cenários, papéis e safety net | SRE Lead          |
| 14:00 | Cenário 1 (DB outage)                                | SRE on-call       |
| 14:45 | Hot wash + ajustes                                   | Time              |
| 15:00 | Cenário 2 (Secret leak)                              | SRE on-call       |
| 15:30 | Cenário 3 (Backup restore)                           | SRE on-call + DBA |
| 16:00 | Cenário 4 (Audit tamper)                             | SRE on-call + DPO |
| 16:30 | Cenário 5 (Region failure)                           | SRE Lead + Comms  |
| 17:15 | Hot wash final                                       | Todos             |
| 17:45 | Cleanup do staging + reset de dados                  | SRE on-call       |
| 18:00 | Encerramento                                         | SRE Lead          |

---

## EVIDÊNCIA A COLETAR

Cada cenário gera os seguintes artefatos (anexar à pasta `docs/security/dr-evidence/2026-04-30/`):

- Screenshots de detecção (Sentry, status page, dashboards).
- Captura cronometrada de início/fim do RTO.
- Output completo do script de simulação e do script de remediação.
- Smoke test report (URL retornando 200, latência).
- Pós-mortem markdown (template em `docs/templates/postmortem.md`).
- Decisões fora do runbook → sugestões de atualização do runbook.

---

## MODOS DE EXECUÇÃO

Os scripts em `scripts/dr/` suportam dois modos, controlados via env var:

| Modo                   | Como ativar                                                                                                     | Comportamento                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tabletop** (default) | `TABLETOP=1` (default — qualquer execução sem opt-out)                                                          | Passos destrutivos são apenas **registrados** (`tabletop_run`); pausas humanas são reduzidas a 1 s (`tabletop_pause`); curls a endpoints reais são substituídos por payloads sintéticos (`tabletop_curl`). Executa em ~10 s. Útil para validação trimestral de runbooks. |
| **Live**               | `TABLETOP=0 DRILL_ENV=staging DR_DRILL_CONFIRM=yes-i-am-on-staging BASE_URL=https://staging.clinipharma.com.br` | Drill real contra staging. **NUNCA** rodar contra prod (o `_safety.sh` aborta se BASE_URL parecer produção).                                                                                                                                                             |

Exemplo tabletop trimestral:

```bash
TABLETOP=1 DR_EVIDENCE_DIR=docs/security/dr-evidence/$(date +%Y-%m-%d) \
  bash scripts/dr/01-simulate-db-outage.sh
```

Exemplo live (Q3/2026):

```bash
TABLETOP=0 DRILL_ENV=staging \
DR_DRILL_CONFIRM=yes-i-am-on-staging \
BASE_URL=https://staging.clinipharma.com.br \
DR_EVIDENCE_DIR=docs/security/dr-evidence/$(date +%Y-%m-%d) \
  bash scripts/dr/01-simulate-db-outage.sh
```

---

## SAFETY NET (importante!)

- **Drill live é em STAGING, NUNCA em produção** — validar que `BASE_URL` aponta para staging antes de cada script. O `_safety.sh` aborta se `BASE_URL` parecer prod.
- Snapshot completo do banco staging antes do início.
- 1 SRE designado como "abort owner" — pode interromper o drill a qualquer momento.
- Comunicação interna no canal `#dr-drill` (Slack/Discord).
- Stakeholders externos não notificados (drill silencioso).
- Tabletop pode ser rodado a qualquer momento; live exige janela agendada.

---

## PÓS-DRILL

1. **Pós-mortem consolidado** (em `docs/security/dr-evidence/2026-04-30/postmortem.md`):
   - Cronologia minuto-a-minuto.
   - RTO/RPO medidos vs alvos.
   - Gaps identificados.
   - Action items com owner e prazo.
2. **Atualização de runbooks** com aprendizados.
3. **Apresentação ao Comitê de Risco** em até 7 dias.
4. **Próximo drill** agendado em 6 meses (`docs/runbooks/dr-drill-2026-10.md`).

---

## REFERÊNCIAS

- ISO 22301 (Business Continuity Management)
- NIST SP 800-34 (Contingency Planning Guide)
- Resolução CD/ANPD nº 15/2024 (Comunicação de incidentes)
- LGPD art. 46 (Segurança e adoção de medidas técnicas)
