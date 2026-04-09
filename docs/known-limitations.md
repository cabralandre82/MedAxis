# Clinipharma — Limitações Conhecidas do MVP

## Financeiro

- **Sem gateway de pagamento automático**: confirmação de pagamento é manual pelo admin
- **Sem emissão fiscal**: NF-e/NFS-e não integrada
- **Sem split de pagamento automático**: repasse é registrado manualmente

## Autenticação

- **SMTP personalizado não configurado no Supabase Auth**: emails de recuperação de senha usam o servidor padrão do Supabase (limite de 3/hora no plano gratuito). Para remover a limitação, configurar Resend SMTP no Supabase Auth conforme `docs/setup-email.md` Parte 2.
- **Google OAuth preparado mas não ativado**: precisa de configuração manual no Google Cloud Console
- **Sem autenticação por convite**: novos usuários são cadastrados manualmente pelo admin

## Produtos

- **Farmácia não altera produtos diretamente**: toda atualização de catálogo passa pela plataforma
- **Sem variações de produto**: cada SKU é um produto separado

## Pedidos

- **Todos os produtos do pedido devem ser da mesma farmácia**: o carrinho bloqueia a mistura de farmácias para garantir um único repasse por pedido
- **Sem estimativa de frete**: prazo é o estimado pela farmácia no cadastro do produto

## Notificações

- **Sem notificações push ou SMS**: apenas notificações in-app e emails transacionais
- **Sem preferências de notificação por usuário**: todas as notificações são enviadas para os papéis relevantes

## Mobile

- **Web apenas**: não existe app mobile no MVP
- **Responsivo**: a interface funciona em mobile, mas é otimizada para desktop

## Relatórios

- **Sem BI avançado**: gráficos são CSS puro (barras) sem biblioteca de charts interativa
- **Exportação limitada ao período atual**: não há filtro de período na exportação CSV/Excel

## Integrações futuras planejadas

- Gateway de pagamento (Stripe, PagSeguro, Asaas)
- Emissão fiscal (NF-e/NFS-e)
- Assinatura eletrônica de documentos
- Notificações push / SMS / WhatsApp
- App mobile
- Integração com ERP de farmácias
- Gráficos interativos (Recharts ou Chart.js)
- Filtro de período em relatórios e exportações
