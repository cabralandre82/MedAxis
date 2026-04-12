# Clinipharma — Lista Consolidada de Pendências

> Gerado em: 2026-04-12 | Versão da plataforma: **5.1.4** | **685 testes unitários** | cobertura atualizada
>
> **v5.1.4:** `/terms` adicionado às `PUBLIC_ROUTES` do middleware (Termos de Uso inacessível sem autenticação). Cobertura E2E adicionada: 3 novos testes em `smoke.test.ts` e `01-auth.test.ts` previnem regressão.
> **v5.1.3:** Causa raiz definitiva identificada e corrigida — `DropdownMenuLabel` usava `MenuPrimitive.GroupLabel` do Base UI sem o `Group` context obrigatório, lançando error #31 ao abrir o menu do header.
> **v5.1.2:** `PrivateLayout` com tratamento defensivo de erros. Página `/profile` restaurada com funcionalidades completas.
> **v5.1.1:** Página `/profile` criada (versão inicial).
> **v5.1.0:** Política de Privacidade (`/privacy`) e Termos de Uso (`/terms`) implementados — LGPD, ANVISA, Marco Civil. Pendência #6 concluída. 685 testes passando.

---

## 🔴 BLOQUEANTES — Obrigatórios antes do primeiro cliente real

Sem estes itens a plataforma não pode operar comercialmente (jurídico, fiscal ou tecnicamente inviável).

| #     | Pendência                                       | Razão                                                | Como resolver                                                                                       |
| ----- | ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1     | **CNPJ da empresa**                             | Pré-requisito de TUDO abaixo                         | Abrir empresa com contadora                                                                         |
| 2     | **Asaas → Produção**                            | Sem CNPJ, zero pagamentos reais processados          | Conta Asaas PJ → API Key prod → atualizar `ASAAS_API_KEY` + `ASAAS_API_URL` no Vercel               |
| 3     | **NF-e / NFS-e**                                | Obrigação fiscal — ilegal operar sem                 | CNPJ + certificado digital A1 + conta Nuvem Fiscal → substituir `NUVEM_FISCAL_*` no Vercel          |
| 4     | **Clicksign → Produção**                        | Contratos sandbox não têm valor jurídico             | Conta empresarial Clicksign → token produção → atualizar `CLICKSIGN_ACCESS_TOKEN` + URL no Vercel   |
| 5     | **DPA formal (LGPD)**                           | Obrigação legal com parceiros que processam dados    | Elaborar com advogado LGPD — assinar com farmácias e clínicas antes do go-live                      |
| ~~6~~ | ~~**Política de Privacidade + Termos de Uso**~~ | ~~LGPD Art. 8~~                                      | ✅ Implementado em `/privacy` e `/terms` — v5.1.0                                                   |
| 7     | **Migração PII encrypted**                      | Dados existentes de `phone`/`crm` ainda em plaintext | Escrever e rodar script: ler plaintext → `encrypt()` → salvar em `*_encrypted` → atualizar services |

---

## 🟡 IMPORTANTES — Fazer antes de escalar (primeiros 30 dias)

Não bloqueiam o primeiro cliente, mas impactam operação, conversão e compliance.

### Infraestrutura / DevOps

| #   | Pendência                                                                          | Onde documentado              |
| --- | ---------------------------------------------------------------------------------- | ----------------------------- |
| 8   | **Supabase Staging** — criar projeto `clinipharma-staging`                         | `docs/staging-environment.md` |
| 9   | **Branch `staging`** — criar e configurar auto-deploy no Vercel                    | `docs/staging-environment.md` |
| 10  | **Load testing com k6** — rodar contra staging após provisionamento                | `docs/load-testing.md`        |
| 11  | **DR simulação** — restore de backup em staging + medir RTO/RPO reais              | `docs/disaster-recovery.md`   |
| 12  | **Cloudflare WAF** — ativar OWASP Core Ruleset + rate limit 100 req/min em `/api/` | `docs/roadmap-90pts.md` A2    |
| 13  | **Inngest dashboard** — criar conta em app.inngest.com e sincronizar funções       | `docs/go-live-checklist.md`   |

### Notificações

| #   | Pendência                                                                          | Onde documentado                   |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| 14  | **Twilio → Produção** — test credentials não entregam SMS reais                    | `docs/go-live-checklist.md` item 4 |
| 15  | **WhatsApp Evolution API** — adquirir número + deploy Docker + conectar QR         | `docs/go-live-checklist.md` item 3 |
| 16  | **Clicksign webhook** — registrar `X-Clicksign-Secret` no painel Clicksign Sandbox | `docs/go-live-checklist.md`        |

### Observabilidade

| #   | Pendência                                                                  | Onde documentado            |
| --- | -------------------------------------------------------------------------- | --------------------------- |
| 17  | **UptimeRobot** — configurar monitor `/api/health` a cada 1 min            | `docs/slos.md`              |
| 18  | **Sentry alertas** — configurar regras de alerta no Sentry Dashboard       | `docs/slos.md` seção 3.1    |
| 19  | **Vercel Log Drain** — conectar Logtail ou Axiom para persistência de logs | `docs/roadmap-90pts.md` A13 |
| 20  | **OpenTelemetry** — integrar `@vercel/otel` para spans em queries Supabase | `docs/roadmap-90pts.md` A13 |

---

## 🟠 RECOMENDADOS — Qualidade técnica (próximo sprint)

Sem impacto no go-live mas reduzem risco operacional e dívida técnica.

### Segurança

| #   | Pendência                          | Detalhe                                                                                                                    |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 21  | **Pentest externo**                | Contratar Tempest, Conviso ou Kondado (R$8k–20k). Obrigatório antes de clientes regulados. Ver `docs/roadmap-90pts.md` A17 |
| 22  | **Circuit breaker para email/SMS** | Estender `lib/circuit-breaker.ts` para `lib/email`, `lib/sms.ts`, `lib/whatsapp.ts`                                        |
| 23  | **Testes E2E contra staging real** | Rodar `BASE_URL=staging.clinipharma.com.br npx playwright test` após provisionar staging                                   |

### Produto / UX

| #   | Pendência                          | Detalhe                                                                                 |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| 24  | **Ícones PWA**                     | Criar `public/icons/icon-192x192.png` e `icon-512x512.png` (design pendente)            |
| 25  | **Auditoria WCAG 2.1**             | Instalar `axe-core` + corrigir issues de contraste, labels, ARIA, navegação por teclado |
| 26  | **Service Worker (cache offline)** | Avaliar `next-pwa` ou Workbox para cache de assets estáticos                            |
| 27  | **OpenAPI / Swagger**              | Documentação interna via `zod-to-openapi` — útil para integrações futuras               |
| 28  | **2FA**                            | Autenticação em dois fatores não implementada                                           |
| 29  | **Google OAuth**                   | Preparado no Supabase, não ativado (requer Google Cloud Console)                        |

### Cobertura de testes

| #   | Pendência                        | Detalhe                                                                                                                         |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 30  | **Testes Inngest (integration)** | Rodar com `npx inngest-cli@latest dev` localmente — jobs excluídos do unit coverage por design                                  |
| 31  | **Cobertura de branches**        | `branches: 70.63%` — melhorar cobertura de branches em `compliance.ts`, `rate-limit.ts` (Redis path), `services/consultants.ts` |

---

## 🟢 ONBOARDING — Após go-live técnico

Ações comerciais e operacionais (não técnicas):

| #   | Pendência                                                         |
| --- | ----------------------------------------------------------------- |
| 32  | Farmácias reais cadastradas e ativas na plataforma                |
| 33  | Catálogo real de produtos (preço, custo, prazo por SKU)           |
| 34  | Taxa de comissão dos consultores configurada em **Configurações** |
| 35  | Clínicas clientes onboardadas                                     |
| 36  | Médicos vinculados às clínicas                                    |
| 37  | Consultores de vendas cadastrados e vinculados                    |
| 38  | Primeiro pedido de ponta a ponta testado em produção real         |

---

## Bloco B — Bloqueado aguardando CNPJ

Itens do roadmap que dependem de CNPJ ativo para implementar:

| Item | Descrição                                                                         |
| ---- | --------------------------------------------------------------------------------- |
| B1   | **Emissão de NF-e** — Nuvem Fiscal integrada após CNPJ + certificado A1           |
| B2   | **Asaas produção completo** — split de pagamento, antecipação, relatórios fiscais |
| B3   | **ANPD registro** — iniciar registro formal como controlador de dados pessoais    |
| B4   | **DPA template** — revisão final por advogado LGPD especializado                  |

---

## Resumo executivo

| Categoria                             | Qtd    | Responsável               |
| ------------------------------------- | ------ | ------------------------- |
| 🔴 Bloqueantes (pré-primeiro-cliente) | 7      | Fundador + Jurídico + Dev |
| 🟡 Importantes (30 dias)              | 13     | Dev + Fundador            |
| 🟠 Recomendados (próximo sprint)      | 12     | Dev                       |
| 🟢 Onboarding (após go-live)          | 7      | Comercial + Fundador      |
| **Total**                             | **39** |                           |

### Funcionalidades entregues (v4.7.0 → v5.0.0)

| Versão | Feature                                                         | Testes |
| ------ | --------------------------------------------------------------- | ------ |
| 4.7.0  | Explicações contextuais de SKU, Slug e Variantes no form        | ✅     |
| 4.8.0  | SKU gerado automaticamente no formato `[CAT]-[FAR]-[NNNN]`      | ✅     |
| 4.9.0  | Página de gerenciamento de categorias de produtos               | ✅     |
| 5.0.0  | Sistema de suporte por tickets conversacional                   | ✅     |
| 5.0.1  | Revisão completa do suporte: polling, UI otimista, busca        | ✅     |
| 5.1.0  | Política de Privacidade e Termos de Uso (LGPD + ANVISA)         | —      |
| 5.1.1  | Página `/profile` — corrige erro ao clicar no nome no header    | ✅     |
| 5.1.4  | Fix middleware: `/terms` público + cobertura E2E (TC-11, TC-12) | ✅     |

**O que está 100% pronto:** plataforma técnica, autenticação, pedidos, pagamentos sandbox, notificações (push/email), LGPD portal, auditoria, compliance CNPJ, suporte por tickets, gerenciamento de categorias, SKU automático, Política de Privacidade, Termos de Uso, E2E tests, CI/CD, documentação.

**O que bloqueia lançamento comercial:** CNPJ da empresa → Asaas produção → NF-e → DPA/LGPD (itens 1–5 e 7).

---

_Documento gerado automaticamente a partir de `docs/go-live-checklist.md`, `docs/roadmap-90pts.md` e auditorias de código. Atualizar sempre que um item for concluído._
