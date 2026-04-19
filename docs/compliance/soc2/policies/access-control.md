# POLÍTICA DE CONTROLE DE ACESSO

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** Diretor de Engenharia + DPO
**Revisão:** anual (próxima: 2027-04-17)
**Mapeamento SOC 2:** CC6.1, CC6.2, CC6.3 · **LGPD:** art. 46

---

## 1. PROPÓSITO

Garantir que o acesso aos sistemas, dados e recursos da Clinipharma seja concedido com base no princípio do **menor privilégio**, restrito a indivíduos autorizados, e revogado tempestivamente quando a necessidade cessar.

## 2. ESCOPO

Aplica-se a:

- Todos os colaboradores (CLT, PJ, estagiários).
- Todos os prestadores de serviço com acesso à infraestrutura ou dados.
- Todas as integrações automatizadas (service accounts).
- Sistemas: Vercel, Supabase, Cloudflare, Sentry, Inngest, Resend, Zenvia, Asaas, Nuvem Fiscal, GitHub, Google Workspace.

## 3. DIRETRIZES

### 3.1. Provisionamento

- O acesso é concedido somente após aprovação documentada do gestor direto e do owner do sistema.
- O acesso a sistemas com dados sensíveis (saúde, financeiro) requer aprovação adicional do DPO.
- Toda concessão registra: solicitante, aprovador, data, escopo, justificativa.

### 3.2. Princípio do menor privilégio

- Papéis padronizados: `SUPER_ADMIN`, `ADMIN`, `CLINIC`, `PHARMACY`, `DOCTOR`, `CONSULTANT`.
- `SUPER_ADMIN` reservado a 2-3 pessoas máximo, com MFA obrigatório.
- Nenhum colaborador comum tem `SUPER_ADMIN` em produção.
- Quebra de regra (acesso just-in-time) requer aprovação dupla via #access-requests.

### 3.3. Autenticação

- Senhas: mínimo **12 caracteres** com complexidade (maiúsculas + minúsculas + dígito + símbolo).
- MFA obrigatório para `SUPER_ADMIN` e recomendado para todos.
- Sessões: tempo máximo 8h ativas + refresh token rotation.
- Rate limiting em login: 5 tentativas / 15 min por IP.

### 3.4. Revisão periódica de acesso (Access Review)

- **Trimestral** para sistemas críticos (Supabase, Vercel admin, Cloudflare).
- **Semestral** para sistemas auxiliares (Sentry, GitHub).
- Owner do sistema valida a lista de usuários ativos vs colaboradores na empresa.
- Evidência arquivada em `docs/compliance/soc2/evidence/access-reviews/YYYY-QN/`.

### 3.5. Offboarding

- Ao desligamento ou término de contrato, o acesso é revogado em até **24 horas úteis**.
- Para sistemas críticos, em até **2 horas** após notificação do RH.
- Checklist em `docs/runbooks/offboarding.md` (a criar).
- Senha de service accounts compartilhadas (raro; evitar) é rotacionada imediatamente.

### 3.6. Service accounts e API tokens

- Documentadas no manifesto de segredos (`lib/secrets/manifest.ts`).
- Rotação automatizada quinzenal (Wave 15).
- Escopo mínimo necessário; nunca uso de master keys.

## 4. EXCEÇÕES

Exceções a esta política requerem aprovação escrita do Diretor de Engenharia e do DPO, registro em `docs/compliance/soc2/evidence/exceptions/`, e revisão a cada 90 dias.

## 5. SANÇÕES

Violação desta política sujeita o colaborador a medidas disciplinares conforme o Regulamento Interno, sem prejuízo de medidas civis, criminais e administrativas cabíveis.

## 6. EVIDÊNCIAS COLETADAS

- Registros de provisionamento (tickets de #access-requests).
- Lista de usuários ativos por sistema (export trimestral).
- Logs de login bem-sucedidos e falhas (audit_log).
- Evidência de access reviews trimestrais.
- Evidência de offboarding (timestamp de revogação).
