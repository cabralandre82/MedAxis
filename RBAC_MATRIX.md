# Clinipharma — Matriz de Permissões (RBAC)

## Papéis

| Papel              | Descrição                                                          |
| ------------------ | ------------------------------------------------------------------ |
| `SUPER_ADMIN`      | Acesso total, configurações globais, gestão de consultores         |
| `PLATFORM_ADMIN`   | Operação diária: catálogo, pedidos, financeiro, entidades          |
| `CLINIC_ADMIN`     | Gerencia sua clínica, cria pedidos, acompanha financeiro           |
| `DOCTOR`           | Cria pedidos, anexa documentos, acompanha status                   |
| `PHARMACY_ADMIN`   | Executa pedidos, atualiza status, vê repasses da farmácia          |
| `SALES_CONSULTANT` | Visualiza suas clínicas vinculadas e extrato de comissões próprias |

---

## Módulo: Clínicas

| Ação               | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ------------------ | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Listar todas       |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver própria        |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       | ✅ (vinculadas)  |
| Criar              |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Editar             |     ✅      |       ✅       | ✅ (própria) |   ❌   |       ❌       |        ❌        |
| Bloquear/Ativar    |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Vincular consultor |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Médicos

| Ação            | SUPER_ADMIN | PLATFORM_ADMIN |  CLINIC_ADMIN   |    DOCTOR    | PHARMACY_ADMIN | SALES_CONSULTANT |
| --------------- | :---------: | :------------: | :-------------: | :----------: | :------------: | :--------------: |
| Listar todos    |     ✅      |       ✅       | ✅ (vinculados) |      ❌      |       ❌       |        ❌        |
| Ver perfil      |     ✅      |       ✅       | ✅ (vinculados) | ✅ (próprio) |       ❌       |        ❌        |
| Criar           |     ✅      |       ✅       |       ❌        |      ❌      |       ❌       |        ❌        |
| Editar          |     ✅      |       ✅       |       ❌        | ✅ (próprio) |       ❌       |        ❌        |
| Bloquear/Ativar |     ✅      |       ✅       |       ❌        |      ❌      |       ❌       |        ❌        |

## Módulo: Farmácias

| Ação            | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| --------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Listar todas    |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver própria     |     ✅      |       ✅       |      ❌      |   ❌   |       ✅       |        ❌        |
| Criar           |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Editar          |     ✅      |       ✅       |      ❌      |   ❌   |  ✅ (própria)  |        ❌        |
| Bloquear/Ativar |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Produtos / Catálogo

| Ação                   | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ---------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Visualizar catálogo    |     ✅      |       ✅       |      ✅      |   ✅   |       ✅       |        ❌        |
| Criar produto          |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Editar produto         |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Alterar preço          |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver histórico de preço |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Pedidos

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN |    DOCTOR    |  PHARMACY_ADMIN  |  SALES_CONSULTANT  |
| ----------------- | :---------: | :------------: | :----------: | :----------: | :--------------: | :----------------: |
| Listar todos      |     ✅      |       ✅       |      ❌      |      ❌      |        ❌        |         ❌         |
| Listar próprios   |     ✅      |       ✅       | ✅ (clínica) |  ✅ (seus)   |  ✅ (farmácia)   | ✅ (suas clínicas) |
| Criar pedido      |     ✅      |       ✅       |      ✅      |      ✅      |        ❌        |         ❌         |
| Upload documentos |     ✅      |       ✅       |      ✅      |      ✅      |        ❌        |         ❌         |
| Cancelar          |     ✅      |       ✅       | ✅ (próprio) | ✅ (próprio) |        ❌        |         ❌         |
| Mudar status      |     ✅      |       ✅       |      ❌      |      ❌      | ✅ (operacional) |         ❌         |

## Módulo: Pagamentos

| Ação                 | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| -------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Ver todos pagamentos |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver próprios         |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       |        ❌        |
| Confirmar pagamento  |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Anexar comprovante   |     ✅      |       ✅       |      ✅      |   ✅   |       ❌       |        ❌        |

## Módulo: Repasses (Farmácias)

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ----------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Ver todos         |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver próprios      |     ✅      |       ✅       |      ❌      |   ❌   |       ✅       |        ❌        |
| Registrar repasse |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Calcular comissão |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Consultores de Vendas

| Ação                         | SUPER_ADMIN | PLATFORM_ADMIN  | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ---------------------------- | :---------: | :-------------: | :----------: | :----: | :------------: | :--------------: |
| Listar consultores           |     ✅      | ✅ (só leitura) |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver detalhe do consultor     |     ✅      | ✅ (só leitura) |      ❌      |   ❌   |       ❌       |        ❌        |
| Cadastrar consultor          |     ✅      |       ❌        |      ❌      |   ❌   |       ❌       |        ❌        |
| Editar consultor             |     ✅      |       ❌        |      ❌      |   ❌   |       ❌       |        ❌        |
| Vincular consultor à clínica |     ✅      |       ❌        |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver extrato próprio          |      —      |        —        |      —       |   —    |       —        |        ✅        |
| Ver clínicas vinculadas      |      —      |        —        |      —       |   —    |       —        |        ✅        |

## Módulo: Repasses a Consultores

| Ação                      | SUPER_ADMIN | PLATFORM_ADMIN  | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ------------------------- | :---------: | :-------------: | :----------: | :----: | :------------: | :--------------: |
| Ver comissões pendentes   |     ✅      | ✅ (só leitura) |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver histórico de repasses |     ✅      | ✅ (só leitura) |      ❌      |   ❌   |       ❌       |        ❌        |
| Registrar repasse         |     ✅      |       ❌        |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver extrato próprio       |      —      |        —        |      —       |   —    |       —        |  ✅ (dashboard)  |

## Módulo: Auditoria

| Ação              | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ----------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Ver todos os logs |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Configurações

| Ação                         | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ---------------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Editar configurações globais |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver configurações            |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Usuários

| Ação                  | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| --------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Listar usuários       |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Criar usuário         |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Redefinir senha       |     ✅      |       ✅       |      ❌      |   ❌   |       ❌       |        ❌        |
| Editar perfil próprio |     ✅      |       ✅       |      ✅      |   ✅   |       ✅       |        ✅        |

## Módulo: Solicitações de cadastro

| Ação                            | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ------------------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Enviar solicitação (público)    |      —      |       —        |     Auto     |  Auto  |       ❌       |        ❌        |
| Listar todas as solicitações    |     ✅      |  ✅ (leitura)  |      ❌      |   ❌   |       ❌       |        ❌        |
| Ver detalhe + documentos        |     ✅      |  ✅ (leitura)  |      ❌      |   ❌   |       ❌       |        ❌        |
| Aprovar                         |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |
| Reprovar (com motivo)           |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |
| Solicitar documentos adicionais |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |

## Módulo: Interesses em produtos

| Ação                    | SUPER_ADMIN | PLATFORM_ADMIN | CLINIC_ADMIN | DOCTOR | PHARMACY_ADMIN | SALES_CONSULTANT |
| ----------------------- | :---------: | :------------: | :----------: | :----: | :------------: | :--------------: |
| Registrar interesse     |      —      |       —        |      ✅      |   ✅   |       ❌       |        ❌        |
| Ver todos os interesses |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |
| Receber notificação     |     ✅      |       ❌       |      ❌      |   ❌   |       ❌       |        ❌        |
