# Clinipharma — Limitações Conhecidas do MVP

---

## Financeiro

- ~~Sem gateway de pagamento automático~~ ✅ **Implementado na v1.3.0**: Asaas sandbox integrado — PIX QR, boleto e cartão. Webhook confirma pagamento automaticamente.
  - **⚠️ PENDENTE PRODUÇÃO:** criar conta Asaas PJ (requer CNPJ) → gerar API Key real → atualizar `ASAAS_API_KEY` + `ASAAS_API_URL` no Vercel → configurar webhook no painel Asaas.

- **Sem emissão fiscal**: NF-e/NFS-e não integrada.
  - **⚠️ PENDENTE CNPJ:** modelo fiscal definido (Nuvem Fiscal), variáveis pré-configuradas no Vercel com `PENDING_CNPJ`. Após CNPJ + certificado A1 → substituir os 3 valores `NUVEM_FISCAL_*` no Vercel e implementar emissão.

- **Repasse manual**: por design — admin aprova repasse antes de transferir (sem split automático).

## Notificações

- ~~Sem notificações push~~ ✅ **Implementado na v1.3.0**: Firebase FCM com service worker.
  - VAPID key configurada: `BNrMF4L9UwGqH3dHkIZp9-plConcw5YXpcTbfL-mF6_XTv6oIlV10Buw1sgCqd-YVveXECTWcxvWxXgbgf_VQ-U` ✅

- ~~Sem SMS~~ ✅ **Implementado na v1.3.0**: Twilio integrado.
  - **⚠️ PENDENTE PRODUÇÃO:** test credentials ativas (SMS não chegam ao destinatário). Fazer upgrade para conta real Twilio → adquirir número BR → atualizar `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` no Vercel.

- **WhatsApp não ativo**: infraestrutura e templates prontos (Evolution API).
  - **⚠️ PENDENTE:** adquirir número WhatsApp dedicado + deploy Evolution API em Docker (Render plano pago ou Railway) + atualizar `EVOLUTION_API_URL` no Vercel.

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

## Pedidos

- **Produtos do mesmo fornecedor**: carrinho bloqueia mistura de farmácias (um repasse por pedido).
- **Sem frete**: prazo é o estimado pela farmácia no cadastro do produto.
- ~~Sem reorder/templates~~ ✅ **v1.4.0**: templates por clínica + botão "Repetir pedido".
- ~~Sem rastreamento público~~ ✅ **v1.4.0**: `/track/[token]` sem login, timeline visual.

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

## Testes

- ~~Sem testes E2E~~ ✅ **v4.0.0**: Playwright configurado com 5 suítes de testes (auth, admin, orders, privacy, smoke). Pronto para executar contra staging. **v5.1.4**: cobertura de regressão adicionada para acesso público a `/terms` e `/privacy` (`smoke.test.ts` + `01-auth.test.ts`).
- ~~Sem CI/CD~~ ✅ **v4.0.0**: GitHub Actions workflow (`.github/workflows/ci.yml`) — unit + lint + TypeScript + E2E smoke.
- **Testes Inngest**: jobs excluídos do unit coverage por design (requerem Inngest Dev Server). Testar localmente com `npx inngest-cli@latest dev`.

## Padrões arquiteturais — atenção

- **`unstable_cache` + APIs dinâmicas**: nunca usar `cookies()`, `headers()` ou `createClient()` (que usa cookies) dentro de `unstable_cache`. Essas APIs são de escopo de requisição e não estão disponíveis no contexto de revalidação do cache. Usar sempre `createAdminClient()` para queries cacheadas. _(Corrigido no dashboard em v4.2.0)_

## Mobile

- **Web apenas**: responsivo mas otimizado para desktop. App mobile não planejado para MVP.

## Infraestrutura

- ~~`CRON_SECRET`~~ ✅ Configurado no Vercel (Production + Preview + Development)
- ~~Migration 013~~ ✅ Aplicada em produção (fcm_tokens, asaas_fields, contracts)
- ~~Migration 023~~ ✅ Aplicada em produção (colunas PII encrypted)
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
