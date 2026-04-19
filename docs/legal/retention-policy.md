# POLÍTICA DE RETENÇÃO E ELIMINAÇÃO DE DADOS PESSOAIS

**Versão:** 1.0
**Data de vigência:** 18 de abril de 2026
**Última atualização:** 18 de abril de 2026
**Próxima revisão obrigatória:** 18 de outubro de 2026 (semestral)
**Aprovação:** Encarregado de Proteção de Dados (DPO) + Diretoria Executiva
**Ciclo:** revisada a cada inclusão de tabela com dado pessoal e/ou alteração legal aplicável

---

## 1. OBJETIVO E ESCOPO

Esta Política estabelece, para todas as bases de dados operadas pela
Plataforma Clinipharma, **prazos máximos de retenção, base legal,
mecanismos de eliminação automática** e exceções aplicáveis a dados
pessoais e dados pessoais sensíveis (saúde).

A política aplica-se a:

- Todas as tabelas do banco transacional (Supabase Postgres);
- Buckets de armazenamento de objetos (Supabase Storage);
- Logs estruturados da aplicação e logs de cron;
- Backups e snapshots gerenciados pelo provedor;
- Espelhos locais de documentos assinados eletronicamente.

> **Fonte de verdade técnica:** o catálogo tipado em
> [`lib/retention/policies.ts`](../../lib/retention/policies.ts). Toda
> alteração desta Política DEVE ser refletida no catálogo (e vice-versa).
> Há teste de invariantes (`tests/unit/lib/retention-catalog.test.ts`)
> que bloqueia drift de campos críticos.

---

## 2. PRINCÍPIOS NORTEADORES

| Princípio                                | Aplicação prática                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Necessidade (LGPD art. 6º, III)**      | Cada categoria tem prazo definido com base estrita na finalidade que a justificou.                 |
| **Adequação (LGPD art. 6º, II)**         | Bases legais por categoria documentadas (art. 7º e 11).                                            |
| **Transparência (LGPD art. 6º, VI)**     | Esta política é pública (`/legal/retention`).                                                      |
| **Segurança (LGPD art. 6º, VII)**        | Eliminação preserva trilha de auditoria (anonimização ao invés de DELETE quando necessário).       |
| **Não-discriminação (LGPD art. 6º, IX)** | A política aplica-se uniformemente, sem exceção para titular individual fora das hipóteses legais. |
| **Responsabilização (LGPD art. 6º, X)**  | Catálogo versionado, cron com `withCronGuard`, testes automatizados.                               |

---

## 3. CATEGORIAS, PRAZOS E BASE LEGAL

A tabela a seguir é um espelho **legível por humanos** do catálogo em
`lib/retention/policies.ts`. A coluna **ID** é estável e referenciável em
contratos, DPAs e respostas a titulares.

### 3.1 Identidade e contas

| ID        | Tabela           | Categoria                         | Prazo                                      | Base legal          | Mecanismo                          |
| --------- | ---------------- | --------------------------------- | ------------------------------------------ | ------------------- | ---------------------------------- |
| **RP-01** | `profiles`       | Perfis B2B (CRM, CRF, CNPJ, etc.) | **5 anos após desativação** (anonimização) | LGPD art. 16, II/IV | Cron mensal `enforce-retention`    |
| **RP-02** | `auth.users`     | Identidades de autenticação       | 5 anos após desativação                    | LGPD art. 16, II    | Cron mensal `enforce-retention`    |
| **RP-03** | `revoked_tokens` | Denylist de JWT                   | 24 horas após `expires_at`                 | LGPD art. 7º, IX    | Cron diário `purge-revoked-tokens` |

### 3.2 Pedidos e receitas

| ID        | Tabela          | Categoria              | Prazo       | Base legal                          | Mecanismo               |
| --------- | --------------- | ---------------------- | ----------- | ----------------------------------- | ----------------------- |
| **RP-04** | `orders`        | Pedidos de manipulação | **10 anos** | RDC ANVISA 67/2007; CTN art. 195    | Preservação obrigatória |
| **RP-05** | `order_items`   | Itens dos pedidos      | 10 anos     | RDC ANVISA 67/2007                  | Preservação obrigatória |
| **RP-06** | `prescriptions` | Receitas (imagem/PDF)  | **10 anos** | Portaria SVS/MS 344/98; RDC 67/2007 | Imutável após upload    |

### 3.3 Financeiro

| ID        | Tabela                 | Categoria       | Prazo   | Base legal                        | Mecanismo               |
| --------- | ---------------------- | --------------- | ------- | --------------------------------- | ----------------------- |
| **RP-07** | `payments`             | Transações      | 10 anos | CTN art. 195; Lei 9.430/96        | Preservação obrigatória |
| **RP-08** | `commissions`          | Comissões       | 10 anos | CTN art. 195; Cód. Civil art. 206 | Preservação obrigatória |
| **RP-09** | `consultant_transfers` | Repasses        | 10 anos | CTN art. 195                      | Preservação obrigatória |
| **RP-10** | `nfse_records`         | NFS-e (espelho) | 5 anos  | CTN art. 173                      | Preservação obrigatória |

### 3.4 Comunicações e notificações

| ID        | Tabela                                   | Categoria           | Prazo       | Base legal       | Mecanismo                        |
| --------- | ---------------------------------------- | ------------------- | ----------- | ---------------- | -------------------------------- |
| **RP-11** | `notifications`                          | Notificações in-app | 5 anos      | LGPD art. 7º, V  | Cron mensal `enforce-retention`  |
| **RP-12** | logs de provedor (Resend / Zenvia / FCM) | Trilha de envio     | **90 dias** | LGPD art. 7º, IX | Cron semanal `purge-server-logs` |

### 3.5 Auditoria

| ID        | Tabela        | Categoria                    | Prazo                                     | Base legal                 | Mecanismo                                   |
| --------- | ------------- | ---------------------------- | ----------------------------------------- | -------------------------- | ------------------------------------------- |
| **RP-13** | `audit_logs`  | Trilha imutável (hash chain) | 5 anos (não-fiscal) / indefinido (fiscal) | LGPD art. 37; CTN art. 195 | Cron mensal via RPC `audit_purge_retention` |
| **RP-14** | `cron_runs`   | Logs de cron                 | 90 dias                                   | LGPD art. 7º, IX           | Cron semanal `purge-server-logs`            |
| **RP-15** | `server_logs` | Logs estruturados            | 90 dias                                   | LGPD art. 7º, IX           | Cron semanal `purge-server-logs`            |

### 3.6 DSAR e suporte

| ID        | Tabela            | Categoria                                | Prazo  | Base legal                         | Mecanismo                              |
| --------- | ----------------- | ---------------------------------------- | ------ | ---------------------------------- | -------------------------------------- |
| **RP-16** | `dsar_requests`   | Solicitações de titulares (LGPD art. 18) | 5 anos | LGPD art. 7º, VI; Res. ANPD 4/2023 | Revisão semestral pelo DPO             |
| **RP-17** | `support_tickets` | Tickets de suporte                       | 3 anos | CDC art. 27                        | Revisão semestral pelo time de suporte |

### 3.7 Cadastro e documentos

| ID        | Tabela                | Categoria                              | Prazo                    | Base legal        | Mecanismo                  |
| --------- | --------------------- | -------------------------------------- | ------------------------ | ----------------- | -------------------------- |
| **RP-18** | `registration_drafts` | Rascunhos de cadastro (anônimos)       | 7 dias após `expires_at` | LGPD art. 6º, III | Cron diário `purge-drafts` |
| **RP-19** | `document_reviews`    | Revisão de docs de adesão (CRM/alvará) | 5 anos pós-contrato      | CFM 2.314/2022    | Acompanha o contrato       |

### 3.8 Object storage

| ID        | Tabela                     | Categoria             | Prazo                  | Base legal                         | Mecanismo                |
| --------- | -------------------------- | --------------------- | ---------------------- | ---------------------------------- | ------------------------ |
| **RP-20** | bucket `prescriptions`     | Receitas (PDF/imagem) | 10 anos                | Portaria 344/98; RDC 67/2007       | Imutável                 |
| **RP-21** | bucket `registration-docs` | Documentos de adesão  | 5 anos pós-desativação | CFM 2.314/2022; ANVISA RDC 16/2014 | Removido junto com RP-01 |

### 3.9 Backups

| ID        | Tabela                        | Categoria        | Prazo                | Base legal                    | Mecanismo                 |
| --------- | ----------------------------- | ---------------- | -------------------- | ----------------------------- | ------------------------- |
| **RP-22** | `backup_runs` + Supabase PITR | Snapshots e PITR | PITR 7 d + full 30 d | LGPD art. 7º, IX; SOC 2 CC7.5 | Ciclo natural do provedor |

### 3.10 Contratos

| ID        | Tabela                            | Categoria               | Prazo               | Base legal                           | Mecanismo              |
| --------- | --------------------------------- | ----------------------- | ------------------- | ------------------------------------ | ---------------------- |
| **RP-23** | `contracts` (Clicksign + espelho) | DPAs e termos assinados | 10 anos pós-término | Cód. Civil art. 206; Lei 14.063/2020 | Preservação contratual |

---

## 4. MECANISMOS DE ENFORCEMENT

### 4.1 Crons agendados

Todos os jobs de eliminação rodam em ambiente serverless (Vercel Cron) e
são protegidos por [`withCronGuard`](../../lib/cron/guarded.ts), que
garante:

- **Single-flight lock** — uma execução por janela, evitando double-purge;
- **Trilha em `cron_runs`** — status, duração, payload de retorno (90 dias de retenção);
- **Idempotência** — re-execução em caso de retry não causa efeitos colaterais.

| Cron                   | Schedule (UTC)        | Endpoint                         |
| ---------------------- | --------------------- | -------------------------------- |
| `purge-revoked-tokens` | `0 3 * * *` (diário)  | `/api/cron/purge-revoked-tokens` |
| `purge-drafts`         | `30 3 * * *` (diário) | `/api/cron/purge-drafts`         |
| `purge-server-logs`    | `0 3 * * 1` (semanal) | `/api/cron/purge-server-logs`    |
| `expire-doc-deadlines` | `0 6 * * *` (diário)  | `/api/cron/expire-doc-deadlines` |
| `enforce-retention`    | `0 2 1 * *` (mensal)  | `/api/cron/enforce-retention`    |

### 4.2 Anonimização vs. eliminação

- **Anonimização** é o método padrão para `profiles` e `auth.users` —
  preserva a integridade referencial dos registros financeiros (que NÃO
  podem ser apagados antes do prazo fiscal) substituindo identificadores
  por valores estatisticamente irrecuperáveis.
- **Eliminação física (DELETE)** é o método padrão para `notifications`,
  `cron_runs`, `server_logs` e `revoked_tokens`.
- **Eliminação preservando hash chain** é obrigatória para `audit_logs`:
  o RPC `audit_purge_retention` (SECURITY DEFINER) executa o DELETE
  dentro de transação que apaga as linhas elegíveis E grava um
  _checkpoint_ em `audit_chain_checkpoints`, garantindo que a cadeia
  hash do que sobrou continue verificável.

### 4.3 Legal Hold (suspensão de retenção)

Quando há **investigação interna, demanda judicial, requisição de
autoridade ou incidente de segurança em apuração**, o DPO ou a
Diretoria Jurídica podem registrar um _legal hold_ sobre uma entidade
(usuário, organização, pedido). Enquanto ativo:

- O cron `enforce-retention` consulta `legal_holds` antes de qualquer
  ação destrutiva e **pula** as linhas vinculadas (Wave 13);
- O bloqueio é registrado como métrica via `recordPurgeBlocked()`;
- Quando o evento que originou o hold se encerra, o DPO o desativa em
  `legal_holds.active = false` e a próxima janela do cron normaliza o
  estado.

A coluna **"Honra legal hold?"** do catálogo (`honorsLegalHold`) indica
quais políticas suspendem a eliminação. Logs operacionais de baixo
risco (`server_logs`, `cron_runs`, `revoked_tokens`) não honram hold
porque não contêm dado pessoal direto suficiente para justificar a
preservação adicional.

### 4.4 Pedidos de eliminação por titular (LGPD art. 18, VI)

A solicitação é registrada em `dsar_requests` e processada em até **15
dias corridos** (prorrogáveis por igual período mediante justificativa
formal — LGPD art. 19, II). A eliminação observa as exceções do art.
16 LGPD:

| Exceção (art. 16)                                     | Aplicação prática                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| I — cumprimento de obrigação legal                    | Pedidos, receitas, financeiro: NÃO eliminados antes do prazo legal — anonimizados quando viável. |
| II — estudo por órgão de pesquisa                     | N/A (não há projeto ativo).                                                                      |
| III — transferência a terceiro mediante consentimento | N/A.                                                                                             |
| IV — uso exclusivo do controlador, anonimizado        | Aplica-se a métricas agregadas.                                                                  |

A resposta ao titular detalha quais dados foram efetivamente removidos
e quais foram retidos (com a base legal específica).

---

## 5. AUDITORIA E EVIDÊNCIA

| Evidência                           | Onde                                            |
| ----------------------------------- | ----------------------------------------------- |
| Catálogo de políticas               | `lib/retention/policies.ts`                     |
| Política pública (legal)            | `docs/legal/retention-policy.md` (este arquivo) |
| Página pública                      | `/legal/retention`                              |
| Implementação do cron principal     | `lib/retention-policy.ts`                       |
| Histórico de execuções              | tabela `cron_runs`                              |
| Logs estruturados                   | `server_logs` (severidade INFO/WARN/ERROR)      |
| Métrica de bloqueios por legal hold | `legal_hold_purge_blocked_total`                |
| Teste de invariantes do catálogo    | `tests/unit/lib/retention-catalog.test.ts`      |

A cobertura de testes específicos para `enforce-retention` está em
`tests/unit/lib/retention-policy.test.ts` (Wave 13).

---

## 6. SUB-PROCESSADORES E RETENÇÃO COMPARTILHADA

Quando o dado é processado por sub-processador, a retenção do nosso
controle não exonera o operador de cumprir prazos próprios. As
salvaguardas contratuais com cada sub-processador estão no
[Trust Center](../../app/trust/page.tsx) e nos DPAs em
[`docs/legal/dpa-clinicas.md`](./dpa-clinicas.md) e
[`docs/legal/dpa-farmacias.md`](./dpa-farmacias.md).

Casos especiais:

- **OpenAI (OCR)** — opt-in expresso da clínica; **zero data
  retention** contratado; payload pseudonimizado quando viável
  (RP-06 não envia o nome do paciente para o LLM).
- **Sentry** — scrubbing automático de PII antes do envio; retenção 90
  dias (alinhada à RP-15).
- **Resend / Zenvia / FCM** — retenção de logs por 90 dias; conteúdo
  da mensagem não é armazenado em texto pleno após envio (RP-12).

---

## 7. EXCEÇÕES E TABELAS NÃO COBERTAS

Tabelas listadas em `RETENTION_EXCLUDED_TABLES` (no mesmo arquivo do
catálogo) **não estão sujeitas a esta política** porque (a) não contêm
dado pessoal, ou (b) são cobertas por outra política igualmente
formal:

- `schema_migrations` — controle do Supabase, sem dado pessoal;
- `feature_flags`, `rls_canary_results` — configuração e telemetria;
- `rate_limit_violations`, `webhook_deliveries` — telemetria de
  segurança coberta por `purge-server-logs`;
- `prescription_advances` — operacional, segue o pedido (RP-04).

Toda nova tabela com dado pessoal **DEVE** ser adicionada ao catálogo
ou justificada nessa lista. O teste de invariantes bloqueia merge em
caso de drift conhecido (ver §5).

---

## 8. REVISÃO E GOVERNANÇA

| Item                                            | Frequência                          | Responsável    |
| ----------------------------------------------- | ----------------------------------- | -------------- |
| Revisão da política                             | Semestral (out/abr)                 | DPO            |
| Revisão de prazos legais (RDC, CTN, etc.)       | Anual + ad-hoc em mudança normativa | DPO + Jurídico |
| Auditoria de execução dos crons                 | Mensal                              | SRE            |
| Conferência catálogo ↔ política ↔ implementação | A cada mudança (CI obrigatório)     | Eng Lead       |
| Drill de eliminação (DSAR end-to-end)           | Trimestral                          | DPO + Eng      |

Mudanças nesta política são registradas no Anexo A e comunicadas a
clínicas/farmácias parceiras com 30 dias de antecedência via os canais
contratuais (cláusula DPA).

---

## ANEXO A — HISTÓRICO DE VERSÕES

| Versão | Data       | Mudança                                                                                                         | Aprovação |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| 1.0    | 2026-04-18 | Criação — catálogo de 23 categorias, 5 crons documentados, 3 mecanismos (anonimização, DELETE, hash-preserving) | DPO + CEO |

---

## ANEXO B — CONTATO

| Função                     | Canal                                |
| -------------------------- | ------------------------------------ |
| Encarregado de Dados (DPO) | dpo@clinipharma.com.br               |
| Direitos do titular        | privacidade@clinipharma.com.br       |
| Incidentes                 | incidentes@clinipharma.com.br (24/7) |
| Jurídico                   | juridico@clinipharma.com.br          |

Forma e prazo de resposta a solicitações: 15 dias corridos
(prorrogáveis 15 dias mediante justificativa formal — LGPD art. 19,
II).
