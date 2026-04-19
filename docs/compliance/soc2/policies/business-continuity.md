# POLÍTICA DE CONTINUIDADE DE NEGÓCIO E RECUPERAÇÃO DE DESASTRES

**Versão:** 1.0
**Data efetiva:** 2026-04-17
**Owner:** SRE Lead + CEO
**Revisão:** anual
**Mapeamento SOC 2:** CC7.5 (Recovery), Availability (A1) · **ISO:** 22301

---

## 1. PROPÓSITO

Garantir a continuidade dos serviços essenciais da plataforma Clinipharma diante de incidentes que afetem a disponibilidade, e estabelecer procedimentos para recuperação rápida de desastres com perda mínima de dados.

## 2. SERVIÇOS ESSENCIAIS

| Serviço                            | Criticidade | RTO      | RPO                   |
| ---------------------------------- | ----------- | -------- | --------------------- |
| Aplicação web (front + API)        | Crítico     | 5 min    | 0 (stateless)         |
| Banco de dados                     | Crítico     | 30 min   | 5 min                 |
| Autenticação                       | Crítico     | 30 min   | 5 min                 |
| Pagamentos (Asaas)                 | Crítico     | 10 min   | 0 (idempotente)       |
| Envio de NF-e (Nuvem Fiscal)       | Alto        | 4 horas  | 24 horas              |
| OCR de receitas (OpenAI)           | Médio       | 24 horas | n/a (opt-in opcional) |
| Notificações (Resend, Zenvia, FCM) | Médio       | 1 hora   | < 1% perda aceitável  |
| Storage (Supabase)                 | Alto        | 30 min   | 1 hora                |

## 3. ESTRATÉGIAS DE RESILIÊNCIA

### 3.1. Aplicação web (Vercel)

- Multi-region edge automaticamente.
- Build artifacts versionados; rollback em 1 clique.
- Página de manutenção estática (Cloudflare Worker) ativa em outage total do Vercel.

### 3.2. Banco de dados (Supabase)

- PITR (Point-in-Time Recovery) habilitado em produção (7 dias retention).
- Backup diário externo (S3 ou Supabase native) — retenção 30 dias rolling + snapshots semanais por 1 ano.
- Replicação leitura quando necessário.
- Migrations idempotentes (re-run safe).

### 3.3. Storage

- Replicação inter-region pelo provedor.
- Backup mensal de arquivos críticos (DPAs, RIPD, contratos).

### 3.4. Integrações externas

- Circuit breaker em todas as integrações externas (`lib/circuit-breaker.ts`).
- Retry com backoff exponencial.
- Idempotency keys em pagamentos e webhooks.
- Dead-letter queue para reprocessamento manual.

### 3.5. Segredos

- Rotação automatizada quinzenal (Wave 15) com manifesto + hash chain.
- Cópia offline criptografada de master keys (cofre físico, papel, 1Password Family).

## 4. TESTES DE RECUPERAÇÃO

- **DR drill semestral** completo com 5 cenários (`docs/runbooks/dr-drill-2026-04.md`).
- **Tabletop exercise trimestral** com cenários hipotéticos.
- **Restore test mensal** automatizado contra staging.
- Resultados documentados em `docs/security/dr-evidence/YYYY-MM-DD/`.

## 5. PLANO DE COMUNICAÇÃO

### 5.1. Interna

- Canal `#incident-YYYYMMDD-NNN` no Slack/Discord.
- Convocação automática de on-call rotation.
- Atualização a cada 30 min durante SEV-1.

### 5.2. Externa

- Status page (`/status`) com atualização em tempo real.
- E-mail aos parceiros (template em `docs/templates/incident-comms.md`).
- Twitter/X corporativo para SEV-1.
- Imprensa: somente após Diretor Jurídico + CEO.

### 5.3. Regulatória

- ANPD: notificação em até 3 dias úteis se PII envolvida (Resolução CD/ANPD nº 15/2024).
- ANVISA: comunicação se houver impacto em rastreabilidade de dispensação.

## 6. CONTINUIDADE OPERACIONAL (NÃO-TÉCNICA)

- Documentação centralizada acessível mesmo offline (Notion sync local + cópia em PDF semestral).
- Lista de contatos críticos (DPO, Diretor Jurídico, CEO, fornecedores) atualizada e acessível em local seguro alternativo.
- 1Password Family compartilhado para acesso a senhas de emergência (com 2 pessoas tendo recovery key).

## 7. GOVERNANÇA

- Comitê de Risco trimestral com Diretoria, SRE Lead, DPO.
- Apresentação de drills, incidentes e KPIs (RTO/RPO observados, MTTR, número de incidentes).
- Revisão desta política a cada incidente SEV-1 ou anualmente, o que vier primeiro.

## 8. EVIDÊNCIAS

- Resultados dos DR drills.
- Pós-mortems.
- Atas do Comitê de Risco.
- Evidências de backup verificado (logs do restore mensal automático).
