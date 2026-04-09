# Fluxo Manual de Confirmação de Pagamento

## Quando usar este fluxo

Quando a clínica ou médico informa que realizou o pagamento e o admin precisa confirmar.

## Passo a passo

1. Acesse **Clinipharma → Pagamentos**
2. Localize o pagamento com status `PENDING` ou `UNDER_REVIEW`
3. Clique no pagamento para abrir o detalhe
4. Verifique o comprovante (se o cliente enviou)
5. Se o pagamento foi confirmado no banco:
   - Clique em **Confirmar Pagamento**
   - Informe o método de pagamento
   - Informe o código de referência (se disponível)
   - Opcionalmente, faça upload do comprovante
   - Adicione observações se necessário
6. Clique em **Salvar**

## O que acontece após a confirmação

1. `payments.status` muda para `CONFIRMED`
2. `orders.payment_status` muda para `CONFIRMED`
3. `orders.order_status` muda para `PAYMENT_CONFIRMED`
4. Registro em `order_status_history`
5. Registro em `audit_logs`
6. O pedido fica pronto para cálculo de comissão

## Próximo passo

Após confirmar o pagamento, prossiga com o cálculo de comissão.
Ver `docs/manual-transfer-flow.md`.
