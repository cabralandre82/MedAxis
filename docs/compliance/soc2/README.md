# SOC 2 — Scaffolding e Roadmap

**Versão:** 1.0
**Data:** 2026-04-17
**Owner:** Diretor de Engenharia (a designar) + DPO

---

## OBJETIVO

Preparar a Clinipharma para uma auditoria **SOC 2 Type II** segundo os Trust Services Criteria (TSC) da AICPA — categorias **Security** (obrigatória) e **Confidentiality**, **Privacy** (opcionais, mas alinhadas ao nosso negócio).

Este diretório contém o pré-trabalho necessário para reduzir o tempo de auditoria formal de 6+ meses para 2-3 meses, quando a empresa decidir contratar um auditor credenciado AICPA.

---

## ESTRUTURA

```
docs/compliance/soc2/
├── README.md                  ← este arquivo
├── controls-matrix.md         ← mapa CC1-CC9 → evidências internas
├── evidence-collection.md     ← checklist de evidências por controle
├── policies/                  ← políticas escritas formalmente
│   ├── acceptable-use.md
│   ├── access-control.md
│   ├── change-management.md
│   ├── incident-response.md
│   ├── vendor-management.md
│   ├── data-classification.md
│   └── business-continuity.md
└── evidence/                  ← evidências coletadas (gitignored em parte)
```

---

## TRUST SERVICES CRITERIA APLICÁVEIS

| Categoria                     | Aplicável?           | Justificativa                                         |
| ----------------------------- | -------------------- | ----------------------------------------------------- |
| **Security (CC)**             | ✅ Sim (obrigatória) | Base de toda auditoria SOC 2                          |
| **Availability (A)**          | ⚠️ Considerar        | SLA público comprometido com parceiros                |
| **Processing Integrity (PI)** | ⚠️ Considerar        | Pedidos farmacêuticos exigem processamento exato      |
| **Confidentiality (C)**       | ✅ Sim               | Dados comerciais sensíveis (preço, margem, contratos) |
| **Privacy (P)**               | ✅ Sim               | Dados pessoais sensíveis (saúde) — sinérgico com LGPD |

---

## ROADMAP

### Fase 0 — Pré-trabalho (CONCLUÍDO em 2026-04)

- [x] Mapeamento dos controles existentes em `controls-matrix.md`.
- [x] 7 políticas escritas em `policies/`.
- [x] Self-audit OWASP ASVS L1 em `docs/security/self-audit-2026-04-17.md`.
- [x] DR drill planejado para 2026-04-30 em `docs/runbooks/dr-drill-2026-04.md`.
- [x] Trust Center público em `/trust`.
- [x] DPO formalizado em `/dpo`.

### Fase 1 — Readiness (próximos 60 dias)

- [ ] Designação formal do DPO e Diretor de Segurança.
- [ ] Treinamento anual obrigatório para todos os colaboradores (security awareness).
- [ ] Implementar SIEM (mesmo que MVP — Sentry + custom alertas).
- [ ] Coletar evidências dos primeiros 30 dias.
- [ ] Pre-audit interno com gap analysis (ex.: Vanta, Drata).

### Fase 2 — Período de observação Type II (mínimo 6 meses)

- [ ] Manter operação dos controles auditados durante 6 meses contínuos.
- [ ] Coletar evidências sistematicamente (logs de change management, access reviews trimestrais, evidence de testes).
- [ ] Trimestralmente: revisão dos controles e atualização da policies.

### Fase 3 — Auditoria formal (1-3 meses)

- [ ] Contratar auditor independente AICPA-credenciado (ex.: A-LIGN, Schellman, Coalfire).
- [ ] Período de campo: walkthroughs + sample testing.
- [ ] Relatório SOC 2 Type II emitido.

### Fase 4 — Manutenção contínua

- [ ] Re-auditoria anual.
- [ ] Atualizações de policies conforme mudanças regulatórias e operacionais.
- [ ] Evidence collection contínua e automatizada quando possível.

---

## ESTIMATIVA DE CUSTO E PRAZO

| Item                                               | Custo          | Prazo         |
| -------------------------------------------------- | -------------- | ------------- |
| Plataforma de compliance (Vanta/Drata/Secureframe) | US$ 12-30k/ano | imediato      |
| Pre-audit / readiness consultancy                  | US$ 10-25k     | 1-2 meses     |
| Período de observação Type II                      | —              | 6 meses       |
| Auditoria formal Type II                           | US$ 20-50k     | 2-3 meses     |
| Re-auditoria anual                                 | US$ 15-35k     | 1-2 meses/ano |

**Total Year 1 estimado:** US$ 60-130k.
**Tempo total até relatório Type II:** 9-12 meses a partir do início da Fase 1.

---

## REFERÊNCIAS

- [AICPA Trust Services Criteria 2017 (atualizado 2022)](https://www.aicpa-cima.com/resources/download/trust-services-criteria)
- [SOC 2 vs SOC 3](https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2)
- [GDPR ↔ SOC 2 mapping](https://gdpr.eu/)
- LGPD ↔ TSC mapping: ver `controls-matrix.md`
