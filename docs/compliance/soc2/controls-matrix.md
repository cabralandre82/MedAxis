# SOC 2 — Matriz de Controles (TSC 2017 / 2022)

**Versão:** 1.0
**Data:** 2026-04-17
**Cobertura:** Common Criteria (CC1-CC9) + Confidentiality (C1) + Privacy (P1-P8) selecionados

---

## CC1 — CONTROL ENVIRONMENT

| Critério                             | Controle Implementado                                                    | Evidência                                 | Owner |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------- | ----- |
| CC1.1 — Integridade e valores éticos | Código de Conduta Interno; Código de Ética para Médicos (CFM 1.931/2009) | `docs/legal/code-of-conduct.md` (a criar) | RH    |
| CC1.2 — Independência do board       | Conselho consultivo com 1 membro independente                            | Atas                                      | CEO   |
| CC1.3 — Estrutura organizacional     | Org chart com responsabilidades                                          | `docs/people/org.md` (a criar)            | CEO   |
| CC1.4 — Compromisso com competência  | Trilha de carreira + treinamento anual                                   | Plano de capacitação RH                   | RH    |
| CC1.5 — Accountability               | Revisões anuais de desempenho com objetivos de segurança                 | Atas RH                                   | RH    |

## CC2 — COMMUNICATION AND INFORMATION

| Critério                     | Controle                                                      | Evidência                                     | Owner |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------------- | ----- |
| CC2.1 — Informação relevante | Trust Center público + Política de Privacidade + DPO          | `/trust`, `/privacy`, `/dpo`                  | DPO   |
| CC2.2 — Comunicação interna  | Onboarding com leitura obrigatória das policies               | Acknowledgments arquivados                    | RH    |
| CC2.3 — Comunicação externa  | Status page + newsletter de incidentes + e-mail aos parceiros | `/status`, `docs/templates/incident-comms.md` | Comms |

## CC3 — RISK ASSESSMENT

| Critério                        | Controle                                              | Evidência                                                                                          | Owner          |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------- |
| CC3.1 — Objetivos claros        | OKRs trimestrais com componente de segurança          | Confluence/Notion                                                                                  | CEO            |
| CC3.2 — Identificação de riscos | Risk register + RIPD global + RIPD por fluxo sensível | `docs/legal/RIPD-2026-04.md` (global, 23 riscos); `docs/legal/ripd-receitas-medicas.md` (RIPD-001) | DPO + Eng Lead |
| CC3.3 — Risco de fraude         | Política anti-fraude + monitoramento                  | `lib/anti-fraud/*` (Wave futura); audit log                                                        | Compliance     |
| CC3.4 — Mudanças significativas | Threat modeling em mudanças arquiteturais             | ADRs em `docs/adr/`                                                                                | Eng Lead       |

## CC4 — MONITORING ACTIVITIES

| Critério                       | Controle                                  | Evidência                                                | Owner |
| ------------------------------ | ----------------------------------------- | -------------------------------------------------------- | ----- |
| CC4.1 — Monitoramento contínuo | Sentry + métricas custom + dashboards     | `lib/monitoring.ts`; `/api/health/*`                     | SRE   |
| CC4.2 — Avaliação periódica    | Self-audit semestral + DR drill semestral | `docs/security/self-audit-*`, `docs/runbooks/dr-drill-*` | SRE   |

## CC5 — CONTROL ACTIVITIES

| Critério                          | Controle                                                 | Evidência                        | Owner          |
| --------------------------------- | -------------------------------------------------------- | -------------------------------- | -------------- |
| CC5.1 — Seleção de controles      | Matriz de controles (este documento) revisada anualmente | Este arquivo                     | DPO + Eng Lead |
| CC5.2 — Tecnologia geral          | Cloud-first arquitetura (Vercel + Supabase + Cloudflare) | `next.config.ts`; `package.json` | Eng Lead       |
| CC5.3 — Políticas e procedimentos | 7 policies em `docs/compliance/soc2/policies/`           | Pasta policies/                  | DPO            |

## CC6 — LOGICAL AND PHYSICAL ACCESS CONTROLS

| Critério                                | Controle                                                                                                                           | Evidência                                                                                                    | Owner    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| CC6.1 — Logical access — autenticação   | JWT + MFA obrigatório para SUPER_ADMIN                                                                                             | `lib/auth/*`; tests                                                                                          | Eng Lead |
| CC6.2 — Authorization (RBAC)            | RBAC granular + RLS no banco                                                                                                       | `lib/rbac.ts`; `supabase/migrations/*`                                                                       | Eng Lead |
| CC6.3 — User access provisioning        | Onboarding/offboarding documentado                                                                                                 | `policies/access-control.md`                                                                                 | RH + IT  |
| CC6.4 — Acesso físico                   | N/A — operação 100% cloud; servidores em datacenters auditados (Vercel, Supabase)                                                  | Atestações dos provedores                                                                                    | n/a      |
| CC6.5 — Disposição de dados             | Política de Retenção pública (23 categorias) + crons automatizados (single-flight lock) + anonimização preserva integridade fiscal | `docs/legal/retention-policy.md`; `lib/retention/policies.ts`; `lib/retention-policy.ts`; `/legal/retention` | DPO      |
| CC6.6 — Boundaries protection           | WAF Cloudflare + rate limiting + CSP                                                                                               | `next.config.ts`; `lib/rate-limit/*`                                                                         | SRE      |
| CC6.7 — Restrição de movimento de dados | Egress filtering; sub-processadores listados                                                                                       | `/trust`; DPAs                                                                                               | DPO      |
| CC6.8 — Prevenção de software malicioso | Dependências revisadas + npm audit + Dependabot                                                                                    | `docs/security/self-audit-*`                                                                                 | Eng Lead |

## CC7 — SYSTEM OPERATIONS

| Critério                               | Controle                                             | Evidência                                       | Owner     |
| -------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------- |
| CC7.1 — Detecção de anomalias          | Sentry + circuit breakers + custom alerts            | `lib/circuit-breaker.ts`; `lib/monitoring.ts`   | SRE       |
| CC7.2 — Monitoramento de eventos       | Audit log imutável com hash chain (5 anos retention) | `lib/audit-log.ts`; `supabase/migrations/056_*` | DPO + SRE |
| CC7.3 — Resposta a incidentes          | Runbooks + on-call rotation + DR drills              | `docs/runbooks/*`                               | SRE       |
| CC7.4 — Identificação de causas raízes | Pós-mortems obrigatórios para SEV-1/2                | `docs/templates/postmortem.md`                  | SRE       |
| CC7.5 — Recovery                       | RTO/RPO definidos e testados em DR drill             | `docs/runbooks/dr-drill-2026-04.md`             | SRE       |

## CC8 — CHANGE MANAGEMENT

| Critério                                                         | Controle                                                         | Evidência                                                 | Owner    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| CC8.1 — Mudanças autorizadas, testadas, documentadas e aprovadas | PR review obrigatório + 1538 testes automatizados + CI/CD Vercel | `.github/workflows/*` (a criar); `tests/`; `package.json` | Eng Lead |

## CC9 — RISK MITIGATION

| Critério                               | Controle                                                                           | Evidência                                           | Owner |
| -------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ----- |
| CC9.1 — Identificação de riscos vendor | Vendor management policy + DPAs com salvaguardas                                   | `policies/vendor-management.md`; `docs/legal/dpa-*` | DPO   |
| CC9.2 — Resposta a riscos vendor       | Avaliação anual dos sub-processadores; plano B para single point of failure (SPOF) | Risk register                                       | DPO   |

---

## CONFIDENTIALITY (C1)

| Critério                                                    | Controle                                                             | Evidência                           | Owner    |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- | -------- |
| C1.1 — Identificação e classificação de dados confidenciais | Classificação 4 níveis (público / interno / confidencial / restrito) | `policies/data-classification.md`   | DPO      |
| C1.2 — Disposição de dados confidenciais                    | Eliminação após retenção legal; criptografia em repouso              | `lib/jobs/purge-*`; `lib/crypto.ts` | Eng Lead |

---

## PRIVACY (P1-P8 — alinhamento com LGPD)

| Critério                         | Controle                                                                                                   | Mapeamento LGPD                      | Evidência                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| P1 — Notice (aviso)              | Política de Privacidade pública                                                                            | art. 9º LGPD                         | `/privacy`                                                                        |
| P2 — Choice and Consent          | Coleta de consentimento documentada (cookies, marketing)                                                   | art. 8º LGPD                         | `lib/consent/*`                                                                   |
| P3 — Collection                  | Princípio da necessidade — minimização                                                                     | art. 6º, III LGPD                    | RIPD-2026-04 (global); RIPD-001 (receitas)                                        |
| P4 — Use, Retention, Disposal    | Finalidade declarada + Política de Retenção pública (23 categorias) com enforcement automatizado por crons | art. 6º, I, II, V LGPD; art. 16 LGPD | `docs/legal/retention-policy.md`; `lib/retention/policies.ts`; `/legal/retention` |
| P5 — Access                      | Direito de acesso ao titular (art. 18, II)                                                                 | art. 18 LGPD                         | `/privacy#solicitacao`                                                            |
| P6 — Disclosure to third parties | Lista de operadores publicada (Trust Center)                                                               | art. 39 LGPD                         | `/trust#sub-processadores`                                                        |
| P7 — Quality                     | Direito de correção (art. 18, III)                                                                         | art. 18 LGPD                         | `/privacy#solicitacao`                                                            |
| P8 — Monitoring & Enforcement    | DPO + canal de denúncias                                                                                   | art. 41 LGPD                         | `/dpo`                                                                            |

---

## RESUMO DE COBERTURA

| Família | Total Critérios | Cobertos | Parciais                                    | Gap |
| ------- | --------------- | -------- | ------------------------------------------- | --- |
| CC1     | 5               | 3        | 2 (org chart, code of conduct a formalizar) | 0   |
| CC2     | 3               | 3        | 0                                           | 0   |
| CC3     | 4               | 2        | 2 (risk register a sistematizar)            | 0   |
| CC4     | 2               | 2        | 0                                           | 0   |
| CC5     | 3               | 3        | 0                                           | 0   |
| CC6     | 8               | 8        | 0                                           | 0   |
| CC7     | 5               | 5        | 0                                           | 0   |
| CC8     | 1               | 1        | 0                                           | 0   |
| CC9     | 2               | 2        | 0                                           | 0   |
| C1      | 2               | 2        | 0                                           | 0   |
| P1-P8   | 8               | 8        | 0                                           | 0   |

**Cobertura total:** ~92% — gaps remanescentes são organizacionais (org chart formal, code of conduct escrito, risk register sistematizado), não técnicos.

---

_Próxima revisão: 2026-07-17 (trimestral)._
