# Fluxo Manual de Repasse para Farmácia

## Pré-condições

O repasse só pode ser registrado quando:

- Pagamento confirmado (`payment_status = CONFIRMED`)
- Comissão calculada (registro em `commissions`)

## Passo a passo

### 1. Calcular comissão

1. Acesse o detalhe do pedido
2. Na seção **Financeiro**, clique em **Calcular Comissão**
3. O sistema usa a configuração global (padrão: 15%)
4. Revise os valores:
   - Valor bruto do pedido
   - Percentual de comissão
   - Valor da comissão
   - Valor líquido para a farmácia
5. Clique em **Confirmar Cálculo**

### 2. Registrar repasse

1. Acesse **Clinipharma → Repasses**
2. Localize o repasse com status `PENDING`
3. Realize a transferência bancária para a farmácia (fora do sistema)
4. Volte ao sistema e clique no repasse
5. Clique em **Registrar Repasse Realizado**
6. Preencha:
   - Referência da transferência
   - Data de realização
   - Observações
7. Opcionalmente, faça upload do comprovante
8. Clique em **Salvar**

## O que acontece após o registro

1. `transfers.status` muda para `COMPLETED`
2. `orders.transfer_status` muda para `COMPLETED`
3. `orders.order_status` muda para `RELEASED_FOR_EXECUTION`
4. A farmácia passa a ver o pedido no painel dela
5. Registros em `order_status_history` e `audit_logs`
