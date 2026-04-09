# Fluxo Manual de Atualização de Preço

## Quando usar

Quando uma farmácia informa que o preço de um produto mudou.

## Passo a passo

1. Acesse **Clinipharma → Produtos**
2. Localize o produto cujo preço precisa ser atualizado
3. Clique em **Editar** ou abra o detalhe do produto
4. Localize o campo **Preço atual**
5. Clique em **Alterar Preço**
6. Preencha o formulário:
   - Novo preço
   - Motivo da alteração (obrigatório — ex: "Atualização de outubro/2026 informada pela farmácia")
7. Clique em **Salvar**

## O que acontece

1. `products.price_current` é atualizado com o novo valor
2. Um registro é criado em `product_price_history` com:
   - Preço anterior
   - Novo preço
   - Usuário que fez a alteração
   - Data e hora
   - Motivo
3. Pedidos já existentes **não são afetados** (preço congelado por design)
4. Registro em `audit_logs`

## Pedidos em aberto com preço antigo

Pedidos com status diferente de `COMPLETED` ou `CANCELED` que foram criados antes da mudança de preço **mantêm** o preço original. Não existe ajuste retroativo automático.

Se necessário ajuste manual, isso deve ser feito diretamente no banco por um SUPER_ADMIN, com justificativa documentada.
