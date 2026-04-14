# Clinipharma — Visão Geral do Produto

## O problema que resolvemos

Farmácias de manipulação e distribuidoras especializadas vendem para clínicas e médicos, mas esse processo hoje é manual, fragmentado e sem rastreabilidade. Pedidos chegam por WhatsApp, preços mudam sem registro, pagamentos não têm auditoria e repasses são feitos manualmente sem histórico.

Clinipharma resolve isso com uma plataforma intermediária B2B que:

- Centraliza o catálogo de produtos de farmácias de manipulação e distribuidoras de produtos industrializados
- Permite que médicos e clínicas façam pedidos com documentação formal
- Registra pagamentos e comissões
- Controla repasses para farmácias e distribuidoras
- Audita toda a operação

## Quem usa

| Perfil         | O que faz                                                                  |
| -------------- | -------------------------------------------------------------------------- |
| SUPER_ADMIN    | Controle total da plataforma                                               |
| PLATFORM_ADMIN | Opera o dia a dia: catálogo, pedidos, repasses                             |
| CLINIC_ADMIN   | Gerencia a própria clínica, cria pedidos                                   |
| DOCTOR         | Cria pedidos, anexa documentos                                             |
| PHARMACY_ADMIN | Executa pedidos, atualiza status, vê repasses (farmácias e distribuidoras) |

## Como funciona o fluxo principal

```
Farmácia informa produtos/preços
        ↓
Plataforma cadastra produtos no catálogo
        ↓
Médico/Clínica entra logado e visualiza catálogo
        ↓
Escolhe produto → cria pedido → anexa documentação
        ↓
Paga para a plataforma
        ↓
Admin confirma pagamento → calcula comissão → registra repasse
        ↓
Pedido liberado para farmácia
        ↓
Farmácia executa → atualiza status → entrega para clínica
        ↓
Pedido COMPLETED
```

## O que NÃO existe (por design)

- Paciente final no sistema
- Entrega direta ao paciente
- Cotação dinâmica entre farmácias por pedido
- Catálogo público (requer login)
- App mobile (web only no MVP)
- Farmácia alterando preço diretamente no sistema
- Gateway de pagamento automático (MVP usa confirmação manual)

## Modelo financeiro

```
Pedido: R$ 1.000,00
Comissão da plataforma: 15% = R$ 150,00
Repasse para farmácia: R$ 850,00
```

A comissão é configurável globalmente por administrador.

## Catálogo

- Cada produto está vinculado a uma farmácia ou distribuidora específica (`pharmacy_id`)
- Produtos têm flag `is_manipulated` — magistrais/compostos em farmácias vs. industrializados em distribuidoras
- Preço fixo, pré-cadastrado pela plataforma
- Se o preço mudar, a farmácia/distribuidora comunica por fora → plataforma atualiza manualmente
- Sistema registra histórico completo de alterações de preço
- O preço é **congelado** no momento da criação do pedido

## Tipos de fornecedor

| Tipo                    | `entity_type` | Produtos permitidos                                | Diferença na plataforma                       |
| ----------------------- | ------------- | -------------------------------------------------- | --------------------------------------------- |
| Farmácia de manipulação | `PHARMACY`    | Manipulados e industrializados                     | Timeline usa linguagem de manipulação         |
| Distribuidora           | `DISTRIBUTOR` | Apenas industrializados (`is_manipulated = false`) | Timeline usa linguagem de separação/expedição |

Ambos os tipos compartilham o mesmo fluxo de pedidos, pagamentos e repasses. A distinção é transparente para as clínicas.

## Estado atual

MVP funcional para:

- Demonstração comercial
- Onboarding de clínicas, farmácias e distribuidoras
- Operação assistida
