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
- **Sem variações de produto**: cada SKU é um produto separado.
- **Estoque manual**: status `unavailable` gerenciado manualmente, sem integração com estoque real.

## Pedidos

- **Produtos do mesmo fornecedor**: carrinho bloqueia mistura de farmácias (um repasse por pedido).
- **Sem frete**: prazo é o estimado pela farmácia no cadastro do produto.

## Relatórios

- ~~Sem BI avançado~~ ✅ **v1.2.0**: Recharts com 5 tipos de gráfico
- ~~Sem filtro de período~~ ✅ **v1.2.0**: DateRangePicker com 8 presets
- ~~Exportação sem filtro~~ ✅ **v1.2.0**: CSV/Excel respeita período ativo

## Mobile

- **Web apenas**: responsivo mas otimizado para desktop. App mobile não planejado para MVP.

## Infraestrutura

- ~~`CRON_SECRET`~~ ✅ Configurado no Vercel (Production + Preview + Development)
- ~~Migration 013~~ ✅ Aplicada em produção (fcm_tokens, asaas_fields, contracts)

---

## Resumo das pendências bloqueantes para lançamento comercial real

| #   | Pendência              | Por que bloqueia                               | Pré-requisito                     |
| --- | ---------------------- | ---------------------------------------------- | --------------------------------- |
| 1   | **Asaas produção**     | Sem isso, nenhum pagamento real é processado   | CNPJ da empresa                   |
| 2   | **NF-e / NFS-e**       | Obrigação fiscal para operar legalmente        | CNPJ + certificado A1             |
| 3   | **Clicksign produção** | Contratos sandbox não têm valor jurídico pleno | Conta empresarial                 |
| 4   | **Twilio produção**    | SMS test não chega ao destinatário             | Upgrade de conta                  |
| 5   | **WhatsApp**           | Canal principal de conversão no Brasil         | Número dedicado + servidor Docker |
