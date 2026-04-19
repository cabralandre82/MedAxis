/**
 * Retention Policy Catalog — Wave Hardening II #5
 *
 * Canonical, typed source-of-truth for the data retention policy of the
 * Clinipharma platform. Every personal-data table (and a few non-personal
 * but operationally relevant ones) is listed here with its retention
 * window, legal basis, enforcement mechanism and exceptions.
 *
 * This file is intentionally **metadata-only**. It does not perform any
 * deletion. Enforcement lives in:
 *   - lib/retention-policy.ts        (monthly job: profiles, notifications, audit_logs)
 *   - lib/token-revocation.ts        (daily: revoked_tokens TTL)
 *   - app/api/cron/purge-drafts      (daily: expired registration drafts)
 *   - app/api/cron/purge-server-logs (weekly: 90-day server logs)
 *   - app/api/cron/expire-doc-deadlines (daily: stale order documents)
 *
 * The catalog feeds:
 *   - app/legal/retention                (public page)
 *   - docs/legal/retention-policy.md     (canonical legal document)
 *   - tests/unit/lib/retention-catalog.test.ts (invariants — ENFORCED)
 *
 * Whenever a new table holding personal data is added, a corresponding
 * entry MUST be added here OR the table MUST be added to
 * `RETENTION_EXCLUDED_TABLES` with a justification. The drift test in
 * tests/unit/lib/retention-catalog.test.ts will block the PR otherwise.
 */

/** Categories follow the data-classification policy (4 tiers). */
export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted'

/** LGPD-aligned legal basis for the *retention* of the data (not collection). */
export type RetentionBasis =
  | 'execucao_contrato' // Art. 7º, V LGPD
  | 'obrigacao_legal' // Art. 7º, II LGPD (CTN, RDC ANVISA, Cód. Civil, CFM)
  | 'tutela_saude' // Art. 11, II, "f" LGPD
  | 'legitimo_interesse' // Art. 7º, IX LGPD
  | 'exercicio_direitos' // Art. 7º, VI LGPD (defesa em processos)
  | 'consentimento' // Art. 7º, I LGPD

/** Enforcement model — how retention is actually applied. */
export type Enforcement =
  | { kind: 'cron'; cron: string; schedule: string; action: 'delete' | 'anonymize' | 'archive' }
  | { kind: 'ttl'; column: string; action: 'delete' }
  | { kind: 'manual'; reason: string }
  | { kind: 'never'; reason: string } // financial / fiscal records

export interface RetentionPolicy {
  /** Unique catalog id — stable across versions. */
  id: string
  /** Postgres table or logical group covered by this policy. */
  table: string
  /** Human-friendly name in pt-BR (used by the public page). */
  category: string
  /** Plain-language description of *what* is retained. */
  description: string
  dataClass: DataClass
  /** Retention window in days. Use null when retention is indefinite (financial). */
  retentionDays: number | null
  /** Free-form caption for the public page (e.g. "10 anos", "90 dias"). */
  retentionLabel: string
  basis: RetentionBasis
  /** Free-form citation block (e.g. "LGPD art. 16; CTN art. 195"). */
  legalCitation: string
  enforcement: Enforcement
  /** True if this policy can be paused by an active legal hold. */
  honorsLegalHold: boolean
  /** Free-form notes (exceptions, caveats, related runbooks). */
  notes?: string
}

/** Tables that intentionally have NO retention policy entry — must justify. */
export const RETENTION_EXCLUDED_TABLES: Record<string, string> = {
  schema_migrations: 'Sistema interno do Supabase, sem dados pessoais.',
  feature_flags: 'Configuração da aplicação, sem dado pessoal.',
  rls_canary_results: 'Telemetria interna de canário, sem dado pessoal.',
  rate_limit_violations: 'Telemetria de segurança (90d) — coberta por purge-server-logs.',
  webhook_deliveries: 'Idempotência de webhook (30d) — TTL no próprio job.',
  prescription_advances: 'Tabela operacional já coberta por orders (mesma RDC 67/2007).',
}

/* ------------------------------------------------------------------ */
/*                          THE CATALOG                                */
/* ------------------------------------------------------------------ */

export const RETENTION_CATALOG: RetentionPolicy[] = [
  /* ---------- IDENTIDADE / CONTAS ---------- */
  {
    id: 'RP-01',
    table: 'profiles',
    category: 'Perfis de usuários B2B (médicos, clínicas, farmácias, consultores)',
    description:
      'Identidade do profissional: nome, e-mail, telefone, CPF/CNPJ, dados da organização e credenciais cifradas.',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos após a desativação da conta (anonimização irreversível)',
    basis: 'execucao_contrato',
    legalCitation:
      'LGPD art. 16, II/IV (cumprimento de obrigação legal e estudo por órgão de pesquisa); LGPD art. 18, VI (eliminação por solicitação ressalvada por art. 16).',
    enforcement: {
      kind: 'cron',
      cron: 'enforce-retention',
      schedule: '0 2 1 * * (mensal)',
      action: 'anonymize',
    },
    honorsLegalHold: true,
    notes:
      'Após 5 anos: nome → "Usuário Anonimizado", e-mail → anon-<id8>@deleted.clinipharma.invalid, telefone limpo. Trilha de auditoria continua íntegra (a chain hash não é tocada).',
  },
  {
    id: 'RP-02',
    table: 'auth.users (Supabase Auth)',
    category: 'Identidades de autenticação',
    description:
      'Espelho do registro de autenticação (e-mail, hash de senha bcrypt, fatores MFA, refresh tokens ativos).',
    dataClass: 'restricted',
    retentionDays: 5 * 365,
    retentionLabel:
      '5 anos após desativação. Senha apenas em hash; tokens revogados expiram em 2h.',
    basis: 'execucao_contrato',
    legalCitation: 'LGPD art. 16, II.',
    enforcement: {
      kind: 'cron',
      cron: 'enforce-retention',
      schedule: '0 2 1 * * (mensal)',
      action: 'anonymize',
    },
    honorsLegalHold: true,
  },
  {
    id: 'RP-03',
    table: 'revoked_tokens',
    category: 'Tokens JWT revogados',
    description:
      'Lista de denylist temporária para tokens JWT que foram revogados antes da expiração natural.',
    dataClass: 'internal',
    retentionDays: 1,
    retentionLabel: '24 horas após o expires_at do token (apenas o necessário para o denylist)',
    basis: 'legitimo_interesse',
    legalCitation: 'LGPD art. 7º, IX (segurança da operação).',
    enforcement: {
      kind: 'cron',
      cron: 'purge-revoked-tokens',
      schedule: '0 3 * * * (diário)',
      action: 'delete',
    },
    honorsLegalHold: false,
    notes:
      'Não contém dado pessoal direto além do user_id (FK). Mantido apenas para o tempo de vida do token.',
  },

  /* ---------- PEDIDOS / RECEITAS ---------- */
  {
    id: 'RP-04',
    table: 'orders',
    category: 'Pedidos de manipulação',
    description:
      'Identificadores de pedido, itens, posologia, quantidades, status, preços, vínculo a clínica/farmácia/médico.',
    dataClass: 'confidential',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos após a conclusão (RDC ANVISA + Código Tributário)',
    basis: 'obrigacao_legal',
    legalCitation:
      'RDC ANVISA nº 67/2007 (escrituração de manipulação); Código Tributário Nacional art. 195; Lei 9.430/96.',
    enforcement: { kind: 'never', reason: 'Registro fiscal-sanitário — preservação obrigatória.' },
    honorsLegalHold: true,
    notes: 'Após 10 anos a anonimização é avaliada caso a caso, sob parecer jurídico.',
  },
  {
    id: 'RP-05',
    table: 'order_items',
    category: 'Itens dos pedidos',
    description: 'Detalhamento de cada item manipulado: ativo, concentração, forma, quantidade.',
    dataClass: 'confidential',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos (segue o pedido — RDC 67/2007)',
    basis: 'obrigacao_legal',
    legalCitation: 'RDC ANVISA nº 67/2007.',
    enforcement: { kind: 'never', reason: 'Registro fiscal-sanitário.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-06',
    table: 'prescriptions',
    category: 'Receitas médicas (imagens/PDF)',
    description:
      'Imagem ou PDF da receita anexada ao pedido. Dado pessoal sensível (saúde) e por vezes controlado (Portaria 344/98).',
    dataClass: 'restricted',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos para receitas controladas (Portaria 344/98) e demais (RDC 67/2007)',
    basis: 'obrigacao_legal',
    legalCitation:
      'Portaria SVS/MS nº 344/1998 (anexos B/C); RDC ANVISA nº 67/2007; LGPD art. 11, II, "a" e "f".',
    enforcement: {
      kind: 'never',
      reason: 'Registro sanitário obrigatório; imutável após upload.',
    },
    honorsLegalHold: true,
    notes:
      'Acesso restrito por RLS à clínica titular do contrato com o paciente; farmácia vê apenas o necessário para dispensação.',
  },

  /* ---------- FINANCEIRO ---------- */
  {
    id: 'RP-07',
    table: 'payments',
    category: 'Transações de pagamento',
    description: 'ID de pedido, valor, método (PIX/boleto/cartão tokenizado), status, ID PSP.',
    dataClass: 'confidential',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos (Código Tributário)',
    basis: 'obrigacao_legal',
    legalCitation: 'CTN art. 195; Lei 9.430/96; Lei 13.709/2018 art. 16, II.',
    enforcement: { kind: 'never', reason: 'Registro fiscal — preservação obrigatória.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-08',
    table: 'commissions',
    category: 'Comissões de consultores',
    description: 'Cálculo, valor, status e split de comissões para consultores comerciais.',
    dataClass: 'confidential',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos (Código Tributário + Cód. Civil)',
    basis: 'obrigacao_legal',
    legalCitation: 'CTN art. 195; Cód. Civil art. 206 (prescrição decenal).',
    enforcement: { kind: 'never', reason: 'Registro contábil-fiscal.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-09',
    table: 'consultant_transfers',
    category: 'Repasses a consultores',
    description: 'Transferências PIX/TED para consultores, com identificadores bancários.',
    dataClass: 'restricted',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos (Código Tributário)',
    basis: 'obrigacao_legal',
    legalCitation: 'CTN art. 195; Lei 9.430/96.',
    enforcement: { kind: 'never', reason: 'Registro fiscal.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-10',
    table: 'nfse_records',
    category: 'Notas fiscais de serviço (NFS-e)',
    description: 'Espelho local das NFS-e emitidas via Nuvem Fiscal.',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos (decadência tributária — CTN art. 173)',
    basis: 'obrigacao_legal',
    legalCitation: 'CTN art. 173 (decadência); legislação municipal de ISS.',
    enforcement: { kind: 'never', reason: 'Registro fiscal.' },
    honorsLegalHold: true,
  },

  /* ---------- COMUNICAÇÕES / NOTIFICAÇÕES ---------- */
  {
    id: 'RP-11',
    table: 'notifications',
    category: 'Notificações in-app',
    description: 'Notificações entregues ao usuário (texto, link, status de leitura).',
    dataClass: 'internal',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos (alinhado a audit log)',
    basis: 'execucao_contrato',
    legalCitation: 'LGPD art. 7º, V; LGPD art. 16, II.',
    enforcement: {
      kind: 'cron',
      cron: 'enforce-retention',
      schedule: '0 2 1 * * (mensal)',
      action: 'delete',
    },
    honorsLegalHold: true,
  },
  {
    id: 'RP-12',
    table: 'notification_outbox / provider logs',
    category: 'Logs de envio (Resend, Zenvia, FCM)',
    description:
      'Trilhas de entrega/erro de e-mail, SMS, WhatsApp e push. Conteúdo da mensagem não é armazenado em texto pleno após envio.',
    dataClass: 'internal',
    retentionDays: 90,
    retentionLabel: '90 dias',
    basis: 'legitimo_interesse',
    legalCitation: 'LGPD art. 7º, IX (depuração e segurança).',
    enforcement: {
      kind: 'cron',
      cron: 'purge-server-logs',
      schedule: '0 3 * * 1 (semanal)',
      action: 'delete',
    },
    honorsLegalHold: false,
  },

  /* ---------- AUDITORIA ---------- */
  {
    id: 'RP-13',
    table: 'audit_logs',
    category: 'Trilha de auditoria imutável (hash chain)',
    description:
      'Eventos sensíveis (autenticação, alteração de dado, acesso a receita, ações administrativas).',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos (entradas não-financeiras); indefinido para entradas financeiras',
    basis: 'obrigacao_legal',
    legalCitation: 'LGPD art. 37 + boas práticas (SOC 2 CC7.2); CTN art. 195 para escopo fiscal.',
    enforcement: {
      kind: 'cron',
      cron: 'enforce-retention',
      schedule: '0 2 1 * * (mensal)',
      action: 'delete',
    },
    honorsLegalHold: true,
    notes:
      'Apagamento exige RPC SECURITY DEFINER (audit_purge_retention) que escreve checkpoint em audit_chain_checkpoints — chain hash preservada.',
  },
  {
    id: 'RP-14',
    table: 'cron_runs',
    category: 'Logs de execução de cron',
    description:
      'Histórico de cada execução de job programado (status, duração, payload do retorno).',
    dataClass: 'internal',
    retentionDays: 90,
    retentionLabel: '90 dias',
    basis: 'legitimo_interesse',
    legalCitation: 'LGPD art. 7º, IX; SOC 2 CC4.1.',
    enforcement: {
      kind: 'cron',
      cron: 'purge-server-logs',
      schedule: '0 3 * * 1 (semanal)',
      action: 'delete',
    },
    honorsLegalHold: false,
  },
  {
    id: 'RP-15',
    table: 'server_logs',
    category: 'Logs estruturados da aplicação',
    description: 'Eventos da aplicação (erros, warnings, traces de jobs).',
    dataClass: 'internal',
    retentionDays: 90,
    retentionLabel: '90 dias',
    basis: 'legitimo_interesse',
    legalCitation: 'LGPD art. 7º, IX.',
    enforcement: {
      kind: 'cron',
      cron: 'purge-server-logs',
      schedule: '0 3 * * 1 (semanal)',
      action: 'delete',
    },
    honorsLegalHold: false,
    notes:
      'Logs com severidade ERROR/CRITICAL são também espelhados no Sentry (DPA + scrubbing automático de PII).',
  },

  /* ---------- DSAR / SUPORTE ---------- */
  {
    id: 'RP-16',
    table: 'dsar_requests',
    category: 'Solicitações de titulares (LGPD art. 18)',
    description:
      'Requerimentos de acesso/correção/eliminação/portabilidade, com decisão e prazo de resposta.',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos (defesa em processo administrativo ANPD)',
    basis: 'exercicio_direitos',
    legalCitation: 'LGPD art. 7º, VI; Resolução CD/ANPD nº 4/2023.',
    enforcement: { kind: 'manual', reason: 'Revisão semestral pelo DPO; sem purga automática.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-17',
    table: 'support_tickets',
    category: 'Tickets de suporte',
    description: 'Tickets abertos por usuários e pelo time interno, com transcrição da conversa.',
    dataClass: 'confidential',
    retentionDays: 3 * 365,
    retentionLabel: '3 anos (prescrição de pretensão consumerista — CDC art. 27)',
    basis: 'execucao_contrato',
    legalCitation: 'CDC art. 27; LGPD art. 7º, V; LGPD art. 16, II.',
    enforcement: {
      kind: 'manual',
      reason: 'Sem cron dedicado — purga semestral pelo time de suporte.',
    },
    honorsLegalHold: true,
  },

  /* ---------- DOCUMENTOS DE CADASTRO ---------- */
  {
    id: 'RP-18',
    table: 'registration_drafts',
    category: 'Rascunhos de cadastro (sem usuário criado)',
    description:
      'Rascunhos anônimos do fluxo de cadastro multi-step, antes da criação do usuário em auth.users.',
    dataClass: 'confidential',
    retentionDays: 7,
    retentionLabel: '7 dias após o expires_at do rascunho',
    basis: 'execucao_contrato',
    legalCitation: 'LGPD art. 6º, III (necessidade — minimização).',
    enforcement: {
      kind: 'cron',
      cron: 'purge-drafts',
      schedule: '30 3 * * * (diário)',
      action: 'delete',
    },
    honorsLegalHold: false,
    notes: 'Sem auth user associado → eliminação direta sem cascade.',
  },
  {
    id: 'RP-19',
    table: 'document_reviews',
    category: 'Revisão de documentos de cadastro (CRM, alvará, contrato social)',
    description: 'Decisões de aprovação/rejeição de documentos enviados na adesão.',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos após o término do contrato',
    basis: 'obrigacao_legal',
    legalCitation: 'CFM 2.314/2022 (cadastro de profissional); LGPD art. 16, II.',
    enforcement: { kind: 'manual', reason: 'Acompanha a vida do contrato; revisão anual.' },
    honorsLegalHold: true,
  },

  /* ---------- ARQUIVOS / OBJECT STORAGE ---------- */
  {
    id: 'RP-20',
    table: 'storage.objects (bucket: prescriptions)',
    category: 'Arquivos de receita no Supabase Storage',
    description: 'Bucket privado com PDFs/imagens de receita. Espelha 1:1 a tabela prescriptions.',
    dataClass: 'restricted',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos (alinhado à RP-06)',
    basis: 'obrigacao_legal',
    legalCitation: 'Portaria 344/98; RDC 67/2007.',
    enforcement: { kind: 'never', reason: 'Imutável após upload.' },
    honorsLegalHold: true,
  },
  {
    id: 'RP-21',
    table: 'storage.objects (bucket: registration-docs)',
    category: 'Documentos de cadastro (CRM, alvará, contrato social)',
    description: 'Bucket privado com documentos enviados durante a adesão de clínica/farmácia.',
    dataClass: 'confidential',
    retentionDays: 5 * 365,
    retentionLabel: '5 anos após desativação da conta',
    basis: 'obrigacao_legal',
    legalCitation: 'CFM 2.314/2022; ANVISA RDC 16/2014.',
    enforcement: { kind: 'manual', reason: 'Removidos junto com a anonimização da conta (RP-01).' },
    honorsLegalHold: true,
  },

  /* ---------- BACKUPS ---------- */
  {
    id: 'RP-22',
    table: 'backup_runs (metadata) + Supabase PITR',
    category: 'Backups e snapshots',
    description:
      'Snapshots diários do banco gerenciados pela Supabase, com PITR de até 7 dias e snapshots full retidos por 30 dias.',
    dataClass: 'restricted',
    retentionDays: 30,
    retentionLabel: 'PITR 7 dias + snapshots full 30 dias',
    basis: 'legitimo_interesse',
    legalCitation: 'LGPD art. 7º, IX (segurança e disponibilidade); SOC 2 CC7.5.',
    enforcement: { kind: 'manual', reason: 'Janela de retenção controlada pela Supabase.' },
    honorsLegalHold: true,
    notes:
      'Pedidos de eliminação (LGPD art. 18, VI) são respondidos com a remoção em produção; o backup expira pelo ciclo natural em até 30 dias.',
  },

  /* ---------- DOCUMENTOS LEGAIS ---------- */
  {
    id: 'RP-23',
    table: 'contracts (Clicksign + espelho local)',
    category: 'Contratos assinados eletronicamente',
    description: 'Termos e DPAs assinados pelas clínicas/farmácias, com hash de integridade.',
    dataClass: 'confidential',
    retentionDays: 10 * 365,
    retentionLabel: '10 anos após o término do contrato (Cód. Civil art. 206)',
    basis: 'obrigacao_legal',
    legalCitation: 'Cód. Civil art. 206 (prescrição decenal); Lei 14.063/2020.',
    enforcement: { kind: 'never', reason: 'Preservação contratual.' },
    honorsLegalHold: true,
  },
]

/* ------------------------------------------------------------------ */
/*                          DERIVED HELPERS                            */
/* ------------------------------------------------------------------ */

export function summarizeCatalog() {
  const total = RETENTION_CATALOG.length
  const byClass = RETENTION_CATALOG.reduce<Record<DataClass, number>>(
    (acc, p) => {
      acc[p.dataClass] = (acc[p.dataClass] ?? 0) + 1
      return acc
    },
    { public: 0, internal: 0, confidential: 0, restricted: 0 }
  )
  const byBasis = RETENTION_CATALOG.reduce<Record<RetentionBasis, number>>(
    (acc, p) => {
      acc[p.basis] = (acc[p.basis] ?? 0) + 1
      return acc
    },
    {
      execucao_contrato: 0,
      obrigacao_legal: 0,
      tutela_saude: 0,
      legitimo_interesse: 0,
      exercicio_direitos: 0,
      consentimento: 0,
    }
  )
  const automated = RETENTION_CATALOG.filter(
    (p) => p.enforcement.kind === 'cron' || p.enforcement.kind === 'ttl'
  ).length
  const honorsHold = RETENTION_CATALOG.filter((p) => p.honorsLegalHold).length
  return { total, byClass, byBasis, automated, honorsHold }
}

export function findById(id: string): RetentionPolicy | undefined {
  return RETENTION_CATALOG.find((p) => p.id === id)
}
