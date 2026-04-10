# Clinipharma — Regras de Negócio

## RN-01: Catálogo fechado

O catálogo de produtos só é acessível para usuários autenticados. Nenhuma rota de catálogo é pública.

## RN-02: Produto deve existir antes do pedido

Nenhum pedido pode ser criado sem um produto previamente cadastrado no sistema. Não existe pedido "avulso".

## RN-03: Preço congelado no pedido

O `unit_price` do pedido é copiado de `products.price_current` no momento da criação. Se o produto mudar de preço depois, pedidos já existentes não são afetados.

## RN-04: Histórico obrigatório de alteração de preço

Toda alteração em `products.price_current` deve:

- Salvar o valor anterior em `product_price_history.old_price`
- Salvar o valor novo em `product_price_history.new_price`
- Registrar o usuário responsável
- Registrar a data/hora
- Exigir um motivo

## RN-05: Somente admins da plataforma alteram preços

`CLINIC_ADMIN`, `DOCTOR` e `PHARMACY_ADMIN` não têm permissão para alterar `price_current` de nenhum produto.

## RN-06: Documentação obrigatória antes de avançar

Um pedido não pode sair do status `AWAITING_DOCUMENTS` sem que os documentos obrigatórios tenham sido upados. O sistema deve validar isso antes de qualquer transição de status.

## RN-07: Timeline obrigatória

Toda mudança de `order_status` deve registrar uma linha em `order_status_history` com:

- Status anterior
- Status novo
- Usuário responsável
- Data/hora
- Motivo (opcional mas recomendado)

## RN-08: Liberação para execução exige 3 condições

O pedido só muda para `RELEASED_FOR_EXECUTION` após:

1. `payment_status = CONFIRMED`
2. Comissão calculada (registro em `commissions`)
3. Repasse registrado como `COMPLETED` em `transfers`

## RN-09: Isolamento de dados por organização

- Clínica só vê seus próprios pedidos
- Farmácia só vê pedidos destinados a ela
- Médico só vê pedidos criados por ele ou vinculados à clínica dele
- Nenhum usuário comum vê dados de outra organização

## RN-10: Audit log obrigatório em ações críticas

As seguintes ações devem sempre gerar um registro em `audit_logs`:

- Login de usuário
- Criação/edição de clínica
- Criação/edição de médico
- Criação/edição de farmácia
- Criação/edição de produto
- Alteração de preço
- Criação de pedido
- Qualquer mudança de status de pedido
- Confirmação de pagamento
- Registro de repasse
- Alteração de configuração global

## RN-11: Fail-fast

O sistema nunca deve silenciar erros. Toda falha de validação deve retornar mensagem clara para o usuário. Não existe "funcionar sem avisar que algo deu errado".

## RN-12: RLS no Supabase

As tabelas do banco devem ter Row Level Security habilitada. A segurança não deve depender apenas da UI.

## RN-13: Validação no servidor

Server Actions e Route Handlers devem sempre validar:

- Autenticação do usuário
- Permissão de papel (RBAC)
- Integridade dos dados com Zod
- Nunca confiar apenas no frontend

## RN-14: Código humano do pedido

Cada pedido recebe um código legível único no formato `CP-YYYY-NNNNNN` (ex: `CP-2026-000001`). Esse código é gerado automaticamente via trigger no banco.

## RN-15: Farmácia não altera produto no MVP

`PHARMACY_ADMIN` não pode criar, editar ou excluir produtos ou preços no MVP. Isso é responsabilidade exclusiva de `PLATFORM_ADMIN` e `SUPER_ADMIN`.

## RN-16: Custo de repasse à farmácia é obrigatório por produto

Todo produto deve ter um `pharmacy_cost` definido. Esse valor representa o montante fixo que a plataforma deve repassar à farmácia por unidade vendida, independente do preço ao cliente.

## RN-17: Congelamento completo dos valores financeiros no pedido

No momento da criação do pedido, o trigger `freeze_order_price` copia e congela em `orders`:

- `unit_price` ← `products.price_current`
- `total_price` ← `unit_price × quantity`
- `pharmacy_cost_per_unit` ← `products.pharmacy_cost`
- `platform_commission_per_unit` ← `price_current − pharmacy_cost`

Alterações futuras no produto não afetam pedidos já criados.

## RN-18: Margem da plataforma é derivada do custo de farmácia

A margem bruta da plataforma sobre qualquer pedido é:

```
margem_bruta = (price_current − pharmacy_cost) × quantity
```

O valor `pharmacy_cost` nunca é reduzido — a farmácia sempre recebe o que foi acordado no cadastro do produto.

## RN-20: Auto-cadastro gera acesso imediato com restrições

Clínicas e médicos que se auto-cadastrarem em `/registro` têm conta criada imediatamente e podem fazer login. No entanto, enquanto `registration_status ≠ APPROVED`, o acesso é restrito:

- O dashboard exibe um banner informando o status atual (em análise, documentos pendentes ou reprovado)
- O acesso a `/orders/new` é bloqueado com redirecionamento automático para `/dashboard`
- Todas as demais telas de leitura (catálogo, perfil etc.) são acessíveis normalmente

## RN-21: Somente SUPER_ADMIN aprova ou reprova cadastros

Ações sobre `registration_requests` (aprovar, reprovar, solicitar documentos) são exclusivas do papel `SUPER_ADMIN`. `PLATFORM_ADMIN` pode visualizar a lista e os detalhes, mas não pode executar ações.

## RN-22: Aprovação cria a entidade e envia welcome email

Ao aprovar uma solicitação de cadastro, o sistema automaticamente:

1. Cria a entidade no banco (`clinics` ou `doctors`) com os dados do formulário
2. Cria o vínculo do usuário à entidade (membro da clínica ou link médico-clínica, se aplicável)
3. Atualiza `profiles.registration_status` para `APPROVED`
4. Envia email de boas-vindas com link para o usuário definir a própria senha (via `generateLink` com `type: recovery`)

## RN-23: Farmácias não possuem auto-cadastro

O cadastro de farmácias é exclusivo do SUPER_ADMIN. Ao criar a farmácia, o sistema cria o usuário `PHARMACY_ADMIN` vinculado sem senha e envia welcome email com link para definição de senha. O admin nunca define a senha manualmente.

## RN-24: Médico com múltiplas clínicas deve selecionar a clínica no pedido

Um médico pode estar vinculado a múltiplas clínicas via `doctor_clinic_links`. Ao criar um pedido, o dropdown de clínica é filtrado para exibir apenas as clínicas vinculadas àquele médico. Se houver apenas uma, ela é auto-selecionada.

## RN-25: Documentos obrigatórios por tipo de entidade

Os documentos mínimos exigidos na solicitação de cadastro são:

- **Clínica:** Cartão CNPJ, Alvará de funcionamento, RG/CPF do responsável
- **Médico:** Carteira CRM, RG/CPF

O SUPER_ADMIN pode solicitar documentos adicionais (lista predefinida ou campo livre "Outro") em qualquer momento durante a análise. Quando solicitados, o status muda para `PENDING_DOCS` e o solicitante é notificado por email e in-app.

## RN-19: Taxa de comissão dos consultores é global e única

A comissão dos consultores de vendas é definida como um único percentual global em `app_settings.consultant_commission_rate`, aplicado sobre o `total_price` do pedido. Se a taxa mudar, todos os consultores são afetados a partir dos próximos pedidos; pedidos já criados usam os valores congelados.

A plataforma deve avisar o operador quando `pharmacy_cost` de um produto for tão alto que `platform_commission_per_unit` seja menor que `consultant_commission_rate × price_current`, pois nesse caso a plataforma absorve o custo do consultor sem lucro no produto. O sistema **não bloqueia** o cadastro, apenas exibe aviso.
