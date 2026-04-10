# Clinipharma — Fluxos do Usuário

## UF-01: Fluxo principal de pedido

```
1. Usuário faz login
2. Acessa /catalog
3. Navega por produtos (filtra por categoria/farmácia, busca por nome)
4. Clica em "Ver detalhes" no produto de interesse
5. Na página do produto (/catalog/[slug]), clica em "Solicitar Pedido"
6. Formulário de novo pedido (/orders/new?product=<id>):
   - Produto já carregado
   - Seleciona clínica
   - Seleciona médico
   - Define quantidade
   - Adiciona observações (opcional)
   - Faz upload dos documentos obrigatórios
7. Revisa o resumo do pedido (preço, total, farmácia)
8. Confirma criação do pedido
9. Pedido criado com status AWAITING_PAYMENT
10. Usuário é redirecionado para /orders/<id>
```

## UF-02: Confirmação de pagamento (admin)

```
1. PLATFORM_ADMIN acessa /payments
2. Localiza pagamento PENDING
3. Abre o detalhe do pagamento
4. Verifica comprovante (externo ao sistema)
5. Clica em "Confirmar Pagamento"
6. Preencha método, referência, observações
7. Sistema atualiza payment_status e order_status
8. Dispara cálculo de comissão
```

## UF-03: Repasse para farmácia (admin)

```
1. PLATFORM_ADMIN acessa /transfers
2. Localiza repasse PENDING
3. Realiza transferência bancária externamente
4. Clica em "Registrar Repasse"
5. Preenche referência, data, comprovante
6. Sistema marca transfer como COMPLETED
7. order_status muda para RELEASED_FOR_EXECUTION
8. Farmácia passa a ver o pedido no painel
```

## UF-04: Execução pela farmácia

```
1. PHARMACY_ADMIN acessa /orders (vê apenas os da sua farmácia)
2. Localiza pedido com status RELEASED_FOR_EXECUTION
3. Clica em "Confirmar Recebimento" → RECEIVED_BY_PHARMACY
4. Inicia execução → IN_EXECUTION
5. Produto pronto → READY
6. Enviado para clínica → SHIPPED (com tracking se disponível)
7. Confirmação de entrega → DELIVERED
8. Pedido concluído → COMPLETED
```

## UF-05: Cadastro de produto (admin)

```
1. PLATFORM_ADMIN acessa /products
2. Clica em "Novo Produto"
3. Preenche:
   - Categoria, Farmácia vinculada
   - Nome, SKU, slug
   - Concentração, Apresentação
   - Descrição curta e longa
   - Características (JSON ou campos)
   - Preço, Prazo estimado
4. Faz upload de imagens
5. Ativa o produto
6. Produto aparece no catálogo
```

## UF-06: Atualização de preço (admin)

```
1. PLATFORM_ADMIN localiza o produto
2. Clica em "Alterar Preço"
3. Informa novo preço e motivo
4. Sistema registra histórico
5. Pedidos existentes não são afetados
```

## UF-08: Auto-cadastro de clínica ou médico

```
Solicitante (sem conta):
1. Acessa /login → clica em "Solicitar cadastro"
2. Em /registro, escolhe perfil: "Clínica / Consultório" ou "Médico"
3. Preenche dados cadastrais (nome, CNPJ/CRM, email, telefone, endereço, senha)
4. Faz upload dos documentos obrigatórios
5. Clica em "Enviar solicitação"
6. Sistema cria conta com registration_status = PENDING
7. Solicitante recebe email de confirmação
8. SUPER_ADMIN recebe email + notificação in-app
9. Solicitante pode fazer login imediatamente (vê banner de "em análise")
10. Não consegue criar pedidos até aprovação
```

## UF-09: Aprovação / reprovação de cadastro (SUPER_ADMIN)

```
Aprovação:
1. SUPER_ADMIN acessa /registrations
2. Filtra por "Aguardando análise"
3. Clica em "Analisar →" na solicitação
4. Revisa dados e documentos
5. Clica em "Aprovar cadastro"
6. Sistema: cria entidade → atualiza registration_status → envia welcome email
7. Solicitante recebe email com link "Definir minha senha"
8. Solicitante clica no link → /auth/callback → /reset-password → define senha
9. Acesso completo à plataforma liberado

Reprovação:
1. SUPER_ADMIN acessa detalhe da solicitação
2. Clica em "Reprovar" → modal para informar motivo
3. Confirma → sistema envia email com motivo ao solicitante
4. registration_status = REJECTED

Pedido de documentos:
1. SUPER_ADMIN acessa detalhe da solicitação
2. Clica em "Pedir documentos"
3. Seleciona documentos da lista (ou escreve "Outro")
4. Confirma → email + notificação in-app ao solicitante
5. registration_status = PENDING_DOCS
6. Solicitante faz upload via /profile
7. Admin recebe notificação; analisa novamente → aprovação ou reprovação
```

## UF-10: Médico com múltiplas clínicas criando um pedido

```
1. Médico acessa /orders/new
2. Na seção "Dados do pedido", dropdown "Clínica" exibe apenas as clínicas vinculadas ao médico
3. Se o médico tiver apenas uma clínica vinculada, ela é auto-selecionada
4. Médico seleciona a clínica desejada para o pedido
5. Fluxo normal de pedido continua (selecionar produtos, quantidade, documentos)
```

## UF-07: Login e recuperação de senha

```
Login:
1. Acessa /login
2. Informa email e senha
3. Redireciona para /dashboard

Recuperação de senha:
1. Clica em "Esqueci minha senha"
2. Informa email
3. Recebe email com link de recuperação
4. Clica no link → /auth/callback
5. Define nova senha
6. Redireciona para /dashboard
```
