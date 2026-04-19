# POLÍTICA DE RESPOSTA A INCIDENTES (PRI)

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** SRE Lead + DPO
**Revisão:** anual + após cada incidente SEV-1
**Mapeamento SOC 2:** CC7.3, CC7.4, CC7.5 · **LGPD:** art. 48 · **ANPD:** Resolução CD/ANPD nº 15/2024

---

## 1. PROPÓSITO

Estabelecer o processo formal de detecção, resposta, contenção, erradicação, recuperação e lições aprendidas para incidentes que afetem a segurança, a privacidade, a disponibilidade ou a integridade dos sistemas e dados da Clinipharma.

## 2. DEFINIÇÕES

- **Incidente de Segurança:** evento adverso ou suspeito que comprometa (ou ameace comprometer) a CIA (confidencialidade, integridade, disponibilidade) dos sistemas ou dados.
- **Incidente de Dados Pessoais:** subconjunto que envolve dados pessoais conforme LGPD art. 5º, X. **Acionará obrigação de notificação à ANPD em até 3 dias úteis** se houver risco ou dano relevante (Resolução CD/ANPD nº 15/2024).
- **Vulnerabilidade:** fraqueza identificada que ainda não foi explorada.

## 3. CLASSIFICAÇÃO

| Nível     | Descrição                                               | Exemplos                                                     | RTO comunicação inicial |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- |
| **SEV-1** | Indisponibilidade total OU vazamento de dados sensíveis | DB down; dump exposto; takeover de SUPER_ADMIN               | 15 min                  |
| **SEV-2** | Degradação significativa OU exposição limitada          | latência crítica em pagamentos; erro 500 em 10%+ requisições | 30 min                  |
| **SEV-3** | Degradação parcial sem PII em risco                     | função secundária indisponível; alerta de circuit breaker    | 2h                      |
| **SEV-4** | Anomalia ou alerta de baixo impacto                     | warning de performance; aviso de cota                        | 24h                     |

## 4. PAPÉIS

| Papel                          | Responsabilidade                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| **Incident Commander (IC)**    | SRE on-call. Coordena, comunica, decide. Tem autoridade para acionar qualquer recurso.  |
| **DPO**                        | Avalia se o incidente envolve PII; se sim, conduz a notificação à ANPD e aos titulares. |
| **Diretor Jurídico**           | Avalia exposição legal; aprova comunicações públicas e à ANPD.                          |
| **Comms Lead**                 | Redige e envia comunicações externas (clientes, parceiros, mídia se necessário).        |
| **CEO**                        | Aprova decisões com impacto reputacional/financeiro alto.                               |
| **Tech Subject-Matter Expert** | Engenheiro com expertise no componente afetado.                                         |

## 5. CICLO DE RESPOSTA

### 5.1. Detecção

Fontes:

- Sentry alertas (erro spike, performance).
- Cron `/api/cron/verify-audit-chain`.
- Pagerduty hipotético / on-call rotation.
- Reports de usuários (`security@clinipharma.com.br`).
- Reports de pesquisadores (`/.well-known/security.txt`).

### 5.2. Triagem (≤ 15 min)

- IC abre canal `#incident-YYYYMMDD-NNN` (Slack/Discord).
- Confirma severidade.
- Notifica DPO se houver suspeita de PII envolvida.
- Atualiza status page (`/status`) se SEV-1/2.

### 5.3. Contenção

- Isolar o problema (desabilitar feature flag, remover acesso, bloquear IP).
- Preservar evidência (snapshot, logs, headers).
- Não destruir evidências em busca de cura rápida.

### 5.4. Erradicação

- Identificar a causa raiz.
- Aplicar correção definitiva (não apenas paliativa).
- Validar com testes.

### 5.5. Recuperação

- Restaurar serviço.
- Monitorar 30 min para regressões.
- Atualizar status page.

### 5.6. Pós-mortem (≤ 48h após resolução)

- Usar template `docs/templates/postmortem.md`.
- Análise de causa raiz com 5 Whys.
- Action items com owner e prazo.
- Apresentação em retrospectiva da equipe.

## 6. NOTIFICAÇÃO À ANPD (LGPD art. 48 + Resolução CD/ANPD nº 15/2024)

**Quando notificar:** quando o incidente envolver dados pessoais e puder acarretar **risco ou dano relevante** aos titulares.

**Prazo:** até **3 (três) dias úteis** a partir do momento em que a Clinipharma teve ciência inequívoca do incidente.

**Conteúdo da notificação (art. 48, §1º):**

1. Descrição da natureza dos dados afetados.
2. Informações sobre os titulares envolvidos.
3. Indicação das medidas técnicas e de segurança utilizadas para proteção dos dados.
4. Riscos relacionados.
5. Motivos da demora (se aplicável).
6. Medidas adotadas para reverter ou mitigar.

**Quem aciona:** DPO. Templates em `docs/templates/anpd-incident-notification.md` (a criar).

## 7. NOTIFICAÇÃO A TITULARES

Quando o risco aos titulares for **alto** (ex.: exposição de dados sensíveis), comunicação direta a cada titular afetado, em prazo razoável e linguagem clara, contendo:

- O que aconteceu.
- Quais dados foram afetados.
- O que a Clinipharma fez/está fazendo.
- O que o titular pode fazer (ex.: trocar senha, monitorar conta).
- Canal de contato (DPO).

## 8. COMUNICAÇÃO EXTERNA

- Status page atualizado a cada 30 min durante SEV-1/2.
- Twitter/X corporativo + e-mail aos parceiros para SEV-1.
- Imprensa: somente após alinhamento Diretor Jurídico + CEO.

## 9. EVIDÊNCIAS

Toda evidência arquivada em `docs/security/incidents/YYYY-MM-DD-NNN/`:

- Timeline detalhada.
- Logs e screenshots.
- Comunicações enviadas.
- Pós-mortem.
- Action items com status.

## 10. TREINAMENTO

- Tabletop exercise semestral com cenários hipotéticos.
- DR drill semestral exercitando esta política.
- Onboarding de novos engenheiros inclui treinamento desta política.
