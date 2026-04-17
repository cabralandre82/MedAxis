# RELATÓRIO DE IMPACTO À PROTEÇÃO DE DADOS PESSOAIS (RIPD)

## Tratamento de Dados de Saúde — Receitas Médicas na Plataforma Clinipharma

**Documento:** RIPD-001
**Versão:** 1.0 — Abril/2026
**Base legal:** LGPD Art. 38; ANPD Resolução CD/ANPD nº 2/2022
**Elaborado por:** André Cabral (Encarregado / DPO) — privacidade@clinipharma.com.br
**Revisão:** Anual ou em caso de mudança significativa no tratamento

> Este RIPD é elaborado nos termos do Art. 38 da LGPD, que autoriza a ANPD a exigi-lo quando o tratamento puder gerar riscos às liberdades civis e aos direitos fundamentais. O tratamento de **dados de saúde** de pacientes enquadra-se na categoria de alto risco, tornando este relatório obrigatório e recomendável.

---

## 1. IDENTIFICAÇÃO DO CONTROLADOR E DO ENCARREGADO

| Item                         | Descrição                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Controlador**              | ALC INTERMEDIAÇÃO E REPRESENTAÇÃO LTDA — CNPJ 66.279.691/0001-12                                      |
| **Encarregado (DPO)**        | André Cabral                                                                                          |
| **Contato DPO**              | privacidade@clinipharma.com.br                                                                        |
| **Cocontroladores**          | Clínicas parceiras (originadoras das receitas) — relacionamento regulado no DPA Clínicas v1.0         |
| **Suboperadores relevantes** | Supabase Inc. (armazenamento); OpenAI LLC (OCR sob demanda); Farmácias parceiras (acesso operacional) |

---

## 2. DESCRIÇÃO DO TRATAMENTO

### 2.1 Atividade de Tratamento

**Nome:** Recepção, armazenamento, roteamento e retenção de receitas médicas digitais para fins de dispensação de medicamentos manipulados.

**Descrição detalhada:**

A CLÍNICA, ao realizar um pedido de manipulação pela Plataforma Clinipharma, faz upload da receita médica em formato digital (PDF ou imagem). A Plataforma:

1. Recebe o arquivo e o armazena no Supabase Storage com criptografia em repouso;
2. Registra os metadados do arquivo (nome, tipo MIME, tamanho, usuário que fez upload, timestamp) na tabela `order_item_prescriptions`;
3. Permite acesso à imagem da receita pelo responsável técnico da farmácia designada, através de URL pré-assinada de duração máxima 5 minutos;
4. Retém o arquivo por 10 anos para cumprimento da obrigação ANVISA (RDC 67/2007, Portaria 344/98);
5. Opcionalmente (sob demanda explícita de SUPER_ADMIN), processa a imagem via OpenAI Vision para OCR de dados do prescritor e verificação de validade.

### 2.2 Dados de Saúde Envolvidos

| Dado                                               | Fonte                                                           | Obrigatório?                                         | Justificativa                                                    |
| -------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Imagem/PDF da receita médica                       | Upload pela clínica                                             | Sim (para produtos com `requires_prescription=true`) | Comprovação regulatória exigida pela ANVISA                      |
| Nome do paciente (quando presente na receita)      | Extraído da receita                                             | Não inserido separadamente; presente na imagem       | Parte da receita médica, sem tratamento separado pela plataforma |
| Data de nascimento do paciente (quando presente)   | Extraído da receita                                             | Não                                                  | Parte da receita; sem tratamento separado                        |
| Patologia/diagnóstico (quando expresso na receita) | Extraído da receita                                             | Não                                                  | Parte da receita; sem tratamento separado                        |
| Nome e CRM do médico prescritor                    | Presentes na receita; CRM também cadastrado na tabela `doctors` | CRM: sim (verificação de habilitação)                | Dado profissional público; base legal distinta (Art. 7º, V)      |
| Número da receita                                  | Opcional — preenchido pela clínica                              | Não                                                  | Rastreabilidade operacional                                      |

### 2.3 Categorias de Titulares

- **Pacientes:** pessoas naturais que recebem atendimento médico das clínicas parceiras e para quem os medicamentos são prescritos. **Não têm relação contratual direta com a Clinipharma.**
- **Médicos prescritores:** profissionais cujos dados (CRM, nome, assinatura) constam nas receitas e são cadastrados separadamente na Plataforma pela clínica.

### 2.4 Volume e Frequência

- Estimativa inicial: até 500 receitas/mês no primeiro ano; escalonável conforme crescimento da base de clínicas.
- Retenção de 10 anos implica volume acumulado significativo após 5+ anos de operação.

---

## 3. AVALIAÇÃO DE NECESSIDADE E PROPORCIONALIDADE

### 3.1 Finalidade

O tratamento de dados de saúde nas receitas é **necessário e proporcional** porque:

**(a)** A ANVISA **exige** a retenção de receitas médicas para dispensação de medicamentos de controle especial (Portaria 344/98), antimicrobianos (RDC 20/2011) e manipulados em geral (RDC 67/2007 — Boas Práticas de Manipulação);

**(b)** A dispensação de medicamentos manipulados sem receita, quando exigida, constitui infração sanitária com pena de multa, interdição e cassação de licença da farmácia;

**(c)** Não existe alternativa técnica que permita a dispensação regulatória de medicamentos controlados sem o armazenamento e verificação da receita;

**(d)** A digitalização das receitas reduz riscos em comparação com o modelo físico: acesso controlado por autenticação e RLS, rastreabilidade completa, menor risco de perda ou falsificação.

### 3.2 Minimização de Dados

A Plataforma implementa minimização:

- Os campos `patient_name` e `prescription_number` na tabela `order_item_prescriptions` são **opcionais** — a clínica pode enviar a receita sem preencher nenhum dado adicional além da imagem;
- O campo `units_covered` registra apenas quantidades, sem dados identificatórios;
- O OCR via OpenAI é realizado **sob demanda explícita**, não de forma automática para todas as receitas;
- Nenhum dado pessoal identificatório do paciente é extraído automaticamente e armazenado em campo estruturado sem ação da clínica.

### 3.3 Limitação de Finalidade

Os dados de saúde das receitas são usados **exclusivamente** para:

- Verificação regulatória da prescrição pela farmácia;
- Rastreabilidade do pedido;
- Retenção por obrigação legal;
- OCR sob demanda para verificação de validade e dados do prescritor.

**Não são usados para:** perfis de saúde, marketing, venda a terceiros, treinamento de IA, ou qualquer finalidade não listada na Cláusula 6.1 do DPA Clínicas.

---

## 4. IDENTIFICAÇÃO DE RISCOS

### 4.1 Mapeamento de Riscos

| ID  | Risco                                                                | Probabilidade | Impacto    | Nível     | Medida de Controle                                                                            |
| --- | -------------------------------------------------------------------- | ------------- | ---------- | --------- | --------------------------------------------------------------------------------------------- |
| R01 | Acesso não autorizado à receita por farmácia errada                  | Baixa         | Alto       | **Médio** | RLS isola pedidos por farmácia; cada farmácia vê apenas seus pedidos                          |
| R02 | Vazamento de receitas por comprometimento do Supabase Storage        | Muito Baixa   | Muito Alto | **Médio** | Criptografia em repouso; URLs pré-assinadas de curta duração; sem acesso público              |
| R03 | Download e retenção indevida de receitas por colaborador da farmácia | Baixa         | Alto       | **Médio** | URLs expiram em 5 min; contrato com cláusula proibitiva; treinamento exigido                  |
| R04 | Falsificação ou adulteração de receita antes do upload               | Baixa         | Muito Alto | **Alto**  | Imutabilidade após upload (sem UPDATE/DELETE por RLS); responsabilidade contratual da clínica |
| R05 | Processamento de receitas por IA sem autorização                     | Muito Baixa   | Alto       | **Baixo** | OCR só ativado por SUPER_ADMIN com ação explícita; não automático                             |
| R06 | Retenção além do prazo necessário                                    | Baixa         | Médio      | **Baixo** | Prazo de 10 anos alinhado à obrigação ANVISA; cron de eliminação registrado                   |
| R07 | Requisição de titular (paciente) por eliminação durante prazo ANVISA | Baixa         | Médio      | **Baixo** | Base legal de obrigação legal prevalece sobre eliminação (LGPD Art. 16, I)                    |
| R08 | Transferência internacional da receita para a OpenAI sem salvaguarda | Muito Baixa   | Alto       | **Baixo** | Zero data retention; URL pré-assinada de 2 min; DPA OpenAI vigente                            |
| R09 | Comprometimento de credenciais de usuário da clínica                 | Média         | Alto       | **Alto**  | MFA disponível; JWT blacklist; revogação imediata de sessão; rate limiting de login           |
| R10 | Incidente de segurança na Supabase Inc. (suboperador EUA)            | Muito Baixa   | Muito Alto | **Médio** | DPA com SCCs; backups; point-in-time recovery; notificação contratual em 24h                  |
| R11 | Uso de receitas pela farmácia para fins não autorizados              | Baixa         | Alto       | **Médio** | Proibição contratual; auditoria anual; sanção por justa causa no DPA                          |
| R12 | Receita de menor de 18 anos sem consentimento do responsável         | Média         | Alto       | **Alto**  | Cláusula de responsabilidade da clínica; treinamento; declaração no DPA Clínicas              |

### 4.2 Riscos Residuais Aceitos

Os riscos R03, R05, R08 e R10 são considerados **riscos residuais aceitáveis**, dado que as medidas de controle implementadas são proporcionais e alinhadas ao estado da arte da segurança em SaaS de saúde no Brasil.

O risco R04 (falsificação) é **transferido contratualmente** para a clínica, que responde pela autenticidade das receitas inseridas.

---

## 5. MEDIDAS DE MITIGAÇÃO IMPLEMENTADAS

| Medida                                                    | Status                    | Responsável               |
| --------------------------------------------------------- | ------------------------- | ------------------------- |
| Criptografia AES-256-GCM em repouso (campos PII)          | ✅ Implementado           | Clinipharma               |
| TLS 1.3 em trânsito                                       | ✅ Implementado           | Clinipharma + Cloudflare  |
| RLS por entidade (farmácia acessa apenas seus pedidos)    | ✅ Implementado           | Clinipharma               |
| URLs pré-assinadas 5 min para receitas                    | ✅ Implementado           | Clinipharma               |
| Imutabilidade de receitas (sem UPDATE/DELETE por RLS)     | ✅ Implementado           | Clinipharma               |
| OCR apenas sob demanda explícita de SUPER_ADMIN           | ✅ Implementado           | Clinipharma               |
| Zero data retention OpenAI para API                       | ✅ Contratado             | Clinipharma + OpenAI      |
| JWT blacklist + revogação imediata de sessão              | ✅ Implementado           | Clinipharma               |
| Rate limiting de autenticação                             | ✅ Implementado           | Clinipharma               |
| Logs de auditoria de todos os acessos a receitas          | ✅ Implementado           | Clinipharma               |
| DPA com farmácias (proibição de uso indevido)             | ✅ Este documento         | DPO                       |
| DPA com clínicas (responsabilidade por autenticidade)     | ✅ Este documento         | DPO                       |
| Cláusula de treinamento de colaboradores no DPA Farmácias | ✅ Incluído               | DPO                       |
| RIPD disponível para consulta por clínicas parceiras      | ✅ Este documento         | DPO                       |
| **Pentest externo**                                       | ⬜ Pendente               | Clinipharma (contratação) |
| **Migração PII de plaintext para colunas criptografadas** | ✅ Concluído (2026-04-17) | Clinipharma (dev)         |
| **MFA obrigatório** para usuários com acesso a receitas   | ⬜ Pendente               | Clinipharma (produto)     |

---

## 6. CONSULTA AOS TITULARES E PARTES INTERESSADAS

### 6.1 Titulares (Pacientes)

Os titulares finais dos dados de saúde (pacientes) não têm relação contratual direta com a Clinipharma. A consulta é realizada indiretamente:

**(a)** A CLÍNICA, como controladora originária, é responsável por informar o paciente sobre o compartilhamento de dados com a Plataforma e a farmácia, nos termos do DPA Clínicas Cláusula 7.1, II;

**(b)** A Política de Privacidade da Clinipharma (disponível em clinipharma.com.br/privacy) está publicada em linguagem acessível e inclui seção sobre tratamento de dados de saúde;

**(c)** Canal de contato do DPO (privacidade@clinipharma.com.br) está publicado na Política de Privacidade para exercício de direitos por qualquer titular, incluindo pacientes.

### 6.2 Farmácias Parceiras

Consultadas via DPA Farmácias, que estabelece suas obrigações, proibições e direitos em relação às receitas.

### 6.3 Clínicas Parceiras

Consultadas via DPA Clínicas, que estabelece claramente o cocontrole, as finalidades, as bases legais e as responsabilidades mútuas.

---

## 7. DECISÃO E REGISTRO

### 7.1 Avaliação Final

Após análise dos riscos identificados, das medidas de controle implementadas e dos princípios de necessidade e proporcionalidade, conclui-se que:

**(a)** O tratamento de dados de saúde constantes de receitas médicas na Plataforma Clinipharma é **necessário e tem base legal adequada** (Art. 11, II, "a" e "b" da LGPD);

**(b)** Os riscos identificados são **mitigáveis e proporcionais** ao benefício regulatório, de saúde pública e operacional;

**(c)** As medidas técnicas e administrativas implementadas são adequadas ao estado da arte para plataformas SaaS no setor de saúde;

**(d)** O tratamento pode prosseguir com as salvaguardas documentadas, **sujeito à implementação** das medidas pendentes (pentest, MFA).

### 7.2 Prazo de Revisão

Este RIPD deve ser **revisado anualmente** ou nas seguintes hipóteses:

- Alteração significativa nas finalidades de tratamento;
- Inclusão de novo suboperador com acesso a dados de saúde;
- Incidente de segurança grave envolvendo receitas médicas;
- Publicação de nova regulamentação da ANPD sobre dados de saúde;
- Auditoria da ANPD que aponte necessidade de revisão.

---

## 8. APROVAÇÃO

| Papel               | Nome         | Data        |
| ------------------- | ------------ | ----------- |
| Encarregado (DPO)   | André Cabral | Abril/2026  |
| Representante Legal | [Nome]       | **\_**/2026 |

---

_Este RIPD é documento interno, disponível para consulta pela ANPD e, em forma resumida, para as clínicas parceiras que o solicitem, nos termos do DPA Clínicas Cláusula 18.2._
