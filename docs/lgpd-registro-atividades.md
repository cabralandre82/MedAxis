# Clinipharma — Registro de Atividades de Tratamento de Dados

### (Conforme LGPD Art. 37 e ANPD Resolução CD/ANPD nº 2/2022)

**Controlador:** Clinipharma (CNPJ pendente)
**DPO:** André Cabral — privacidade@clinipharma.com.br
**Última atualização:** 2026-04-08
**Versão:** 1.0

---

## 1. Identificação do Controlador

| Campo             | Valor                          |
| ----------------- | ------------------------------ |
| Razão Social      | Clinipharma (nome provisório)  |
| CNPJ              | Pendente de registro           |
| Endereço          | A definir                      |
| E-mail de contato | privacidade@clinipharma.com.br |
| Encarregado (DPO) | André Cabral                   |

---

## 2. Atividades de Tratamento

### 2.1 Cadastro e Autenticação de Usuários

| Item                            | Descrição                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| **Dados tratados**              | Nome completo, e-mail, telefone (encriptado AES-256-GCM), senha (hash via Supabase Auth) |
| **Finalidade**                  | Identificação e autenticação de usuários na plataforma                                   |
| **Base legal**                  | Execução de contrato (LGPD Art. 7, V)                                                    |
| **Compartilhamento**            | Supabase (processador) — Auth e banco de dados                                           |
| **Retenção**                    | 5 anos após inativação da conta                                                          |
| **Transferência internacional** | Supabase — EUA (adequação por cláusulas contratuais padrão)                              |

### 2.2 Gestão de Pedidos Médicos

| Item                            | Descrição                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Dados tratados**              | ID da clínica, ID do médico, produtos solicitados, endereço de entrega           |
| **Finalidade**                  | Processamento e rastreamento de pedidos de produtos farmacêuticos especializados |
| **Base legal**                  | Execução de contrato (LGPD Art. 7, V)                                            |
| **Compartilhamento**            | Farmácias parceiras (dados do pedido), Asaas (pagamento)                         |
| **Retenção**                    | 10 anos (obrigação fiscal — CTN Art. 195)                                        |
| **Transferência internacional** | Asaas — Brasil                                                                   |

### 2.3 Processamento de Pagamentos

| Item                 | Descrição                                                           |
| -------------------- | ------------------------------------------------------------------- |
| **Dados tratados**   | Valor do pedido, método de pagamento, status da transação, ID Asaas |
| **Finalidade**       | Cobrança e confirmação de pagamentos                                |
| **Base legal**       | Execução de contrato (LGPD Art. 7, V) + Obrigação legal             |
| **Compartilhamento** | Asaas Pagamentos S.A. (processador de pagamentos)                   |
| **Retenção**         | 10 anos (CTN Art. 195)                                              |
| **Dados sensíveis**  | Não — dados de cartão NÃO são armazenados na Clinipharma            |

### 2.4 Dados de Médicos (CRM)

| Item                 | Descrição                                                              |
| -------------------- | ---------------------------------------------------------------------- |
| **Dados tratados**   | Nome, CRM (encriptado AES-256-GCM), especialidade, e-mail profissional |
| **Finalidade**       | Vinculação de médicos às clínicas para autorização de pedidos          |
| **Base legal**       | Execução de contrato (LGPD Art. 7, V)                                  |
| **Compartilhamento** | Farmácias (nome e especialidade apenas)                                |
| **Retenção**         | 5 anos após desativação                                                |

### 2.5 Assinatura Eletrônica de Contratos

| Item                 | Descrição                                               |
| -------------------- | ------------------------------------------------------- |
| **Dados tratados**   | Nome, e-mail, IP de assinatura                          |
| **Finalidade**       | Formalização de contratos com farmácias e clínicas      |
| **Base legal**       | Execução de contrato (LGPD Art. 7, V) + Obrigação legal |
| **Compartilhamento** | Clicksign (processador de assinaturas eletrônicas)      |
| **Retenção**         | 10 anos (valor jurídico)                                |

### 2.6 Notificações e Comunicações

| Item                 | Descrição                                                                |
| -------------------- | ------------------------------------------------------------------------ |
| **Dados tratados**   | E-mail, telefone, token FCM (push), histórico de notificações            |
| **Finalidade**       | Comunicação operacional sobre pedidos, pagamentos e alertas              |
| **Base legal**       | Execução de contrato (LGPD Art. 7, V) / Legítimo interesse               |
| **Compartilhamento** | Resend (e-mail), Twilio (SMS), Evolution API (WhatsApp), Firebase (push) |
| **Retenção**         | 5 anos                                                                   |
| **Opt-out**          | Usuário pode desativar notificações não críticas em Configurações        |

### 2.7 Logs de Auditoria

| Item                 | Descrição                                                      |
| -------------------- | -------------------------------------------------------------- |
| **Dados tratados**   | ID do usuário, ação realizada, IP, timestamp, entidade afetada |
| **Finalidade**       | Segurança, rastreabilidade e conformidade regulatória          |
| **Base legal**       | Legítimo interesse (segurança) + Obrigação legal               |
| **Compartilhamento** | Sentry (erros — sem PII)                                       |
| **Retenção**         | 5 anos (não-financeiros) / 10 anos (financeiros)               |

---

## 3. Política de Retenção Técnica

| Entidade                            | Retenção                      | Base Legal                 |
| ----------------------------------- | ----------------------------- | -------------------------- |
| Perfis de usuário (PII)             | 5 anos após `status=INACTIVE` | LGPD Art. 16               |
| Pedidos e itens                     | 10 anos                       | CTN Art. 195               |
| Pagamentos e transferências         | 10 anos                       | CTN Art. 195, Lei 9.430/96 |
| Comissões de consultores            | 10 anos                       | CTN Art. 195               |
| Logs de auditoria (não-financeiros) | 5 anos                        | LGPD Art. 37               |
| Logs de auditoria (financeiros)     | 10 anos                       | CTN Art. 195               |
| Notificações                        | 5 anos                        | Legítimo interesse         |
| Contratos assinados                 | 10 anos                       | Valor jurídico             |
| Tokens de sessão revogados          | 2 horas                       | Segurança operacional      |

**Implementação técnica:** Cron mensal (`/api/cron/enforce-retention`, todo dia 1 às 02h UTC) executa anonymização e purge automático conforme tabela acima.

---

## 4. Direitos dos Titulares (LGPD Art. 18)

| Direito                         | Implementação                                                |
| ------------------------------- | ------------------------------------------------------------ |
| Acesso (I)                      | `GET /api/lgpd/export` — download JSON com todos os dados    |
| Retificação (III)               | Perfil editável em `/profile`                                |
| Eliminação (VI)                 | `POST /api/lgpd/deletion-request` → análise em 15 dias úteis |
| Portabilidade (V)               | Incluído no export JSON                                      |
| Informação (IV, VIII)           | Esta página + Política de Privacidade                        |
| Revogação de consentimento (IX) | Configurações de notificação                                 |

**Portal do Titular:** `/profile/privacy` — disponível para todos os usuários autenticados.

---

## 5. Medidas de Segurança Implementadas

- ✅ Criptografia AES-256-GCM para campos PII (telefone, CRM, form_data)
- ✅ TLS 1.3 em trânsito (Vercel + Cloudflare)
- ✅ RLS (Row Level Security) em todas as tabelas Supabase
- ✅ Revogação imediata de sessões ao desativar usuário
- ✅ Autenticação multifator disponível via Supabase Auth
- ✅ Logs de auditoria para todas as operações sensíveis
- ✅ Rate limiting por IP e por usuário
- ✅ Circuit breaker para integrações externas
- ✅ Headers de segurança HTTP (CSP, HSTS, X-Frame-Options)
- ⬜ Pentest externo (contratar antes go-live comercial)
- ⬜ DPA formal com farmácias e clínicas (elaborar com advogado LGPD)

---

## 6. Suboperadores (Processadores)

| Processador       | Serviço                | País   | Instrumento           |
| ----------------- | ---------------------- | ------ | --------------------- |
| Supabase          | Banco de dados + Auth  | EUA    | DPA padrão Supabase   |
| Vercel            | Hospedagem             | EUA    | DPA padrão Vercel     |
| Cloudflare        | CDN + DNS              | EUA    | DPA padrão Cloudflare |
| Resend            | E-mail transacional    | EUA    | DPA disponível        |
| Asaas             | Gateway de pagamento   | Brasil | Contrato bilateral    |
| Clicksign         | Assinatura eletrônica  | Brasil | Contrato bilateral    |
| Twilio            | SMS                    | EUA    | DPA padrão Twilio     |
| Firebase (Google) | Push notifications     | EUA    | DPA padrão Google     |
| Sentry            | Monitoramento de erros | EUA    | DPA padrão Sentry     |
| Inngest           | Background jobs        | EUA    | DPA padrão Inngest    |

---

## 7. Pendências Críticas antes do Go-Live Comercial

- [ ] Registrar CNPJ do controlador
- [ ] Elaborar DPA formal com cada farmácia e clínica parceira (advogado especialista LGPD)
- [x] Publicar Política de Privacidade completa em `/privacy` — ✅ v5.1.0
- [x] Publicar Termos de Uso em `/terms` — ✅ v5.1.0 (acesso público corrigido em v5.1.4)
- [ ] Nomear DPO formalmente (declaração no site)
- [ ] Registrar atividades de tratamento na ANPD (quando obrigatório)
- [ ] Pentest externo para validar medidas de segurança (Art. 46)

---

_Este documento deve ser revisado a cada 12 meses ou sempre que houver mudança significativa no tratamento de dados._
