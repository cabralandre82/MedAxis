# Clinipharma — Lista Consolidada de Pendências

> Gerado em: 2026-04-13 | Versão da plataforma: **6.5.0** | cobertura atualizada
>
> **v6.5.0:** Fluxo de revisão de documentos pela farmácia — migration 033 (`order_documents.status/rejection_reason`, `order_items.doc_status`, `orders.docs_deadline`); endpoint `/api/documents/[id]/download` (URL assinada, 5 min); `services/document-review.ts` com `reviewDocument`, `evaluateOrderDocuments` (avanço automático para `AWAITING_PAYMENT` ou bloqueio para `AWAITING_DOCUMENTS` com prazo de 3 dias úteis) e `removeOrderItem` (clínica remove item rejeitado, pedido recalculado, cancelado se ficar vazio); cron `/api/cron/expire-doc-deadlines` (cancela pedidos com prazo expirado); UI `DocumentManager` com download, badges de status, controles de aprovar/rejeitar por documento; `order-detail` com badge `doc_status` por item e botão de remoção para `CLINIC_ADMIN`. 7 novos testes unitários.
>
> **v6.4.5:** Upload de documentos tipado — cada arquivo recebe tipo explícito (`PRESCRIPTION`, `IDENTITY`, `MEDICAL_REPORT`, `AUTHORIZATION`, `OTHER`) com seletor inline no formulário de criação. Tipo padrão inteligente: `PRESCRIPTION` quando carrinho tem produto com `requires_prescription`, `OTHER` caso contrário. Status avança automaticamente para `READY_FOR_REVIEW` quando pelo menos um documento é enviado na criação.
>
> **v6.4.4:** Fix carrinho perdido ao navegar para `/doctors/new` — carrinho serializado como `?cart=id:qty,id:qty` na URL; restaurado ao voltar para `/orders/new`. `parseCartParam` extraído para `lib/orders/doctor-field-rules.ts` com 7 testes unitários.
>
> **v6.4.3:** Fix redirect pós-cadastro de médico — `CLINIC_ADMIN` era jogado para `/unauthorized` ao salvar médico (página de detalhe exigia `SUPER_ADMIN`). `/doctors/[id]` aberto para `CLINIC_ADMIN`. `DoctorForm` aceita `redirectTo` prop; para `CLINIC_ADMIN` redireciona para `/orders/new` após cadastro. Página de novo médico informa que o médico será vinculado automaticamente.
>
> **v6.4.2:** Fix crítico no fluxo de pedidos — `adminClient` usado nas queries de `clinic_members` e `doctor_clinic_links` para contornar bootstrap de RLS (usuário não conseguia ler sua própria clínica com o client de usuário). `CLINIC_ADMIN` pode agora cadastrar médicos em `/doctors/new` com auto-vínculo à sua clínica. Atalhos no form de pedido: link "Cadastrar novo médico" ao lado do campo, e callout âmbar quando a clínica não tem médicos vinculados. 2 novos testes unitários.
>
> **v6.4.1:** Refactor — lógica de visibilidade/obrigatoriedade do campo médico extraída para `lib/orders/doctor-field-rules.ts` (função pura `resolveDoctorFieldState`). 5 novos testes unitários cobrem todas as combinações de médicos vinculados × produtos com receita.
>
> **v6.4.0:** Fluxo de criação de pedidos corrigido — clínica auto-detectada pelo papel do usuário (sem dropdown para `CLINIC_ADMIN`), médico solicitante condicional: obrigatório apenas quando o carrinho contém produto com `requires_prescription = true`, opcional quando a clínica tem médicos vinculados, oculto quando não tem. Migration 032 torna `orders.doctor_id` nullable. Médicos exibidos são apenas os vinculados à clínica do pedido.
>
> **v6.3.0:** Push FCM frontend completo — `PushInitializer` component montado no layout privado (solicita permissão, registra token, exibe toasts em foreground). Ícones PWA criados (`public/icons/`). Guia de produção Evolution API/WhatsApp em `docs/infra/evolution-api-setup.md`. 13 novos testes.
>
> **v6.2.0:** Varredura e correção de 5 gaps "infraestrutura presente, funcionalidade incompleta": (1) pharmacy-order-actions migrado para /advance (gate de prescrição garante todos os agentes); (2) página admin de Risco de Churn com score persistido em `clinic_churn_scores`; (3) SMS nos fluxos principais (aprovação, pedido, stale); (4) Push notifications wired nos eventos de pedido; (5) WhatsApp nos eventos de aprovação/rejeição/pedido. Migration 031 aplicada. 26 novos testes.
>
> **v6.1.1:** Campos de receita médica expostos no formulário de produto (seção "Receita Médica"). `Product` type + `productSchema` atualizados. Produtos do catálogo inicial classificados em produção via API.
> **v6.1.0:** Enforcement completo de receitas médicas — migration 030, `lib/prescription-rules.ts`, `POST /api/orders/[id]/advance` (gate único), `POST /api/orders/[id]/prescriptions` (upload por item), `PrescriptionManager` UI. 16 novos testes. 786 testes passando.
> **v6.0.3:** 4 gaps da auditoria interna corrigidos em `lib/ai.ts`: validação de enum/boolean em `analyzeSentiment`, `temperature 0` em contratos, circuit breakers separados por feature. 3 novos TCs. 770 testes passando.
> **v6.0.2:** Plano de auditoria de QA e segurança (incl. IA) — `docs/audit-qa-plena-2026-04.md` (~242 casos explícitos + matriz de expansão RBAC para 40 rotas API). Alinhado a `known-limitations`, LGPD e roadmap.
> **v6.0.1:** Cobertura completa para features de IA — 44 novos testes (lead-score, lib/ai, 4 jobs Inngest, OCR route, recommendations route, 3 crons). Migration 029 aplicada em produção. `OPENAI_API_KEY` configurada no Vercel (Production + Preview). 767 testes passando.
> **v6.0.0:** Integração de IA com 8 features em produção: score de leads, detecção de churn, alerta preditivo de recompra, triagem automática de tickets (GPT-4o-mini), análise de sentimento em suporte, geração automática de contratos, OCR de documentos (GPT-4o Vision), recomendações de produtos (Apriori SQL). Migration 029 criada. 3 novos crons.
> **v5.3.2:** Fix erro `'use server'` em `services/coupons.ts` (exportação de schema Zod violava restrição do App Router). Sidebar "Cupons" reposicionado para posição 4. Teste de conformidade `use server` adicionado.
> **v5.3.1:** Melhorias na feature de cupons — UX admin com `SearchableSelect`, `used_count` atômico, resumo financeiro em pedidos, alertas de expiração (cron diário). 14 novos testes.
> **v5.3.0:** Cupons de desconto por produto e por clínica — admin cria, clínica ativa uma vez, auto-aplica por unidade, plataforma absorve. Migrations 027 e 028.
> **v5.2.1:** Migration 026 aplicada em produção. 21 novos testes unitários + 2 E2E. Fix da suite vitest (Node.js 18 compatível). 701 testes passando.
> **v5.2.0:** Captura de leads de cadastro — rascunhos anônimos + envio sem documentos (PENDING_DOCS). Admin vê 3 camadas: interesses incompletos, sem docs, completos.
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

| #   | Pendência                                                                          | Onde documentado                    |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| 14  | **Twilio → Produção** — test credentials não entregam SMS reais                    | `docs/go-live-checklist.md` item 4  |
| 15  | **WhatsApp Evolution API** — adquirir número + deploy Docker + conectar QR         | `docs/infra/evolution-api-setup.md` |
| 16  | **Clicksign webhook** — registrar `X-Clicksign-Secret` no painel Clicksign Sandbox | `docs/go-live-checklist.md`         |

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

| #      | Pendência                           | Detalhe                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~24~~ | ~~**Ícones PWA**~~                  | ✅ **v6.3.0**: `public/icons/icon-192x192.png` e `icon-512x512.png` criados                                                                                                                                                                                                            |
| 25     | **Auditoria WCAG 2.1**              | Instalar `axe-core` + corrigir issues de contraste, labels, ARIA, navegação por teclado                                                                                                                                                                                                |
| 26     | **Service Worker (cache offline)**  | Avaliar `next-pwa` ou Workbox para cache de assets estáticos                                                                                                                                                                                                                           |
| 27     | **OpenAPI / Swagger**               | Documentação interna via `zod-to-openapi` — útil para integrações futuras                                                                                                                                                                                                              |
| 28     | **2FA**                             | Autenticação em dois fatores não implementada                                                                                                                                                                                                                                          |
| 29     | **Google OAuth**                    | Preparado no Supabase, não ativado (requer Google Cloud Console)                                                                                                                                                                                                                       |
| 36     | **Substâncias controladas (SNGPC)** | Produtos psicotrópicos/entorpecentes exigem retenção física da receita e notificação ao SNGPC (ANVISA). Quando implementar: (1) flag `controlled_substance` em `products`; (2) bloquear pedido até confirmação de retenção física; (3) integrar API SNGPC para notificação automática. |

### Cobertura de testes

| #   | Pendência                        | Detalhe                                                                                                                                                                                                        |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30  | **Testes Inngest (integration)** | Jobs têm cobertura de registro e lógica de filtros em unit tests. Testar com `npx inngest-cli@latest dev` para fluxo completo.                                                                                 |
| 31  | **Cobertura de branches**        | `branches: 73.8%` — melhorar cobertura de branches em `compliance.ts`, `rate-limit.ts` (Redis path), `services/consultants.ts`. `lib/orders/doctor-field-rules.ts` tem 100% de cobertura de branches (v6.4.1). |

### Inteligência Artificial

| #   | Pendência                          | Detalhe                                                                                                                                                 |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | **`OPENAI_API_KEY` no Staging**    | Variável configurada em Production e Preview. Quando o projeto Supabase staging for criado, adicionar também ao ambiente de desenvolvimento.            |
| 33  | **`pgvector` — busca semântica**   | Extensão não ativada. Habilitada quando Feature H2 (busca semântica de produtos) for implementada — requer `CREATE EXTENSION vector` no Supabase.       |
| 34  | **Custo OpenAI em escala**         | Monitorar via OpenAI Usage Dashboard. Configurar alerta de gasto mensal. Ver `docs/ai-aplicacoes-estudo.md` seção 6 para projeções.                     |
| 35  | **Product associations populadas** | Tabela `product_associations` criada mas vazia — o job semanal (`/api/cron/product-recommendations`) popula automaticamente após 5+ pedidos históricos. |

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
| 🟠 Recomendados (próximo sprint)      | 16     | Dev                       |
| 🟢 Onboarding (após go-live)          | 7      | Comercial + Fundador      |
| **Total**                             | **43** |                           |

### Funcionalidades entregues (v4.7.0 → v6.1.1)

| Versão | Feature                                                                                                     | Testes |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------ |
| 4.7.0  | Explicações contextuais de SKU, Slug e Variantes no form                                                    | ✅     |
| 4.8.0  | SKU gerado automaticamente no formato `[CAT]-[FAR]-[NNNN]`                                                  | ✅     |
| 4.9.0  | Página de gerenciamento de categorias de produtos                                                           | ✅     |
| 5.0.0  | Sistema de suporte por tickets conversacional                                                               | ✅     |
| 5.0.1  | Revisão completa do suporte: polling, UI otimista, busca                                                    | ✅     |
| 5.1.0  | Política de Privacidade e Termos de Uso (LGPD + ANVISA)                                                     | —      |
| 5.1.1  | Página `/profile` — corrige erro ao clicar no nome no header                                                | ✅     |
| 5.1.4  | Fix middleware: `/terms` público + cobertura E2E (TC-11, TC-12)                                             | ✅     |
| 5.2.0  | Captura de leads: drafts anônimos + PENDING_DOCS + painel admin                                             | ✅     |
| 5.2.1  | Migration 026 + 21 unit tests + 2 E2E + fix Vitest Node 18 (701 testes)                                     | ✅     |
| 5.3.0  | Cupons de desconto por produto/clínica — auto-aplica por unidade                                            | ✅     |
| 5.3.1  | Melhorias cupons: SearchableSelect, used_count, resumo financeiro, alertas                                  | ✅     |
| 5.3.2  | Fix `'use server'` coupons + sidebar Cupons reposicionado (posição 4)                                       | ✅     |
| 6.0.0  | IA integrada: 8 features (churn, recompra, triagem, sentimento, OCR, contratos, recomendações, lead score)  | ✅     |
| 6.0.1  | Cobertura IA: 44 novos testes + migration 029 aplicada + OPENAI_API_KEY Vercel                              | ✅     |
| 6.0.2  | Auditoria QA plena — `docs/audit-qa-plena-2026-04.md` (~242 casos + matriz RBAC)                            | —      |
| 6.0.3  | Fix auditoria IA: `analyzeSentiment` validação enum/bool, `temperature 0` contratos, circuit breakers       | ✅     |
| 6.1.0  | Enforcement receitas médicas: migration 030, gate `/advance`, upload por item, UI PrescriptionManager       | ✅     |
| 6.1.1  | Formulário de produto: seção "Receita Médica" com toggle, tipo e unidades por receita                       | ✅     |
| 6.4.0  | Fluxo de pedidos: clínica auto-detectada, médico condicional por `requires_prescription`, migration 032     | ✅     |
| 6.4.1  | Refactor: `lib/orders/doctor-field-rules.ts` — lógica extraída do componente, 5 testes unitários            | ✅     |
| 6.4.2  | Fix RLS bootstrap, CLINIC_ADMIN cadastra médico com auto-vínculo, atalhos no form de pedido, 2 novos testes | ✅     |
| 6.4.3  | Fix redirect pós-cadastro de médico: `/doctors/[id]` aberto para `CLINIC_ADMIN`, volta para `/orders/new`   | ✅     |
| 6.4.4  | Fix carrinho perdido: `?cart=` serializado na URL, `parseCartParam` com 7 testes unitários                  | ✅     |

**O que está 100% pronto:** plataforma técnica, autenticação, pedidos, pagamentos sandbox, notificações (push/email/SMS/push), LGPD portal, auditoria, compliance CNPJ, suporte por tickets com IA, cupons de desconto, gerenciamento de categorias, SKU automático, Política de Privacidade, Termos de Uso, E2E tests, CI/CD, documentação, **8 features de IA em produção**, **enforcement completo de receitas médicas com controle por produto e por unidade**.

**O que bloqueia lançamento comercial:** CNPJ da empresa → Asaas produção → NF-e → DPA/LGPD (itens 1–5 e 7).

---

_Documento gerado automaticamente a partir de `docs/go-live-checklist.md`, `docs/roadmap-90pts.md` e auditorias de código. Atualizar sempre que um item for concluído._
