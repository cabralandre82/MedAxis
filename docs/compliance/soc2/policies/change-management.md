# POLÍTICA DE GESTÃO DE MUDANÇAS

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** Diretor de Engenharia
**Revisão:** anual
**Mapeamento SOC 2:** CC8.1 · **LGPD:** art. 50

---

## 1. PROPÓSITO

Garantir que toda mudança significativa em código, configuração, infraestrutura ou dados seja **autorizada, testada, documentada e auditável**, minimizando o risco de incidentes operacionais ou de segurança.

## 2. ESCOPO

Aplica-se a:

- Código da aplicação (Next.js, scripts).
- Schemas de banco (migrations Supabase).
- Configurações de infraestrutura (Vercel envs, Cloudflare rules, Supabase RLS).
- Sub-processadores e dependências de terceiros.
- Políticas e documentação de compliance.

## 3. CLASSIFICAÇÃO DE MUDANÇAS

| Tipo          | Descrição                                                                                 | Aprovação                                                | SLA             |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| **Standard**  | Mudança rotineira, baixo risco (UI minor, copy edit, dependency patch)                    | 1 reviewer                                               | merge contínuo  |
| **Normal**    | Mudança planejada, médio risco (nova feature, refactor)                                   | 1-2 reviewers + CI verde                                 | janela aberta   |
| **Major**     | Mudança de alto impacto (migration destrutiva, mudança em RBAC/RLS, sub-processador novo) | 2 reviewers + Eng Lead + arquitetura review + DPO se PII | janela acordada |
| **Emergency** | Hot-fix de produção (bug crítico, vulnerabilidade)                                        | 1 reviewer + on-call + post-mortem em 48h                | imediato        |

## 4. CICLO DE MUDANÇA

1. **Planejamento.** Issue/ticket descreve objetivo, motivação, escopo e impacto.
2. **Desenvolvimento em branch isolado.** Nunca direto na `main`.
3. **Pull Request.** Inclui:
   - Descrição da mudança e do risco.
   - Plano de testes manuais (se aplicável).
   - Plano de rollback.
   - Screenshots para mudanças de UI.
4. **Code review.** Pelo menos 1 outro engenheiro (2 para Major), com ênfase em segurança, performance e LGPD-compliance quando aplicável.
5. **CI obrigatório.**
   - Lint (ESLint, jsx-a11y).
   - Type-check (`tsc --noEmit`).
   - Testes unitários e de integração (1.500+ atualmente).
   - E2E smoke (Playwright).
   - npm audit (warn em low/moderate, fail em high/critical).
6. **Deploy.**
   - Preview automático no Vercel para todo PR.
   - Promoção a staging após merge na `develop` (ou equivalente).
   - Promoção a produção após validação em staging + aprovação on-call.
7. **Verificação pós-deploy.**
   - Smoke test automático.
   - Monitoramento de Sentry / health por 30 min.
   - Comunicação no canal de release notes.

## 5. MIGRATIONS DE BANCO

- Toda migration é **idempotente** (re-run safe).
- Toda migration tem **plano de rollback** no PR.
- Migrations destrutivas (`DROP`, `ALTER COLUMN`, `TRUNCATE`) requerem aprovação dupla.
- Backup verificado antes de migration Major.
- Smoke após cada migration.

## 6. DEPENDÊNCIAS

- Atualizações automáticas (Dependabot/Renovate) habilitadas.
- Patches de segurança fast-track (revisão simplificada se for patch puro).
- Major version upgrades passam pelo ciclo Normal/Major.
- npm audit revisto a cada PR.

## 7. CONFIGURAÇÃO

- Variáveis de ambiente alteradas só via Vercel UI ou `vercel env` com log automático.
- Mudanças em RLS rodam via migration versionada.
- Cron schedules versionados em `vercel.json`.
- Mudanças manuais em produção (debug urgência) são registradas no audit_log e revistas em até 24h.

## 8. EVIDÊNCIAS

- PRs no GitHub (link permanente).
- CI runs (GitHub Actions / Vercel logs).
- Audit log de mudanças destrutivas.
- Comunicações de release.
- Pós-mortems de emergency changes.

## 9. EXCEÇÕES

Bypass do processo (force push, merge sem review, deploy direto sem CI) são proibidos exceto em SEV-1 com aprovação verbal de 2 stakeholders e documentação posterior em até 24h.
