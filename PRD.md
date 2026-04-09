# Clinipharma — Product Requirements Document (PRD)

## Objetivo

Construir uma plataforma web B2B fechada que intermedie a compra de produtos farmacêuticos entre clínicas/médicos e farmácias parceiras, com controle de pagamento, comissão e rastreabilidade total.

## Usuários

Ver `RBAC_MATRIX.md` para papéis e permissões detalhadas.

## Requisitos Funcionais

### RF-01: Autenticação

- Login com email e senha
- Login com Google (preparado, desativado no MVP)
- Recuperação de senha via email
- Sessão persistente com renovação automática

### RF-02: Catálogo privado

- Listagem de produtos por categoria e farmácia
- Busca por nome, concentração, apresentação
- Filtros por categoria, farmácia, faixa de preço
- Página de produto com galeria, descrição, preço, prazo

### RF-03: Gestão de pedidos

- Criar pedido a partir de um produto do catálogo
- Preço congelado no momento da criação
- Upload de documentação obrigatória
- Acompanhamento de status em tempo real
- Timeline completa do pedido

### RF-04: Gestão financeira

- Registro de cobrança ao cliente
- Confirmação manual de pagamento pelo admin
- Cálculo de comissão configurável
- Registro manual de repasse para farmácia
- Histórico financeiro por pedido

### RF-05: Gestão de entidades

- CRUD de clínicas, médicos, farmácias
- Vinculação médico ↔ clínica
- Gestão de membros por organização

### RF-06: Catálogo (admin)

- CRUD de categorias e produtos
- Upload de imagens de produto
- Histórico de alterações de preço

### RF-07: Auditoria

- Log automático de todas as ações críticas
- Visualização e filtro de logs pelo admin

### RF-08: Configurações

- Percentual de comissão padrão
- Parâmetros globais da plataforma

## Requisitos Não Funcionais

### RNF-01: Segurança

- Autenticação obrigatória em todas as rotas privadas
- RLS no banco de dados
- Validação de permissão no servidor (não apenas UI)
- Sem exposição de dados de outras organizações

### RNF-02: Performance

- Páginas do catálogo renderizadas no servidor (SSR/SSG)
- Imagens otimizadas (Next.js Image)
- Paginação em todas as listas

### RNF-03: Qualidade

- TypeScript sem `any` desnecessário
- ESLint + Prettier
- Testes unitários e E2E

### RNF-04: Manutenibilidade

- Código organizado por domínio
- Documentação atualizada
- Commits semânticos

## Fora do escopo (MVP)

- App mobile
- Gateway de pagamento automático
- Emissão fiscal
- Notificações por email/SMS
- Relatórios avançados
- Integração com ERP
