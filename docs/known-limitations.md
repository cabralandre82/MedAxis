# Clinipharma — Limitações Conhecidas do MVP

> **Plano de testes / auditoria:** ver `docs/audit-qa-plena-2026-04.md` (v6.0.2) — matriz alinhada a este documento (N/A explícitos para capacidades ainda não existentes).

---

## Financeiro

- ~~Sem gateway de pagamento automático~~ ✅ **Implementado na v1.3.0**: Asaas sandbox integrado — PIX QR, boleto e cartão. Webhook confirma pagamento automaticamente.
  - ✅ **PRODUÇÃO CONFIGURADA (2026-04-14):** conta PJ criada, API Key de produção ativa no Vercel, webhook registrado em `https://clinipharma.com.br/api/payments/asaas/webhook`.

- ~~Sem emissão fiscal~~ ✅ **Implementado na v6.8.0**: NFS-e via Nuvem Fiscal integrada. Emissão automática ao confirmar repasse à farmácia (comissão da plataforma) e ao consultor. Circuit breaker protege o fluxo — falha na NFS-e nunca bloqueia o repasse.
  - **⚠️ PENDENTE:** Rodar migration `042_nfse_records.sql` no Supabase SQL Editor (credenciais já configuradas no Vercel em 2026-04-14).

- **Repasse manual**: por design — admin aprova repasse antes de transferir (sem split automático).

## Notificações

- ~~Sem notificações push~~ ✅ **Implementado na v1.3.0**: Firebase FCM com service worker.
  - VAPID key configurada: `BNrMF4L9UwGqH3dHkIZp9-plConcw5YXpcTbfL-mF6_XTv6oIlV10Buw1sgCqd-YVveXECTWcxvWxXgbgf_VQ-U` ✅
  - ~~Push não disparado nos eventos de negócio~~ ✅ **v6.2.0**: `push: true` wired em status de pedido (criação, READY, SHIPPED, DELIVERED, CANCELED) e novos pedidos para admins.
  - ~~**⚠️ PENDENTE FRONTEND:** service worker + Firebase SDK no cliente ainda não implementados.~~ ✅ **v6.3.0**: `PushInitializer` component montado no layout privado — solicita permissão, registra token via `POST /api/push/subscribe`, e exibe toasts para mensagens em foreground. Ícones PWA (`public/icons/icon-192x192.png`, `icon-512x512.png`) criados. Todas as 7 variáveis `NEXT_PUBLIC_FIREBASE_*` configuradas no Vercel (Production + Development).

- ~~Sem SMS~~ ✅ **Implementado na v1.3.0**: Twilio integrado.
  - ~~SMS não disparado nos fluxos principais~~ ✅ **v6.2.0**: SMS agora enviado em: aprovação/rejeição/docs pendentes de cadastro; criação de pedido; transições READY, SHIPPED, DELIVERED, CANCELED.
  - **⚠️ PENDENTE PRODUÇÃO (ação manual):** credenciais de teste ativas — SMS não chegam ao destinatário real. Para ativar:
    1. Fazer upgrade da conta Twilio para conta paga
    2. Adquirir número brasileiro (+55) no painel Twilio
    3. `vercel env add TWILIO_ACCOUNT_SID production` (substituir pelo SID real)
    4. `vercel env add TWILIO_AUTH_TOKEN production` (substituir pelo token real)
    5. `vercel env add TWILIO_PHONE_NUMBER production` (ex: `+5511999999999`)

- **WhatsApp não ativo**: infraestrutura e templates prontos (Evolution API).
  - ~~WhatsApp só ativo em 2 eventos~~ ✅ **v6.2.0**: WhatsApp agora disparado em aprovação/rejeição de cadastros e nas transições READY, SHIPPED, DELIVERED de pedidos.
  - **⚠️ PENDENTE PRODUÇÃO (ação manual):** `EVOLUTION_API_URL=PENDING_DEPLOY` — mensagens WhatsApp silenciosamente ignoradas. Para ativar:
    1. Deploy Evolution API em Docker (ver `docs/infra/evolution-api-setup.md`)
    2. Adquirir número WhatsApp dedicado e escanear QR code
    3. `vercel env add EVOLUTION_API_URL production` (URL pública do servidor)
    4. `vercel env add EVOLUTION_API_KEY production` (chave da API)
    5. `vercel env add EVOLUTION_INSTANCE_NAME production` (ex: `clinipharma`)

- ~~Sem preferências de notificação por usuário~~ ✅ **v1.2.0**: toggles em `/profile`
- ~~Sem alertas de pedidos parados~~ ✅ **v1.2.0**: widget + Vercel Cron diário + email digest

## Assinatura Eletrônica

- ~~Sem assinatura eletrônica~~ ✅ **Implementado na v1.3.0**: Clicksign sandbox integrado — PDF automático, signatários, webhook.
  - **⚠️ PENDENTE PRODUÇÃO:** criar conta Clicksign empresarial → gerar token produção → atualizar `CLICKSIGN_ACCESS_TOKEN` + `CLICKSIGN_API_URL` no Vercel → configurar webhook no painel Clicksign.

## Autenticação

- **Recuperação de senha**: rota própria com `admin.generateLink()` + Resend. Funciona em produção.
- **Google OAuth**: preparado mas não ativado (requer Google Cloud Console).
- **Sem 2FA**: autenticação em dois fatores não implementada.

## Produtos

- **Farmácia não altera produtos**: toda atualização de catálogo passa pelo SUPER_ADMIN.
- ~~Sem variações de produto~~ ✅ **v1.4.0**: `product_variants` com atributos livres, preço e custo por variante.
- **Estoque manual**: status `unavailable` gerenciado manualmente, sem integração com estoque real.

## Churn e Retenção

- ~~Sem página admin para visualizar risco de churn~~ ✅ **v6.2.0**: `/churn` criada com lista ordenada por score, filtros por nível, marcação de contato com notas. Scores persistidos em `clinic_churn_scores` (migration 031).
- ~~Score calculado mas não persistido~~ ✅ **v6.2.0**: job faz upsert em `clinic_churn_scores` preservando `contacted_at` e notas de contatos anteriores.
- ~~Farmácia podia bypassar gate de prescrição via `updateOrderStatus`~~ ✅ **v6.2.0**: `pharmacy-order-actions` migrado para `POST /api/orders/[id]/advance` — gate único para todos os agentes.

## Pedidos

- **Produtos do mesmo fornecedor**: carrinho bloqueia mistura de farmácias (um repasse por pedido).
- **Sem frete**: prazo é o estimado pela farmácia no cadastro do produto.
- ~~Sem reorder/templates~~ ✅ **v1.4.0**: templates por clínica + botão "Repetir pedido".
- ~~Sem rastreamento público~~ ✅ **v1.4.0**: `/track/[token]` sem login, timeline visual.
- ~~**Clínica exibia dropdown desnecessário e médico sempre obrigatório**~~ ✅ **v6.4.0**: clínica auto-detectada pelo papel do usuário logado (sem seleção manual para `CLINIC_ADMIN`). Campo de médico solicitante é condicional: oculto quando a clínica não tem médicos vinculados, opcional quando tem, obrigatório apenas quando o carrinho contém produto com `requires_prescription = true`. `orders.doctor_id` é nullable (migration 032). Lógica extraída para `lib/orders/doctor-field-rules.ts` com 5 testes unitários.
- ~~**RLS bootstrap impedia CLINIC_ADMIN de ver sua clínica**~~ ✅ **v6.4.2**: queries de `clinic_members` e `doctor_clinic_links` na página de novo pedido usam `adminClient` (service role) — contorna a política RLS que exige ser membro para ler membros. `CLINIC_ADMIN` pode cadastrar médicos em `/doctors/new` com auto-vínculo à sua clínica.
- ~~**CLINIC_ADMIN recebia `/unauthorized` ao salvar médico**~~ ✅ **v6.4.3**: `/doctors/[id]` aberto para `CLINIC_ADMIN`. Após cadastrar médico, `CLINIC_ADMIN` é redirecionado de volta para `/orders/new` em vez da página de detalhe.
- ~~**Carrinho perdido ao navegar para `/doctors/new`**~~ ✅ **v6.4.4**: carrinho serializado como `?cart=id:qty,id:qty` na URL ao clicar em "Cadastrar novo médico". Ao retornar para `/orders/new`, o parâmetro é parseado por `parseCartParam` e todos os itens e quantidades são restaurados.

## Receitas Médicas

- ~~Sem enforcement de receita médica~~ ✅ **v6.1.0**: enforcement completo implementado.
  - Produtos com `requires_prescription=true` bloqueiam transição `AWAITING_DOCUMENTS → READY_FOR_REVIEW` sem receita enviada.
  - **Modelo A (Simple)**: uma receita no nível do pedido cobre todas as unidades.
  - **Modelo B (Por unidade)**: `max_units_per_prescription=1` exige uma receita por unidade; campo genérico `N` exige `ceil(quantity/N)` receitas.
  - Upload de receitas por item via `POST /api/orders/[id]/prescriptions`.
  - Gate único via `POST /api/orders/[id]/advance` — mesmo admins são bloqueados.
  - ~~**⚠️ PENDENTE:** Os produtos existentes no catálogo têm `requires_prescription=false` por padrão. O SUPER_ADMIN deve atualizar manualmente os produtos controlados no painel de administração.~~ ✅ **v6.1.1**: Campos expostos no formulário de edição de produto (seção "Receita Médica"). Produtos do catálogo inicial já atualizados em produção. Novos produtos podem ser configurados diretamente na UI.
  - **⚠️ NÃO IMPLEMENTADO:** Validação de _conteúdo_ da receita (nome do paciente, CRM do médico, data de validade) — fica sob responsabilidade da farmácia manipuladora.
  - **⚠️ NÃO IMPLEMENTADO:** OCR automático de receitas para extração de dados (previsto como feature de IA — `prescription_number` e `patient_name` são campos opcionais preenchidos manualmente pela clínica).

## Relatórios

- ~~Sem BI avançado~~ ✅ **v1.4.0**: comparação de períodos, ranking clínicas, funil, margem por produto (além dos gráficos v1.2.0)
- ~~Sem filtro de período~~ ✅ **v1.2.0**: DateRangePicker com 8 presets
- ~~Exportação sem filtro~~ ✅ **v1.2.0**: CSV/Excel respeita período ativo

## SLA e Alertas

- ~~Thresholds hardcoded~~ ✅ **v1.4.0**: SLA configurável por farmácia com 3 níveis (aviso/alerta/crítico); UI em Configurações.

## Segurança

- ~~Sem histórico de acesso~~ ✅ **v1.4.0**: `access_logs` com detecção de novo dispositivo, alerta in-app, visualização no perfil.
- ~~Sem revogação de sessão~~ ✅ **v3.0.0**: JWT blacklist (`revoked_tokens`). Sessões revogadas imediatamente em desativação de usuário.
- ~~Sem circuit breaker~~ ✅ **v3.0.0**: Asaas + Clicksign protegidos contra cascade failure.
- ~~Sem rate limit distribuído~~ ✅ **v3.0.0**: Upstash Redis — multi-instância, sem race condition.
- **Pentest externo não realizado**: auditoria interna concluída, nenhum critical encontrado. Pentest por empresa especializada obrigatório antes de clientes regulados.
- **2FA não implementado**: autenticação em dois fatores não planejada para MVP.

## LGPD / Privacidade

- ~~Sem portal de privacidade~~ ✅ **v3.0.0**: `/profile/privacy` com exportação e solicitação de exclusão (LGPD Art. 18).
- ~~Sem política de retenção técnica~~ ✅ **v3.0.0**: cron mensal anonimiza PII (5 anos) e preserva financeiros (10 anos).
- ~~Sem encriptação de PII~~ ✅ **v3.0.0**: colunas `*_encrypted` criadas com AES-256-GCM. **⚠️ PENDENTE:** migrar dados existentes de plaintext.
- **DPA formal pendente**: elaborar com advogado LGPD e assinar com farmácias/clínicas antes do go-live comercial.
- ~~**Política de Privacidade / Termos de Uso**~~ ✅ **v5.1.0**: páginas `/privacy` e `/terms` implementadas. **v5.1.4**: `/terms` adicionado às rotas públicas do middleware (bug de acesso sem autenticação corrigido).

## Observabilidade

- ~~Sem logging estruturado~~ ✅ **v3.0.0**: `lib/logger.ts` com JSON logs em todos os services críticos.
- ~~Sem SLOs definidos~~ ✅ **v3.0.0**: `docs/slos.md` com targets, error budgets e alertas de negócio.
- **UptimeRobot não configurado**: monitoramento de `/api/health` a cada 1 min — configuração manual no painel.
- **Log Drain não configurado**: logs do Vercel não persistidos externamente. Avaliar Logtail ou Axiom.

## Inteligência Artificial

- ~~Sem IA na plataforma~~ ✅ **v6.0.0**: 8 features de IA integradas (veja `docs/ai-aplicacoes-estudo.md`).
- **Custo variável**: features de IA usam OpenAI (GPT-4o-mini e GPT-4o Vision). Todos os calls têm circuit breaker — falha graciosa se a API estiver indisponível. Monitorar custo no OpenAI Dashboard.
- **`product_associations` vazia inicialmente**: tabela criada na migration 029. O job semanal popula automaticamente com o algoritmo Apriori após acumular pedidos históricos (mínimo 3 pares co-ocorrentes).
- **OCR limitado a 5 documentos por análise**: por custo e latência, o endpoint OCR processa no máximo 5 arquivos por chamada (GPT-4o Vision).
- **Churn e reorder internos**: detecção de churn e alertas de recompra são visíveis apenas para consultores e super admin — não expostos às clínicas.
- **Classificação de tickets assíncrona**: o GPT classifica o ticket em background após criação. Há um breve intervalo em que `category = GENERAL` e `priority = NORMAL` enquanto a IA processa.
- ~~**Circuit breaker único `'openai'`**~~ ✅ **v6.0.3**: cada função de IA tem breaker independente (`openai-classify`, `openai-sentiment`, `openai-ocr`, `openai-contract`); falha em OCR não afeta triagem de tickets.
- ~~**`analyzeSentiment` sem validação de enum**~~ ✅ **v6.0.3**: whitelist de sentimentos e guarda de boolean adicionados; valor inválido retorna `null` sem risco de violação do CHECK Postgres.
- ~~**`generateContractText` com temperature `0.3`**~~ ✅ **v6.0.3**: reduzido para `0` — corpo do contrato é agora determinístico para os mesmos dados de entrada.
- **`pgvector` não ativado**: busca semântica (H2 do roadmap de IA) requer `CREATE EXTENSION vector` no Supabase e embedding por produto — não implementado no MVP.

## Testes

- ~~Sem testes E2E~~ ✅ **v4.0.0**: Playwright configurado com 5 suítes de testes (auth, admin, orders, privacy, smoke). Pronto para executar contra staging. **v5.1.4**: cobertura de regressão adicionada para acesso público a `/terms` e `/privacy` (`smoke.test.ts` + `01-auth.test.ts`).
- ~~Sem CI/CD~~ ✅ **v4.0.0**: GitHub Actions workflow (`.github/workflows/ci.yml`) — unit + lint + TypeScript + E2E smoke.
- **Testes Inngest**: jobs têm cobertura unitária de registro e lógica de filtros/cálculos (`tests/unit/lib/jobs/`). Para testar o fluxo completo de eventos Inngest, rodar localmente com `npx inngest-cli@latest dev`.

## Padrões arquiteturais — atenção

- **`unstable_cache` + APIs dinâmicas**: nunca usar `cookies()`, `headers()` ou `createClient()` (que usa cookies) dentro de `unstable_cache`. Essas APIs são de escopo de requisição e não estão disponíveis no contexto de revalidação do cache. Usar sempre `createAdminClient()` para queries cacheadas. _(Corrigido no dashboard em v4.2.0)_

## Mobile

- **Web apenas**: responsivo mas otimizado para desktop. App mobile não planejado para MVP.

## Infraestrutura

- ~~`CRON_SECRET`~~ ✅ Configurado no Vercel (Production + Preview + Development)
- ~~Migration 013~~ ✅ Aplicada em produção (fcm_tokens, asaas_fields, contracts)
- ~~Migration 023~~ ✅ Aplicada em produção (colunas PII encrypted)
- ~~Migration 026~~ ✅ Aplicada em produção (`registration_drafts` — captura de leads)
- ~~Migration 027~~ ✅ Aplicada em produção (`coupons`, `order_items` com campos de desconto)
- ~~Migration 028~~ ✅ Aplicada em produção (`used_count` em coupons, trigger atômico)
- ~~Migration 029~~ ✅ Aplicada em produção (`ai_classified` em support_tickets, `sentiment` em support_messages, `product_associations`)
- ~~`OPENAI_API_KEY`~~ ✅ Configurada no Vercel (Production + Preview) — 2026-04-12
- ~~Migration 032~~ ✅ Aplicada em produção (`orders.doctor_id` nullable — médico solicitante opcional em pedidos sem receita)
- **Staging não provisionado**: `clinipharma-staging` no Supabase ainda não criado. Ver `docs/staging-environment.md`.
- **Cloudflare WAF não ativo**: OWASP Core Ruleset + rate limit 100 req/min em `/api/` — configuração manual no painel Cloudflare.

---

## Resumo das pendências bloqueantes para lançamento comercial real

| #   | Pendência              | Por que bloqueia                               | Pré-requisito                     |
| --- | ---------------------- | ---------------------------------------------- | --------------------------------- |
| 1   | **Asaas produção**     | Sem isso, nenhum pagamento real é processado   | CNPJ da empresa                   |
| 2   | **NF-e / NFS-e**       | Obrigação fiscal para operar legalmente        | CNPJ + certificado A1             |
| 3   | **Clicksign produção** | Contratos sandbox não têm valor jurídico pleno | Conta empresarial                 |
| 4   | **Twilio produção**    | SMS test não chega ao destinatário             | Upgrade de conta                  |
| 5   | **WhatsApp**           | Canal principal de conversão no Brasil         | Número dedicado + servidor Docker |
