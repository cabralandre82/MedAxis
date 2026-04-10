# Clinipharma — Limitações Conhecidas do MVP

## Financeiro

- **Sem gateway de pagamento automático**: confirmação de pagamento é manual pelo admin
- **Sem emissão fiscal**: NF-e/NFS-e não integrada
- **Sem split de pagamento automático**: repasse é registrado manualmente

## Autenticação

- **Recuperação de senha via rota própria**: usa `admin.generateLink()` + Resend diretamente. O SMTP do Supabase Auth não está configurado (tentativa falhou silenciosamente; Auth Hook HTTPS também não disparava). A solução atual é robusta e funciona em produção.
- **Google OAuth preparado mas não ativado**: precisa de configuração manual no Google Cloud Console
- **Sem 2FA**: autenticação em dois fatores não implementada

## Produtos

- **Farmácia não altera produtos diretamente**: toda atualização de catálogo passa pela plataforma
- **Sem variações de produto**: cada SKU é um produto separado
- **Produto indisponível sem estoque real**: o status `unavailable` é gerenciado manualmente pelo SUPER_ADMIN; não há integração com estoque de farmácias

## Pedidos

- **Todos os produtos do pedido devem ser da mesma farmácia**: o carrinho bloqueia a mistura de farmácias para garantir um único repasse por pedido
- **Sem estimativa de frete**: prazo é o estimado pela farmácia no cadastro do produto

## Notificações

- **Sem notificações push ou SMS**: apenas notificações in-app e emails transacionais
- ~~Sem preferências de notificação por usuário~~ ✅ **Implementado na v1.2.0**: usuários podem silenciar tipos não-críticos em `/profile`
- ~~Sem alertas de pedidos parados~~ ✅ **Implementado na v1.2.0**: widget no dashboard + Vercel Cron diário (08h) notifica SUPER_ADMIN e PHARMACY_ADMIN

## Mobile

- **Web apenas**: não existe app mobile no MVP
- **Responsivo**: a interface funciona em mobile, mas é otimizada para desktop

## Relatórios

- ~~Sem BI avançado: gráficos são CSS puro sem biblioteca interativa~~ ✅ **Implementado na v1.2.0**: Recharts com 5 tipos de gráfico (barras, donut, horizontal)
- ~~Sem filtro de período em relatórios~~ ✅ **Implementado na v1.2.0**: DateRangePicker com 8 presets
- ~~Exportação sem filtro de período~~ ✅ **Implementado na v1.2.0**: CSV/Excel respeita o período ativo na tela

## Infraestrutura

- ~~`CRON_SECRET` deve ser adicionado manualmente no Vercel~~ ✅ **Configurado**: adicionado via API em Production + Preview + Development. Redeploy concluído.

## Integrações futuras planejadas

- Gateway de pagamento (Stripe, PagSeguro, Asaas)
- Emissão fiscal (NF-e/NFS-e)
- Assinatura eletrônica de documentos
- Notificações push / SMS / WhatsApp
- App mobile
- Integração com ERP de farmácias
