# SOC 2 — Checklist de Coleta de Evidências

**Versão:** 1.0
**Owner:** DPO + SRE Lead
**Frequência mínima:** mensal (com itens trimestrais e anuais marcados)

---

## OBJETIVO

Listar, por controle, **quais evidências coletar**, **com que frequência** e **onde arquivar**, garantindo que durante o período de observação Type II (mínimo 6 meses contínuos) toda evidência esteja prontamente disponível para o auditor.

---

## ESTRUTURA DE PASTAS

```
docs/compliance/soc2/evidence/
├── access-reviews/         (trimestral)
│   ├── 2026-Q2/
│   ├── 2026-Q3/
│   └── ...
├── change-management/      (mensal — sample de PRs)
│   ├── 2026-04/
│   ├── 2026-05/
│   └── ...
├── incident-response/      (a cada incidente)
│   ├── 2026-04-22-001/
│   └── ...
├── dr-tests/               (semestral)
│   └── 2026-04-30/
├── vendor-reviews/         (anual)
│   └── 2026/
├── security-training/      (anual)
│   └── 2026/
├── exceptions/             (a cada exceção concedida)
└── policies-acks/          (a cada onboarding)
```

---

## CONTROLES E EVIDÊNCIAS

### CC1 — Control Environment

| Evidência                                  | Frequência         | Local                |
| ------------------------------------------ | ------------------ | -------------------- |
| Code of Conduct assinado por colaboradores | onboarding + anual | `policies-acks/`     |
| Org chart formal                           | semestral          | `docs/people/org.md` |
| Plano de capacitação anual                 | anual              | RH                   |

### CC2 — Communication

| Evidência                                      | Frequência       | Local                |
| ---------------------------------------------- | ---------------- | -------------------- |
| Trust Center vivo (`/trust`)                   | contínuo         | URL pública          |
| Incidentes comunicados (Status page snapshots) | a cada incidente | `incident-response/` |
| Onboarding policies acknowledgments            | onboarding       | `policies-acks/`     |

### CC3 — Risk Assessment

| Evidência                               | Frequência                  | Local                                        |
| --------------------------------------- | --------------------------- | -------------------------------------------- |
| Risk register atualizado                | semestral                   | `docs/compliance/risk-register.md` (a criar) |
| RIPD atualizado                         | sempre que mudar tratamento | `docs/legal/ripd-*.md`                       |
| Threat models de novas features grandes | por feature                 | ADRs                                         |

### CC4 — Monitoring

| Evidência                                | Frequência   | Local                                   |
| ---------------------------------------- | ------------ | --------------------------------------- |
| Self-audit de segurança                  | semestral    | `docs/security/self-audit-*.md`         |
| Sentry retention configurada (≥ 90 dias) | configuração | screenshot                              |
| Métricas de SLO mensais                  | mensal       | `docs/observability/slo-*.md` (a criar) |

### CC5 — Control Activities

| Evidência                       | Frequência | Local                |
| ------------------------------- | ---------- | -------------------- |
| Matriz de controles atualizada  | trimestral | `controls-matrix.md` |
| Policies revistas e versionadas | anual      | `policies/`          |

### CC6 — Logical & Physical Access

| Evidência                                             | Frequência               | Local                          |
| ----------------------------------------------------- | ------------------------ | ------------------------------ |
| Access reviews (lista de usuários ativos por sistema) | trimestral               | `access-reviews/YYYY-QN/`      |
| Logs de provisionamento e revogação                   | contínuo (export mensal) | `access-reviews/YYYY-QN/logs/` |
| Configurações MFA habilitadas (screenshots)           | anual                    | `access-reviews/YYYY-QN/mfa/`  |
| RBAC matrix versionada                                | a cada mudança           | `lib/rbac.ts` (git)            |
| Configuração RLS verificada                           | contínuo (cron)          | `/api/cron/rls-canary`         |

### CC7 — System Operations

| Evidência                        | Frequência       | Local                          |
| -------------------------------- | ---------------- | ------------------------------ |
| Logs de Sentry alerts disparados | mensal           | export                         |
| Audit log hash chain validado    | diário (cron)    | `/api/cron/verify-audit-chain` |
| Pós-mortems de SEV-1/2           | a cada incidente | `incident-response/`           |
| Resultados de DR drills          | semestral        | `dr-tests/`                    |

### CC8 — Change Management

| Evidência                               | Frequência     | Local                        |
| --------------------------------------- | -------------- | ---------------------------- |
| Sample de 25 PRs (com review, CI verde) | mensal         | `change-management/YYYY-MM/` |
| Migrations executadas em prod           | a cada release | log do Vercel deploy         |
| Pré e pós-deploy smoke results          | a cada release | tests/e2e/results/           |

### CC9 — Vendor Risk

| Evidência                                        | Frequência        | Local                            |
| ------------------------------------------------ | ----------------- | -------------------------------- |
| Lista de sub-processadores no Trust Center       | contínuo          | `/trust`                         |
| DPAs assinados arquivados                        | sempre atualizado | `vendor-reviews/contracts/`      |
| Certificações dos vendors (SOC 2, ISO) coletadas | anual             | `vendor-reviews/YYYY/certs/`     |
| Atas de revisão anual                            | anual             | `vendor-reviews/YYYY/minutes.md` |

### Privacy (P1-P8)

| Evidência                                                  | Frequência               | Local                                         |
| ---------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| Política de Privacidade vigente                            | contínuo                 | `/privacy`                                    |
| Consentimentos coletados (logs)                            | contínuo (sample mensal) | `consent-logs/`                               |
| DSAR (Data Subject Access Requests) atendidas em ≤ 15 dias | mensal                   | `dsar-logs/` (já temos cron de monitoramento) |
| Eliminações automáticas (purge crons logs)                 | mensal                   | logs Inngest                                  |

---

## AUTOMAÇÃO RECOMENDADA

Para reduzir atrito do auditor:

1. **Vanta / Drata / Secureframe** — automatiza coleta da maioria dos itens acima.
2. **GitHub Actions** com job mensal que:
   - Exporta sample de PRs para `change-management/YYYY-MM/`.
   - Roda `npm audit` e arquiva o resultado.
   - Captura screenshot do `/trust` e arquiva.
3. **Cron Inngest** mensal:
   - Exporta lista de usuários ativos por papel para `access-reviews/`.
   - Verifica audit_log integrity e arquiva atestado.

---

## MAPA DE GAPS (a fechar antes da auditoria)

| Item                                    | Status     | Prazo   |
| --------------------------------------- | ---------- | ------- |
| Risk register sistematizado             | a criar    | 30 dias |
| Code of Conduct formal                  | a criar    | 30 dias |
| Org chart documentado                   | a criar    | 60 dias |
| Treinamento anual de security awareness | a desenhar | 90 dias |
| `slo-*.md` mensal                       | a criar    | 90 dias |
| GitHub Actions de coleta automatizada   | a criar    | 60 dias |
