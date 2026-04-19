# POLÍTICA DE CLASSIFICAÇÃO E TRATAMENTO DE DADOS

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** DPO
**Revisão:** anual
**Mapeamento SOC 2:** C1.1, C1.2, CC6.5 · **LGPD:** arts. 6º, 11, 16

---

## 1. PROPÓSITO

Estabelecer níveis de classificação para os dados tratados pela Clinipharma e definir os controles mínimos de manuseio, armazenamento, transmissão, retenção e disposição para cada nível.

## 2. NÍVEIS DE CLASSIFICAÇÃO

### 2.1. PÚBLICO

**Definição:** dados destinados ao público sem restrição (marketing, blog, posts em redes sociais, Trust Center).

**Controles mínimos:**

- Sem restrição de acesso.
- Sem criptografia obrigatória em repouso.
- Pode ser publicado sem aprovação adicional.

**Exemplos:** página de marketing, FAQ, lista de sub-processadores em `/trust`.

---

### 2.2. INTERNO

**Definição:** dados destinados a colaboradores e parceiros, sem PII de terceiros e sem informação comercial sensível.

**Controles mínimos:**

- Acesso restrito a colaboradores e parceiros autorizados.
- Compartilhamento externo requer aprovação do gestor.
- Pode ser armazenado em ferramentas corporativas (Notion, Slack).

**Exemplos:** runbooks operacionais, documentação de arquitetura sem segredos, comunicação interna.

---

### 2.3. CONFIDENCIAL

**Definição:** dados que, se vazados, causariam dano material à Clinipharma ou a terceiros — incluindo PII comum, informação comercial sensível e segredos comerciais.

**Controles mínimos:**

- Acesso por necessidade-de-saber (need-to-know), com RBAC + RLS.
- Criptografia em repouso (AES-256-GCM) e em trânsito (TLS 1.3).
- Audit log de cada acesso.
- Não pode ser copiado para dispositivos pessoais.
- Compartilhamento externo somente sob NDA + aprovação do DPO.

**Exemplos:** dados de cadastro de usuários (nome, e-mail, CPF/CNPJ), dados de faturamento, contratos com fornecedores, credenciais de integração, contas bancárias dos parceiros.

---

### 2.4. RESTRITO (sensível LGPD + segredos críticos)

**Definição:** subconjunto crítico — dados sensíveis nos termos da LGPD art. 5º, II (saúde, biometria, religião, etc.) e segredos cuja exposição causa dano grave (chaves de criptografia, master keys).

**Controles mínimos:**

- Acesso por whitelist explícita; aprovação dupla para mudanças.
- Criptografia em repouso obrigatória (AES-256-GCM); criptografia adicional por campo onde aplicável.
- TLS 1.3 obrigatório em qualquer movimento.
- Audit log com hash chain (não-repúdio).
- Acesso humano direto (psql, dashboards) requer registro just-in-time + justificativa.
- **Proibido** envio para IA pública sem opt-in expresso e pseudonimização.
- Retenção mínima por legislação setorial (ANVISA: 10 anos para escrituração).
- Eliminação só após cumprimento da finalidade E expiração da obrigação legal.

**Exemplos:** prescrições médicas, CID expresso na prescrição, CRM, dados biométricos eventuais, master keys de criptografia, service-role keys.

---

## 3. RETENÇÃO E DISPOSIÇÃO

| Categoria                            | Retenção mínima                            | Retenção máxima   | Justificativa                            |
| ------------------------------------ | ------------------------------------------ | ----------------- | ---------------------------------------- |
| Dados de cadastro de usuário inativo | 5 anos                                     | 10 anos           | Marco Civil art. 15 + obrigações fiscais |
| Pedidos e faturamento                | 5 anos                                     | 10 anos           | CTN art. 195 + LGPD art. 16, II          |
| Receitas médicas dispensadas         | 10 anos                                    | indeterminado     | RDC ANVISA 67/2007; Portaria 344/98      |
| Audit log                            | 5 anos                                     | indeterminado     | LGPD art. 37 + segurança                 |
| Logs de aplicação                    | 90 dias                                    | 180 dias          | observabilidade                          |
| Backup de banco                      | 30 dias rolling + snapshots semanais 1 ano | 5 anos            | DR + auditoria                           |
| Tokens de sessão                     | sessão ativa                               | rotação a cada 8h | segurança                                |

**Eliminação:** automatizada via crons (`lib/jobs/purge-*`) com validação de exceções (legal hold, processo judicial).

## 4. TRATAMENTO POR FUNÇÃO

| Função               | Acesso a CONFIDENCIAL?            | Acesso a RESTRITO?                         |
| -------------------- | --------------------------------- | ------------------------------------------ |
| Dev (não-engenharia) | ❌                                | ❌                                         |
| Engenheiro           | ✅ (staging com dados sintéticos) | ❌ (prod via flag emergencial)             |
| Engenheiro Sênior    | ✅                                | ⚠️ (just-in-time com justificativa)        |
| SRE                  | ✅                                | ✅                                         |
| SUPER_ADMIN (UI)     | ✅                                | ⚠️ (apenas via `/audit` para investigação) |
| DPO                  | ✅                                | ✅                                         |
| Suporte 1ª linha     | ✅ (ticket-bound)                 | ❌                                         |
| Comercial            | ✅ (próprios leads)               | ❌                                         |

## 5. ANONIMIZAÇÃO E PSEUDONIMIZAÇÃO

- **Anonimização** (LGPD art. 12): permite uso livre, desde que tecnicamente irreversível com meios razoáveis.
- **Pseudonimização** (LGPD art. 13, IV): mantém status de PII, mas reduz risco e exigida antes de envio a IA externa para OCR (DPA-Clínicas Cl. 11.3).

## 6. EVIDÊNCIAS

- Inventário de dados (DPIA / RIPD) revisto anualmente.
- Logs de eliminação automática (cron de purge).
- Logs de acesso a dados RESTRITOS (audit_log).
- Atestações de eliminação por fornecedores no offboarding.
