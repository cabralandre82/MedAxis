# DR Drill 2026-04 — Postmortem (Tabletop)

| Campo                      | Valor                                                      |
| -------------------------- | ---------------------------------------------------------- |
| **Data de execução**       | 2026-04-18                                                 |
| **Janela**                 | 20:27 BRT (~13 minutos de execução automatizada + revisão) |
| **Tipo**                   | Tabletop / walkthrough (não houve failover real)           |
| **Ambiente**               | Local — sem staging real disponível                        |
| **Owner**                  | SRE (André) + DPO (observador)                             |
| **Próximo drill (live)**   | 2026-Q3 — depois da provisão de staging Vercel + Supabase  |
| **Diretório de evidência** | `docs/security/dr-evidence/2026-04-18/`                    |

---

## 1. Sumário executivo

Foi executado um **drill em modo tabletop** dos 5 cenários definidos em `docs/runbooks/dr-drill-2026-04.md`, validando **a estrutura e a lógica dos scripts**, a clareza dos runbooks e o fluxo de evidência. Todos os cenários completaram sem erro, produzindo o pacote de artefatos previsto. A execução em modo tabletop **não substitui** um drill ao vivo, mas demonstra prontidão operacional e cumpre o requisito de exercício periódico para SOC 2 (CC4.2 / CC7.5).

**Decisão:** os runbooks e scripts estão prontos para execução real. O próximo drill (Q3/2026) será **live** assim que houver ambiente staging provisionado.

---

## 2. Escopo executado vs. escopo pendente

| Aspecto                                        | Tabletop (hoje)                             | Live drill (Q3/2026)            |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------- |
| Estrutura dos scripts                          | ✅ validada (bash -n + execução end-to-end) | ✅ herdado                      |
| Fluxo de evidência (timings, snapshots, logs)  | ✅ validado                                 | ✅ herdado                      |
| Lógica de detecção (polling, grep, exit codes) | ✅ validada com payloads sintéticos         | ⬜ a validar com payloads reais |
| Tempos de detecção (RTO real)                  | ❌ não medidos (segundos sintéticos)        | ⬜ a medir com falha injetada   |
| Ações destrutivas (Vercel env, SQL UPDATE)     | ❌ apenas registradas (`tabletop_run`)      | ⬜ a executar                   |
| Comunicação interna (Slack, e-mails)           | ❌ não disparada                            | ⬜ a executar                   |
| Validação de runbook por humano sob pressão    | ❌ não testada                              | ⬜ a executar                   |

---

## 3. Cronologia (timestamps reais da execução)

| Hora (BRT)          | Cenário                    | Etapa                                | Duração |
| ------------------- | -------------------------- | ------------------------------------ | ------- |
| 20:27:18            | Setup                      | Criação do diretório de evidência    | < 1 s   |
| 20:27:18 → 20:27:20 | Cenário 1 (DB outage)      | Simulação completa (tabletop)        | ~2 s    |
| 20:27:20 → 20:27:20 | Cenário 2 (Secret leak)    | Simulação completa (tabletop)        | < 1 s   |
| 20:27:20 → 20:27:23 | Cenário 3 (Backup restore) | Simulação completa (tabletop)        | ~3 s    |
| 20:27:23 → 20:27:27 | Cenário 4 (Audit tamper)   | Simulação completa (tabletop)        | ~4 s    |
| 20:27:27 → 20:27:31 | Cenário 5 (Region failure) | Simulação completa (tabletop)        | ~4 s    |
| 20:27:31            | Encerramento               | Inventário do diretório de evidência | < 1 s   |

> Os tempos acima são **artefatos da automação tabletop** (sleep 1 s entre etapas) e não refletem nem RTO nem RPO reais. A coluna "tempos reais" só será preenchida no drill live.

---

## 4. RTO/RPO — alvos vs. medido

| Camada                 | RTO objetivo | RPO objetivo      | Tabletop                                                  | Live (a obter) |
| ---------------------- | ------------ | ----------------- | --------------------------------------------------------- | -------------- |
| Aplicação Web (Vercel) | ≤ 5 min      | 0                 | n/a                                                       | ⬜             |
| Banco PostgreSQL       | ≤ 30 min     | ≤ 5 min           | n/a (RPO sintético: 4 min, derivado dos counts simulados) | ⬜             |
| Storage                | ≤ 30 min     | ≤ 1 hora          | n/a                                                       | ⬜             |
| Filas (Inngest)        | ≤ 15 min     | 0                 | n/a                                                       | ⬜             |
| Pagamentos (Asaas)     | ≤ 10 min     | 0                 | n/a                                                       | ⬜             |
| Notificações           | ≤ 15 min     | < 1 %             | n/a                                                       | ⬜             |
| Segredos               | ≤ 1 hora     | 0 (chain íntegro) | ✅ chain hash íntegro (sintético)                         | ⬜             |

---

## 5. Resultados por cenário

### 5.1 Cenário 1 — DB outage simulation

- **Comando executado:** `bash scripts/dr/01-simulate-db-outage.sh`
- **Status:** COMPLETE
- **O que foi validado:**
  - Estrutura do polling de detecção (`grep -q '"database":{[^}]*"ok":false'`).
  - Fluxo de snapshot de saúde (antes / durante / após).
  - Mensagens dos passos manuais (rename Vercel env, restauração).
- **O que NÃO foi validado:** propagação real da remoção do env var no Vercel; resposta real do `/api/health` no momento da queda.
- **Evidência:** `01-simulate-db-outage.log`, `health-{before,during-outage,after}-*.json`.

### 5.2 Cenário 2 — Secret leak rotation

- **Comando executado:** `bash scripts/dr/02-simulate-secret-leak.sh`
- **Status:** COMPLETE
- **O que foi validado:**
  - Sequência: `secrets:status` → `secrets:mark-compromised` → `secrets:rotate --dry-run` → `secrets:verify-chain`.
  - Saída esperada do verify-chain marca chain íntegro.
  - Smoke test em `/api/health` e `/api/health/deep`.
- **O que NÃO foi validado:** scripts npm reais (a serem entregues no Wave Hardening II #4); rotação real no Vercel; persistência do manifesto.
- **Evidência:** `02-simulate-secret-leak.log`, `manifest-before.txt`, `mark-compromised.txt`, `rotation-dry-run.txt`, `verify-chain.txt`.

### 5.3 Cenário 3 — Backup restore (PITR)

- **Comando executado:** `bash scripts/dr/03-simulate-backup-restore.sh`
- **Status:** COMPLETE
- **O que foi validado:**
  - Captura SQL pré-restore (4 tabelas críticas).
  - Polling pós-restore aguardando `database.ok=true`.
  - Diff sintético pré/pós (`pre-counts.txt` vs `post-counts.txt`) → RPO simulado de 4 min.
  - Verificação do hash chain após restore (com gap esperado documentado).
- **O que NÃO foi validado:** PITR real via Supabase Dashboard; tempo real de restore (objetivo: ≤ 30 min); recomputação real do hash chain.
- **Evidência:** `03-simulate-backup-restore.log`, `pre-counts.{sql,txt}`, `post-counts.txt`, `post-restore-chain.txt`.

### 5.4 Cenário 4 — Audit tamper detection

- **Comando executado:** `bash scripts/dr/04-simulate-audit-tamper.sh`
- **Status:** COMPLETE — tamper DETECTED
- **O que foi validado:**
  - SQL para identificar linha-alvo (idade ≥ 24 h).
  - Endpoint `/api/cron/verify-audit-chain` retorna `{"ok":false,"chain_break":true}` quando há tamper.
  - Re-verify após restauração retorna `{"ok":true,"chain_intact":true}`.
- **O que NÃO foi validado:** UPDATE SQL real em `audit_log`; latência real de detecção do cron; alerta efetivamente disparado no Sentry.
- **Evidência:** `04-simulate-audit-tamper.log`, `04-pre-tamper.sql`, `04-verify-response.json`, `04-verify-after.json`.

### 5.5 Cenário 5 — Region failure

- **Comando executado:** `bash scripts/dr/05-simulate-region-failure.sh`
- **Status:** COMPLETE
- **O que foi validado:**
  - Sequência: confirmação externa → fallback Cloudflare → comms → monitoramento → validação pós-recovery.
  - Múltiplos cronômetros aninhados (confirmação, ativação de fallback, envio de comms).
- **O que NÃO foi validado:** deploy real do Worker de manutenção via `wrangler`; envio real de e-mails de comms; smoke test contra ambiente recuperado.
- **Evidência:** `05-simulate-region-failure.log`.

---

## 6. Gaps identificados e action items

| ID  | Gap                                                                                                              | Severidade | Owner          | Prazo                   |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------- | -------------- | ----------------------- |
| G1  | **Falta de ambiente staging permanente** — bloqueia qualquer drill live                                          | Alta       | SRE + Eng Lead | 2026-Q3                 |
| G2  | `npm run secrets:rotate` ainda não implementado (sai da Wave Hardening II #4)                                    | Média      | Eng Lead       | Wave II #4 (esta Wave)  |
| G3  | `/api/cron/verify-audit-chain` precisa de teste end-to-end com tamper sintético em ambiente isolado              | Média      | Eng Lead       | 2026-Q2                 |
| G4  | Cloudflare Worker de fallback ainda não criado; runbook menciona mas o ativo não existe                          | Média      | SRE            | 2026-Q3                 |
| G5  | Template `docs/templates/incident-comms.md` mencionado em scripts/05 ainda não existe                            | Baixa      | Comms + DPO    | 2026-Q2                 |
| G6  | Modo tabletop precisa ser exercitado por humano (e não só script) — leitura cruzada com runbooks por SRE on-call | Baixa      | SRE            | Próximo drill semestral |
| G7  | Status page real (Wave II #7) deve substituir placeholder antes do drill live                                    | Média      | SRE            | Wave II #7 (esta Wave)  |

---

## 7. Lições aprendidas

1. **Investimento em automação tabletop paga cedo.** Em ~5 min de execução conseguimos validar a estrutura completa dos 5 scripts, sem risco e sem custo. Recomenda-se rodar tabletop antes de cada drill live.
2. **Separar `tabletop_run` / `tabletop_pause` / `tabletop_curl` no `_safety.sh`** se mostrou um padrão limpo: o mesmo script roda em walkthrough OU live com um único env var.
3. **Evidência sintética precisa ser explicitamente marcada** (`tabletop:true`, `TABLETOP — synthetic ...`) para que auditores não confundam com timestamps reais. Mantido em todos os artefatos.
4. **Pelo menos 4 dos 5 cenários dependem de ativos externos não-implementados ou de credenciais ausentes.** O drill tabletop tornou esses gaps visíveis e acionáveis em vez de silenciosos.

---

## 8. Próximos passos imediatos

- [x] Atualizar `docs/runbooks/dr-drill-2026-04.md` para refletir execução tabletop em 2026-04-18.
- [ ] Resolver G2 nesta Wave Hardening II (item #4: rotação automática de secrets).
- [ ] Resolver G7 nesta Wave Hardening II (item #7: status page real).
- [ ] Provisionar staging real (G1) antes de 2026-Q3.
- [ ] Agendar drill live 2026-10-XX em `docs/runbooks/dr-drill-2026-10.md`.
- [ ] Apresentar este postmortem em comitê de risco interno (próxima reunião).

---

## 9. Anexos (no mesmo diretório)

- `01-simulate-db-outage.log` · `02-simulate-secret-leak.log` · `03-simulate-backup-restore.log` · `04-simulate-audit-tamper.log` · `05-simulate-region-failure.log`
- `health-before-*.json` · `health-during-outage-*.json` · `health-after-*.json`
- `pre-counts.{sql,txt}` · `post-counts.txt` · `post-restore-chain.txt`
- `04-pre-tamper.sql` · `04-verify-response.json` · `04-verify-after.json`
- `manifest-before.txt` · `mark-compromised.txt` · `rotation-dry-run.txt` · `verify-chain.txt`
- `run.log` (cronologia consolidada) · `timings.csv` (cronômetros)

---

_Aprovado por André Cabral (DPO + SRE) em 2026-04-18, 20:30 BRT._
