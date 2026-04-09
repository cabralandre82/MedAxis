# Clinipharma — Limitações Conhecidas do MVP

## Financeiro

- **Sem gateway de pagamento automático**: confirmação de pagamento é manual pelo admin
- **Sem emissão fiscal**: NF-e/NFS-e não integrada
- **Sem split de pagamento automático**: repasse é registrado manualmente
- **pharmacy_cost sem histórico**: alterações em `pharmacy_cost` não são rastreadas (diferente de `price_current` que tem `product_price_history`). Pedidos já criados estão protegidos pelo congelamento, mas não há log do valor anterior para auditoria

## Autenticação

- **SMTP personalizado não configurado**: o Supabase gratuito tem limite de 3 emails/hora. Para produção, conectar Resend, SendGrid ou Postmark
- **Google OAuth preparado mas não ativado**: precisa de configuração manual no Google Cloud Console
- **Sem autenticação por convite**: novos usuários são cadastrados manualmente pelo admin

## Produtos

- **Farmácia não altera produtos diretamente**: toda atualização de catálogo passa pela plataforma
- **Sem variações de produto**: cada SKU é um produto separado

## Pedidos

- **Sem múltiplos produtos por pedido**: 1 pedido = 1 produto. Para múltiplos produtos, múltiplos pedidos
- **Sem estimativa de frete**: prazo é o estimado pela farmácia no cadastro do produto

## Notificações

- **Sem notificações push ou SMS**: toda comunicação é feita dentro da plataforma
- **Sem emails transacionais automáticos**: no MVP, updates são visualizados na plataforma

## Mobile

- **Web apenas**: não existe app mobile no MVP
- **Responsivo**: a interface funciona em mobile, mas é otimizada para desktop

## Relatórios

- **Relatórios básicos apenas**: sem BI avançado, sem exportação para Excel no MVP

## Integrações futuras planejadas

- Gateway de pagamento (Stripe, PagSeguro, Asaas)
- Emissão fiscal
- Assinatura eletrônica de documentos
- Notificações via email/SMS/WhatsApp
- App mobile
- Integração com sistemas de ERP de farmácias
