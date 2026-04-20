# Solo Operator — modelo operacional

| Field      | Value                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Owner      | @cabralandre82 (único operador)                                                                                       |
| Escopo     | Operação diária da plataforma Clinipharma                                                                             |
| Atualizado | 2026-04-19                                                                                                            |
| Pareia com | [`AGENTS.md`](../AGENTS.md), [`.cursor/rules/`](../.cursor/rules/), [`docs/runbooks/README.md`](./runbooks/README.md) |

> **Premissa**: um humano + N agentes de IA. O humano é **aprovador**,
> não executor. Cada automação descrita aqui é uma decisão consciente
> de transferir trabalho para um loop que roda sozinho, ou para um
> agente sob instrução. Nada aqui existe "porque é legal" — cada item
> substitui algo que senão um time de 3-5 pessoas faria.

---

## 1. A matriz: humano vs agente autônomo

A regra de ouro: **se pode ser descrito num runbook, pode rodar sem você**.

| Atividade                                                     | Quem                                                    | Por quê                                           |
| ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Triagem de Dependabot low/medium                              | Agente autônomo                                         | Já padronizado; humano aprova merge               |
| Triagem de Dependabot critical/high                           | Humano                                                  | Pode exigir análise de exploração                 |
| Investigação de erro Sentry novo                              | Agente autônomo (primeira passagem) → humano aprova PR  | Stack trace + diff costuma ser suficiente         |
| Investigação de erro Sentry recorrente (>N/h)                 | Humano                                                  | Há padrão mais profundo a descobrir               |
| Resposta a alerta ZAP / schema-drift / audit-chain / DR drill | Agente executa runbook; humano aprova ação              | Todos têm runbooks exatos                         |
| DSAR recebido (LGPD 15d)                                      | Agente colhe + monta pacote; humano envia               | Legalmente o operador é responsável pela resposta |
| Legal hold                                                    | Humano                                                  | Pedido judicial, zero espaço para erro            |
| Breach response primeiras 4h                                  | Humano + agente em paralelo                             | Runbook dirige, humano decide                     |
| Breach response horas 4-72 (follow-up ANPD)                   | Humano com agente ghost-writer                          | Comunicação jurídica não delega                   |
| Onboarding de nova farmácia/clínica                           | Agente prepara comms, configura, humano aprova          | Checklist automatizável                           |
| Code review de PR de agente                                   | Humano                                                  | Sempre                                            |
| Code review de PR humano                                      | N/A (é você)                                            | Leitura cruzada c/ agente pode ajudar             |
| Merge de PR em main                                           | Humano (ou agente com `--admin` em casos pré-definidos) | Ver "auto-merge policy" abaixo                    |
| Rotação de chaves (90d)                                       | Agente abre PR; humano aprova                           | Runbook `secret-rotation.md`                      |
| Disparo semanal de mutation / DAST / load tests               | Cron automático                                         | Já rodando                                        |
| Review financeiro (Vercel + Supabase + Upstash + Sentry)      | Humano, 15 min semanais                                 | Agente pode propor, não aprova spend              |
| Mudanças de pricing / contratual                              | Humano                                                  | Decisão de negócio, não técnica                   |
| Customer support L1 (dúvidas de uso)                          | Agente com escalação                                    | Documentação + IA costumam resolver               |
| Customer support L2 (bug, falta funcionalidade)               | Humano                                                  | Requer decisão de produto                         |

### Auto-merge policy (quando agente pode mergear sem você)

Permitido **só** se TODOS os critérios abaixo forem verdade:

1. Mudança tocada está em um destes escopos:
   - `docs/**` (exceto `docs/legal/**`, `docs/security/**`)
   - `README.md`, `CHANGELOG.md`
   - `.github/workflows/**` — apenas typos/refinamentos já aprovados
     via runbook, nunca novo workflow
   - `package-lock.json` (só lockfile, sem mudança de `package.json`)
2. CI + Security Scan passaram verdes.
3. A mudança NÃO toca nenhum arquivo listado no frontmatter de
   `.cursor/rules/security.mdc`, `compliance.mdc`, `database.mdc`.
4. O diff é ≤ 30 linhas.
5. Runbook específico autoriza (ex.: `docs/runbooks/dependabot-auto-merge.md`).

Qualquer outra mudança: humano aprova antes do merge.

---

## 2. Ritmo operacional

### Daily — 15 min

Execute em qualquer momento do dia, idealmente antes do primeiro bloco
de foco. O objetivo é sincronizar, não investigar.

1. Abrir [Sentry Issues](https://sentry.io/) → filtrar por "Unresolved last 24h". Target: 0 novos.
2. `gh issue list --label security,zap-baseline-finding,audit-chain,schema-drift --state open`
3. Olhar o dashboard de cron runs (Vercel) — algum falhou nas últimas 24h?
4. Ler e fechar notificações de PRs agentes abertos.

**Se tudo verde: 5 minutos. Siga com o dia.**
Se algo vermelho: abrir o runbook relevante; se você não sabe qual,
fallback é `docs/runbooks/README.md` (índice).

### Weekly — 30 min (segunda, antes do foco)

O ritual mais importante. Pule isso e você acorda num sábado com
surpresa.

1. **Dashboards** (5 min):
   - SLO burn-rate: `docs/observability/slos.md` → verificar gráficos.
     Nenhum error budget em < 50%?
   - Taxa de login, taxa de conversão de pedidos.

2. **Issues** (5 min):
   - Todas as issues com label `security` triadas ou fechadas?
   - Nada com > 14d em `needs-triage`?
   - Issue de claims-audit semanal (label `claims-audit`, abre terça 06 UTC): triar warnings, fechar ao resolver. Ver [`docs/operations/claims-audit.md`](./operations/claims-audit.md).
   - Dependabot PRs abertas > 7 dias OU com label `do-not-auto-merge`: triar manualmente. Ver [`docs/runbooks/dependabot-auto-merge.md`](./runbooks/dependabot-auto-merge.md).

3. **Custos** (10 min):
   - Vercel bill running este mês
   - Supabase bill + DB size
   - Upstash req count + eviction
   - Sentry events + quota
   - OpenAI/Anthropic (se configurado): tokens gastos
   - Comparar com `docs/operations/budget.md` (linha da previsão)

4. **Pessoas** (5 min):
   - Emails atrasados com clientes/parceiros?
   - DSAR queue vazia?
   - Alguma solicitação de integração pendente?

5. **Próxima semana** (5 min):
   - Escolher 1 (UM) tema estrutural para avançar. WIP=1.
   - Registrar em `docs/execution-log.md`.

### Monthly — 1h (último domingo do mês)

Ritual de saúde do produto, não operação.

1. Rodar o "state-of-the-platform" review: re-pontuar as dimensões
   do scorecard (Security, Observability, Tests, A11y, DB, Compliance).
2. Atualizar `docs/execution-log.md` com highlight do mês.
3. Atualizar `docs/operations/budget.md` com real vs previsto.
4. 2026-Q2 em diante: revisar `docs/compliance/subprocessors.md` —
   nenhum DPA vencido?
5. Rodar backup restore drill se o mês marca trimestre (Jan/Abr/Jul/Out).

### Quarterly — 2h

- Pentest interno rodado? (Se não, escopar um.)
- Secret rotation ciclo completo? (90d)
- Threat model revisado? (`docs/security/threat-model.md`)
- Legal / counsel review agendada?
- Evidência SOC2 coletada do trimestre (`docs/compliance/soc2/evidence-collection.md`).

### Annually — 1 dia

- DR drill multi-cenário completo com evidência fotográfica.
- Review de counsel (legal) — `docs/legal/REVIEW-YYYY-MM-DD.md`.
- Re-scoring scorecard com auditor externo ou amigo técnico.
- Atualizar este arquivo.

---

## 3. Loops automatizados (hoje, em produção)

Cada linha substitui trabalho humano que senão seria recorrente.

| Loop                       | Workflow                    | Cadência              | Gate                         | SLA de resposta                                       |
| -------------------------- | --------------------------- | --------------------- | ---------------------------- | ----------------------------------------------------- |
| L1 In-cluster probe        | `/api/cron/synthetic-probe` | 5 min                 | 3 falhas consecutivas        | < 10 min (page via Sentry)                            |
| L2 External probe          | `external-probe.yml`        | 5 min                 | 2 falhas consecutivas        | < 10 min (issue + optional email)                     |
| L3 DAST                    | `zap-baseline.yml`          | Semanal Mon 07:00 UTC | Medium+ finding              | 24h                                                   |
| Mutation test              | `mutation-test.yml`         | PRs + semanal         | < 84%                        | mesmo ciclo do PR                                     |
| Schema drift               | `schema-drift.yml`          | Cada PR + cron        | divergência                  | 24h                                                   |
| Audit chain verify         | `verify-audit-chain` cron   | Diário 03:45 UTC      | broken hash                  | imediato (P1)                                         |
| DR restore drill           | `restore-drill.yml`         | Mensal                | falha de restore             | 72h triagem                                           |
| Retention purge            | `enforce-retention` cron    | Mensal dia 1 02:00    | erro no purge                | 24h                                                   |
| DSAR SLA                   | `expire-doc-deadlines` cron | Diário 06:00          | DSAR > 10d sem fulfillment   | 48h                                                   |
| Stale orders               | `stale-orders` cron         | Diário 08:00          | ordens paradas > X           | 7d                                                    |
| Churn detection            | `churn-check` cron          | Diário 07:30          | farmácia inativa > N dias    | 7d                                                    |
| Coupon expiry              | `coupon-expiry-alerts` cron | Diário 09:00          | expiração próxima            | informativo                                           |
| Reorder alerts             | `reorder-alerts` cron       | Diário 07:00          | estoque baixo                | informativo                                           |
| Cost guard                 | `cost-guard.yml`            | Semanal               | threshold                    | 48h (ver [cost-guard](./operations/cost-guard.md))    |
| Claims audit               | `claims-audit.yml`          | Semanal (ter 06 UTC)  | `fail` ≥ 1 OU warnings > 0   | 7d (ver [claims-audit](./operations/claims-audit.md)) |
| Secret rotation reminder   | (manual por enquanto)       | 90d                   | vencida > 0d                 | 7d                                                    |
| Dependabot                 | GitHub nativo               | Diário                | critical/high                | 72h                                                   |
| Dependabot auto-merge      | `dependabot-auto-merge.yml` | A cada PR do bot      | CI vermelho OU classe manual | via CI (mesmo SLA do PR)                              |
| CodeQL + Trivy + npm audit | `security-scan.yml`         | Push + semanal        | new CVE                      | 7d                                                    |

**Princípio**: cada loop tem:

- Um trigger (cron, evento, push)
- Um gate (quando alerta)
- Um destino de alerta (issue GitHub, Sentry, email)
- Um runbook (`docs/runbooks/<nome>.md`)
- Um SLA

Qualquer automação que não tenha os 5 acima não deveria existir —
vira ruído.

---

## 4. O que NÃO automatizar (consciente)

Automatizar errado cria risco maior que o trabalho manual. Casos:

1. **Decisões de produto**. Um agente pode implementar, nunca decidir
   O QUE fazer. Roadmap é humano.
2. **Comunicação com ANPD / autoridade**. Mesmo o draft: você revisa
   palavra por palavra.
3. **Comunicação com cliente em incidente**. Automação manda
   templates; nunca escreve "do zero".
4. **Transações financeiras > R$ X** (X a definir). Exigir confirmação
   humana acima do limiar.
5. **Grant de permissões elevadas** (admin/staff). Sempre manual, via
   runbook `staff-permission-grant.md`.
6. **Aprovação de migration SQL** que toca `audit_logs`, `money_*`,
   ou drop de coluna.
7. **Deploy em produção fora do CI** (ex.: `vercel --prod` manual).
   Existe apenas como emergency break-glass.

---

## 5. Stop signals (pare e pense)

Você está solo. Os sinais abaixo significam: **pare de executar,
escreva, respire**.

- **> 3 incidentes P1/P2 simultâneos** → escalar para o runbook de
  `multi-incident-response.md` (priorizar, não heroically resolver).
- **Mais de 1 merge por hora por > 3h** → você está catando problema,
  não construindo. Pare. Descubra o tema.
- **Você escreveu código às 2h da manhã sem emergency** → ruim. Só
  emergencies valem a pena ao custo de sono.
- **Você fez > 2 commits com "WIP"/"fix fix"/"tentando"** → reverta,
  abra um runbook do problema, trate como bug com reprodução.
- **Agente sugeriu mudança que você não entende** → NÃO merge. Peça
  ao agente pra explicar em 3 frases. Se as 3 frases não convencem,
  rejeite.

---

## 6. Cenários de desastre operacional

### 6.1 Você está doente por 3 dias

- Todos os crons continuam rodando.
- Dependabot PRs acumulam — ok até uma semana.
- DSARs: você tem 15 dias, então 3 dias de atraso não é crítico;
  mas logue em `docs/execution-log.md`.
- **Único item que NÃO pode atrasar**: audit-chain-tampered alert.
  Delegue um suplente (amigo técnico + `CONTINGENCY.md` com instruções).
- Automação: setar auto-reply no email de contato.

### 6.2 Você viaja por 2 semanas

- Pré-viagem: rodar weekly ritual + monthly ritual antes.
- Configurar um colega/amigo como "suplente de operação" com acesso
  read-only ao Sentry + GitHub issues.
- Durante: bloco diário de 15 min com a lista do daily. Nada mais.
- Pós: rodar weekly completo antes de fazer qualquer feature work.

### 6.3 Você quer pivotar / pausar o produto

- Congele novos cadastros (flag em `feature_flags` — migration 044).
- Envie notificação de 30 dias a todos os clientes ativos (LGPD
  artigo 9º — direito à informação).
- Execute DSAR automático para todos os titulares que solicitarem.
- Após 30 dias, mova para modo "manutenção" — apenas DSAR + download
  de dados.
- Conserve logs por 5 anos (tax + tax auditing).
- Seu cargo DPO (se formalizado) continua ativo até o shutdown completo.

### 6.4 Agente fez algo catastrófico (apagou tabela, quebrou prod)

- **Não entre em pânico**: temos backup de 30 dias em GCS encrypted
  (age) + restore testado em DR drill.
- Runbook: `docs/runbooks/emergency-restore.md`.
- Tempo-médio-de-restore medido no último drill: ~24 min.
- Audit chain permite reconstruir a sequência de eventos.

---

## 7. Investimentos que ainda valem a pena (futuro)

Tracking items para não esquecer. Prioridade em [N] (1=alta).

- [ ] **Cost-guard com tokens reais** (Vercel/Supabase/Upstash API).
      Hoje é manual. Estimativa: 1 dia de trabalho. [2]
- [ ] **Cloud-agent triage workflow** — Sentry new error → agente
      abre PR de investigação. Estimativa: 1 dia. [2]
- [ ] **Runbooks como skills** — cada `docs/runbooks/*.md` ganha
      par em `.cursor/skills/`. Incremental. [3]
- [ ] **Pentest externo anual** — primeira rodada paga, formal.
      Orçar: R$ 15-30k. [2]
- [ ] **Bug bounty program** — começar com scope pequeno
      (security.txt já documenta safe harbor). [3]
- [ ] **Staff mode / admin audit view** — UI para visualizar audit
      chain e executar operações staff. [3]
- [ ] **SOC2 Type I** — evidência já sendo coletada em
      `docs/compliance/soc2/`. Último passo: auditor externo. [3]

---

## 8. O que esta plataforma PROVA (para você, no futuro)

Se alguém questionar (auditor, counsel, parceiro):

- **Segurança**: CodeQL + Trivy + mutation ≥ 84% + ZAP baseline
  semanal + CSP + HSTS + DR drill evidência.
- **Privacidade**: RLS estrito + audit-chain + DSAR auto + retention
  - subprocessor inventory + 72h breach runbook.
- **Disponibilidade**: 3 camadas de synthetic monitoring + SLOs
  documentados + DR drill medido + burn-rate alerts.
- **Observabilidade**: logger estruturado + metrics + Sentry + traces
  - 20+ runbooks operacionais.
- **Qualidade**: ~1900 unit tests + Playwright E2E + a11y strict WCAG
  2.1 AA + k6 load + mutation-tested critical surface.
- **Operação**: runbooks rehearsed (audit-tamper, restore, schema-drift,
  DAST), 15+ crons automatizados, autonomous triage.

Nada disso é teatro. Cada item tem uma evidência versionada no repo.

---

## 9. Changelog

| Data       | Mudança                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 2026-04-19 | Criação inicial. Wave Hardening III — C.4 (DAST) concluído. Plataforma pronta para onboarding. |
