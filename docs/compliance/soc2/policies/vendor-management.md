# POLÍTICA DE GESTÃO DE FORNECEDORES (VENDOR MANAGEMENT)

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** DPO + Diretor Jurídico
**Revisão:** anual
**Mapeamento SOC 2:** CC9.1, CC9.2 · **LGPD:** arts. 39 e 41

---

## 1. PROPÓSITO

Estabelecer o processo de avaliação, contratação, monitoramento e descontinuação de fornecedores que tratam dados pessoais ou que prestam serviços críticos à plataforma Clinipharma.

## 2. ESCOPO

Aplica-se a:

- **Operadores LGPD** (sub-processadores que tratam dados em nome da Clinipharma): listados no Trust Center (`/trust`).
- Fornecedores de infraestrutura crítica (hosting, banco, CDN).
- Fornecedores que tenham acesso a dados confidenciais ou ambientes produtivos.

## 3. CICLO DE GESTÃO

### 3.1. Avaliação inicial (Due Diligence)

Antes de contratar, o fornecedor é avaliado em:

| Dimensão                 | Critério                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| **Segurança**            | Possui certificações (SOC 2, ISO 27001, PCI-DSS quando aplicável)?     |
| **LGPD**                 | Aceita assinar DPA com cláusulas mínimas? Tem histórico de incidentes? |
| **Localização de dados** | Onde os dados são armazenados? Há transferência internacional?         |
| **Continuidade**         | SLA contratual? Roadmap de produto sustentável?                        |
| **Reputação**            | Cobertura na imprensa, reviews G2/Capterra                             |
| **Custo total**          | TCO incluindo migration, suporte, descontinuidade                      |

### 3.2. Contratação

- Contrato com cláusulas mínimas de SLA, segurança, confidencialidade.
- Quando tratar PII: **DPA assinado com cláusulas LGPD-compliant** (modelos em `docs/legal/dpa-*.md`).
- Documentar no Trust Center (`/trust`) em até 30 dias após go-live.
- Para sub-processadores novos: comunicar parceiros (clínicas/farmácias) com 30 dias de antecedência.

### 3.3. Monitoramento contínuo

- **Anual:** revisão de certificações (renovações de SOC 2, ISO).
- **Anual:** review do uso real do fornecedor (custo, dependência, alternativas).
- **Imediato:** acompanhar incidentes do fornecedor (ex.: vazamento publicizado).

### 3.4. Descontinuação

- Plano de migração documentado antes do término.
- Solicitar do fornecedor a **comprovação de exclusão dos dados** (Data Deletion Certificate).
- Atualizar Trust Center.
- Remover do manifesto de segredos.

## 4. CLASSIFICAÇÃO DE FORNECEDORES

| Nível       | Critério                                                                  | Frequência de revisão       |
| ----------- | ------------------------------------------------------------------------- | --------------------------- |
| **Crítico** | Indisponibilidade afeta operação principal (Vercel, Supabase, Cloudflare) | semestral + após incidentes |
| **Alto**    | Indisponibilidade afeta funcionalidade importante (Asaas, Resend, Sentry) | anual                       |
| **Médio**   | Indisponibilidade gera degradação aceitável (Zenvia, Inngest)             | anual                       |
| **Baixo**   | Auxiliar (ferramentas internas)                                           | bienal                      |

## 5. SUB-PROCESSADORES ATUAIS

Listados publicamente em `/trust#sub-processadores` e em `app/trust/page.tsx`. Toda alteração nessa lista passa por esta política.

## 6. EVIDÊNCIAS

- DPAs assinados (`docs/legal/dpa-*` e cópias dos contratos com sub-processadores).
- Certificações dos fornecedores (renovadas anualmente).
- Atas de revisão.
- Tickets de comunicação com parceiros sobre mudanças.
- Data Deletion Certificates (no offboarding de fornecedor).

## 7. EXCEÇÕES

Adoção emergencial de fornecedor não-avaliado (ex.: para mitigar incidente) requer aprovação do Diretor de Engenharia e do DPO, com avaliação retroativa em até 30 dias.
