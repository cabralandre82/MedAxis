import { Metadata } from 'next'
import Link from 'next/link'
import { LegalLayout, Section, P, UL, Highlight } from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'Trust Center — Clinipharma',
  description:
    'Central de Confiança da Clinipharma: controles de segurança, sub-processadores, conformidade LGPD/ANVISA, certificações e relatórios públicos.',
  alternates: { canonical: '/trust' },
}

type Subprocessor = {
  name: string
  country: string
  purpose: string
  category: 'infra' | 'comm' | 'payment' | 'ai' | 'monitoring' | 'fiscal'
  safeguard: string
}

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Vercel Inc.',
    country: 'EUA',
    purpose: 'Hospedagem da aplicação web (edge + serverless)',
    category: 'infra',
    safeguard: 'DPA + SCC (Standard Contractual Clauses)',
  },
  {
    name: 'Supabase Inc.',
    country: 'EUA / UE (banco em São Paulo)',
    purpose: 'Banco de dados PostgreSQL, autenticação, armazenamento de objetos',
    category: 'infra',
    safeguard: 'DPA + SCC + dado em repouso no Brasil (region: sa-east-1)',
  },
  {
    name: 'Cloudflare Inc.',
    country: 'EUA',
    purpose: 'CDN, DNS, mitigação de DDoS, WAF',
    category: 'infra',
    safeguard: 'DPA + SCC + zero log de payload',
  },
  {
    name: 'Sentry (Functional Software Inc.)',
    country: 'EUA',
    purpose: 'Monitoramento de erros e performance da aplicação',
    category: 'monitoring',
    safeguard: 'DPA + SCC + scrubbing automático de PII',
  },
  {
    name: 'Inngest Inc.',
    country: 'EUA',
    purpose: 'Orquestração de jobs assíncronos (filas, schedules)',
    category: 'infra',
    safeguard: 'DPA + SCC + payloads pseudonimizados',
  },
  {
    name: 'Resend',
    country: 'EUA',
    purpose: 'Envio de e-mails transacionais (notificações, confirmações)',
    category: 'comm',
    safeguard: 'DPA + SCC + DKIM/SPF/DMARC configurados',
  },
  {
    name: 'Zenvia Mobile Serviços Digitais S.A.',
    country: 'Brasil',
    purpose: 'Envio de SMS e WhatsApp transacionais',
    category: 'comm',
    safeguard: 'DPA (operador no Brasil — sem transferência internacional)',
  },
  {
    name: 'Google LLC (Firebase Cloud Messaging)',
    country: 'EUA',
    purpose: 'Notificações push para aplicativos móveis',
    category: 'comm',
    safeguard: 'DPA + SCC + tokens efêmeros, sem PII no payload',
  },
  {
    name: 'OpenAI LLC',
    country: 'EUA',
    purpose: 'OCR de receitas médicas (opt-in expresso pela clínica)',
    category: 'ai',
    safeguard:
      'DPA + SCC + zero data retention + opt-in expresso + pseudonimização prévia quando viável',
  },
  {
    name: 'Asaas Pagamentos S.A.',
    country: 'Brasil',
    purpose: 'Processamento de pagamentos PIX, boleto e cartão',
    category: 'payment',
    safeguard: 'Operador no Brasil — instituição autorizada pelo BCB',
  },
  {
    name: 'Nuvem Fiscal',
    country: 'Brasil',
    purpose: 'Emissão de NF-e e NFS-e',
    category: 'fiscal',
    safeguard: 'Operador no Brasil — credenciado SEFAZ/Receita Federal',
  },
  {
    name: 'Clicksign Gestão de Documentos S.A.',
    country: 'Brasil',
    purpose: 'Assinatura eletrônica avançada de contratos',
    category: 'fiscal',
    safeguard: 'Operador no Brasil — Lei 14.063/2020',
  },
]

type Control = {
  id: string
  area: string
  description: string
  evidence: string
}

const CONTROLS: Control[] = [
  {
    id: 'CC-1',
    area: 'Criptografia em repouso',
    description: 'AES-256-GCM para dados sensíveis e segredos da aplicação.',
    evidence: 'lib/crypto.ts; supabase/migrations/* (encrypted columns)',
  },
  {
    id: 'CC-2',
    area: 'Criptografia em trânsito',
    description: 'TLS 1.3 obrigatório (HSTS preload) em todas as conexões.',
    evidence: 'next.config.ts (Strict-Transport-Security)',
  },
  {
    id: 'CC-3',
    area: 'Autenticação',
    description: 'JWT com refresh token rotation e revogação por evento; suporte a MFA.',
    evidence: 'lib/auth/*; tests/unit/lib/auth-*.test.ts',
  },
  {
    id: 'CC-4',
    area: 'Autorização',
    description: 'RBAC + Row Level Security (RLS) em todas as tabelas sensíveis.',
    evidence: 'lib/rbac.ts; supabase/migrations/*_rls.sql',
  },
  {
    id: 'CC-5',
    area: 'Auditoria',
    description: 'Trilha de auditoria imutável com hash chain (5 anos de retenção mínima).',
    evidence: 'lib/audit-log.ts; supabase/migrations/056_secret_rotation.sql',
  },
  {
    id: 'CC-6',
    area: 'Segregação de funções',
    description:
      'Papéis (SUPER_ADMIN, ADMIN, CLINIC, PHARMACY, DOCTOR, CONSULTANT) com privilégios mínimos.',
    evidence: 'lib/rbac.ts; tests/unit/rbac-*.test.ts',
  },
  {
    id: 'CC-7',
    area: 'Rate limiting observável',
    description:
      '12 buckets canônicos (auth/LGPD/upload/export) com sliding-window Redis ou in-memory; ledger SHA-256 de IP em rate_limit_violations; cron de relatório a cada 15 min com classificação info/warning/critical e alerta PagerDuty.',
    evidence:
      'lib/rate-limit.ts; app/api/cron/rate-limit-report/route.ts; docs/observability/metrics.md (§3.3); monitoring/prometheus/alerts.yml (rate_limit group); docs/runbooks/rate-limit-abuse.md',
  },
  {
    id: 'CC-8',
    area: 'Circuit breaker',
    description: 'Circuit breaker em integrações externas (5 falhas → OPEN, recovery em 30s).',
    evidence: 'lib/circuit-breaker.ts; tests/unit/lib/circuit-breaker.test.ts',
  },
  {
    id: 'CC-9',
    area: 'Rotação de segredos',
    description:
      'Rotação automatizada semanal por tier (A=auto, B=assistida, C=manual) com manifesto público (19 segredos) e ledger imutável (hash chain sha256, retenção 5 anos).',
    evidence:
      'lib/secrets/*; docs/security/secrets-manifest.json; docs/runbooks/secret-rotation.md; supabase/migrations/056_secret_rotation.sql',
  },
  {
    id: 'CC-10',
    area: 'Monitoramento e alertas',
    description:
      'Sentry para erros + 50+ métricas Prometheus em /api/metrics (autenticado por METRICS_SECRET) + 3 dashboards Grafana + 13 grupos de alert rules (severidade info/warning/critical) + on-call rotation. Página pública /status com uptime 7/30/90 d e timeline de incidentes (90 d), com fonte Grafana Cloud quando disponível e fallback automático para fonte interna (cron_runs + server_logs).',
    evidence:
      'lib/metrics.ts; app/api/metrics/route.ts; monitoring/grafana/*.json; monitoring/prometheus/alerts.yml; docs/observability/metrics.md; docs/observability/status-page.md; lib/status/*; app/api/status/summary/route.ts',
  },
  {
    id: 'CC-11',
    area: 'Backup e recuperação',
    description: 'Backup diário do banco; restore testado periodicamente (DR drill semestral).',
    evidence: 'docs/runbooks/backup-missing.md; docs/runbooks/dr-drill-2026-04.md',
  },
  {
    id: 'CC-12',
    area: 'Resposta a incidentes',
    description: 'Política de Resposta a Incidentes com SLA de notificação à ANPD em 3 dias úteis.',
    evidence:
      'docs/runbooks/secret-compromise.md; docs/compliance/soc2/policies/incident-response.md',
  },
  {
    id: 'CC-13',
    area: 'CSP e headers de segurança',
    description:
      'Content-Security-Policy estrito sem `unsafe-inline` em script-src — nonce per-request gerado no Edge middleware (`crypto.randomUUID()` × 128 bits), `strict-dynamic` para chunks Next.js + Sentry, `script-src-attr none` (zero handlers inline) e relatórios em /api/csp-report (legacy + Reporting API) com rate-limit de 10 req/10s e ledger em server_logs (RP-09, 90 d). Toggle CSP_REPORT_ONLY para canários sem deploy. X-Frame-Options DENY; Permissions-Policy restritiva; HSTS preload; COOP/CORP same-origin.',
    evidence:
      'lib/security/csp.ts; middleware.ts; app/api/csp-report/route.ts; docs/security/csp.md; tests/unit/lib/security-csp.test.ts; tests/unit/api/csp-report.test.ts; monitoring/prometheus/alerts.yml (group csp)',
  },
  {
    id: 'CC-14',
    area: 'Zero data retention em IA',
    description: 'OCR via OpenAI com opt-in expresso, pseudonimização prévia e ZDR contratado.',
    evidence: 'docs/legal/dpa-clinicas.md (Cl. 11.3); docs/legal/ripd-receitas-medicas.md',
  },
  {
    id: 'CC-15',
    area: 'Retenção e eliminação de dados',
    description:
      'Política de retenção pública (23 categorias mapeadas) com anonimização/eliminação automatizada por crons (single-flight lock + cron_runs) e suspensão por legal hold.',
    evidence:
      'docs/legal/retention-policy.md; lib/retention/policies.ts; lib/retention-policy.ts; tests/unit/lib/retention-catalog.test.ts',
  },
  {
    id: 'CC-16',
    area: 'Engenharia de caos (resiliência)',
    description:
      'Toolkit opt-in (default OFF) para validar resiliência via injeção controlada de latência/erros em fetchWithTrace e em reads de DB. Triple-opt-in para produção (CHAOS_ENABLED + CHAOS_ALLOW_PROD + ack shell). Writes (insert/update/delete/upsert) e atomic.server.ts são exemptos por design (enforce em safety-invariants test). Game-days documentados em runbook com kill-switch idempotente; cada injeção emite chaos_injection_total para observabilidade.',
    evidence:
      'lib/chaos/config.ts; lib/chaos/injector.ts; scripts/chaos/*.sh; docs/runbooks/chaos.md; tests/unit/lib/chaos/safety-invariants.test.ts; tests/unit/lib/chaos/config.test.ts; tests/unit/lib/chaos/injector.test.ts; app/api/chaos/state/route.ts',
  },
]

export default function TrustPage() {
  return (
    <LegalLayout
      title="Trust Center"
      version="1.0"
      effectiveDate="17 de abril de 2026"
      updatedDate="17 de abril de 2026"
    >
      <Highlight>
        Esta página apresenta, de forma transparente, os controles de segurança, sub-processadores e
        o estado de conformidade da Clinipharma — em linha com a Resolução CD/ANPD nº 2/2022
        (transparência) e as práticas de mercado em <em>privacy by default</em>.
      </Highlight>

      <Section title="1. Postura de segurança">
        <P>
          A Clinipharma opera uma plataforma B2B de intermediação de pedidos de medicamentos
          manipulados, processando dados pessoais comuns e dados pessoais sensíveis (saúde). Em
          razão disso, mantém uma arquitetura de segurança alinhada às boas práticas internacionais
          (ISO/IEC 27001:2022, SOC 2 Type II, OWASP ASVS L2) e à legislação brasileira aplicável.
        </P>
        <UL
          items={[
            'Defesa em profundidade (perímetro: Cloudflare; aplicação: WAF + rate limiting; dado: RLS + criptografia).',
            'Privilégio mínimo via RBAC granular e Row Level Security no banco.',
            'Trilha de auditoria imutável com hash chain (não-repúdio).',
            'Rotação automatizada de segredos (CC-9) e MFA obrigatório para SUPER_ADMIN.',
            'Programa de testes (1.500+ unitários, integração e carga).',
          ]}
        />
      </Section>

      <Section title="2. Controles de segurança implementados">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Área</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Descrição</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  Evidência (referência interna)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {CONTROLS.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600">{c.id}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.area}</td>
                  <td className="px-3 py-2 text-slate-700">{c.description}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="3. Sub-processadores ativos">
        <P>
          Lista pública e sempre atualizada dos operadores e suboperadores que tratam dados pessoais
          em nome da Clinipharma, conforme art. 39 LGPD e exigência contratual dos DPAs firmados com
          clínicas e farmácias parceiras.
        </P>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">
                  Sub-processador
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">País</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Finalidade</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Salvaguarda</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-slate-800">
                    {s.name}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{s.country}</td>
                  <td className="px-3 py-2 text-slate-700">{s.purpose}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{s.safeguard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          A Clinipharma comunica seus parceiros com 30 (trinta) dias de antecedência sobre a
          inclusão de novo sub-processador, conforme cláusulas dos DPAs vigentes. Direito de
          oposição motivada disponível pelos canais do <Link href="/dpo">DPO</Link>.
        </P>
      </Section>

      <Section title="4. Conformidade e certificações">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Norma / Selo</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Próximo passo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-medium">LGPD (Lei 13.709/2018)</td>
                <td className="px-3 py-2 text-emerald-700">Em conformidade</td>
                <td className="px-3 py-2 text-slate-600">Auditoria interna anual</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">ANVISA (RDC 67/2007, RDC 20/2011)</td>
                <td className="px-3 py-2 text-emerald-700">Em conformidade</td>
                <td className="px-3 py-2 text-slate-600">Acompanhamento contínuo</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">CFM 2.314/2022 (telemedicina)</td>
                <td className="px-3 py-2 text-emerald-700">Em conformidade (intermediação)</td>
                <td className="px-3 py-2 text-slate-600">Revisão na adesão de cada médico</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">ISO/IEC 27001:2022</td>
                <td className="px-3 py-2 text-amber-700">Controles mapeados (gap analysis)</td>
                <td className="px-3 py-2 text-slate-600">Pré-auditoria 2026 H2</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">SOC 2 Type II (AICPA)</td>
                <td className="px-3 py-2 text-amber-700">Scaffolding e policies escritos</td>
                <td className="px-3 py-2 text-slate-600">Período de observação a iniciar</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">OWASP ASVS L2</td>
                <td className="px-3 py-2 text-amber-700">Self-audit aprovado</td>
                <td className="px-3 py-2 text-slate-600">Pen-test externo planejado</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">PCI-DSS</td>
                <td className="px-3 py-2 text-slate-600">Não aplicável</td>
                <td className="px-3 py-2 text-slate-600">
                  Cartão tokenizado pelo PSP (Asaas) — escopo SAQ-A
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="5. Documentos públicos">
        <UL
          items={[
            'Política de Privacidade — /privacy',
            'Termos de Uso — /terms',
            'Carta de nomeação do DPO — /dpo',
            'RIPD Global (DPIA) — versão executiva — /legal/ripd-2026-04',
            'Política de Retenção e Eliminação de Dados — /legal/retention',
            'Inventário de segredos rastreados (metadata) — docs/security/secrets-manifest.json',
            'Status de serviços em tempo real — /status',
            'DPA Farmácias (modelo) — sob solicitação a dpo@clinipharma.com.br',
            'DPA Clínicas (modelo) — sob solicitação a dpo@clinipharma.com.br',
            'Relatório de Impacto à Proteção de Dados (RIPD-001 — receitas) — sob solicitação',
            'Parecer jurídico sênior 2026-04 (resumo executivo) — sob solicitação',
          ]}
        />
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs">
          <p className="mb-1 font-semibold text-blue-900">Avaliação de Impacto (RIPD)</p>
          <p className="text-blue-800">
            A versão executiva do <strong>RIPD Global 2026-04</strong> está publicada em{' '}
            <Link href="/legal/ripd-2026-04" className="font-medium underline">
              /legal/ripd-2026-04
            </Link>
            . Cobre as 10 atividades de tratamento, a matriz consolidada de 23 riscos com
            mitigações, a transferência internacional de dados e a decisão de risco residual. A
            versão integral (com fichas RAT por atividade) é disponibilizada à ANPD e a parceiros
            mediante requerimento.
          </p>
        </div>
      </Section>

      <Section title="6. Programa de divulgação responsável (Bug Bounty informal)">
        <P>
          A Clinipharma valoriza a comunidade de pesquisa em segurança. Pesquisadores que
          identificarem vulnerabilidades em nossos sistemas podem reportá-las via{' '}
          <a href="mailto:security@clinipharma.com.br" className="text-blue-700 underline">
            security@clinipharma.com.br
          </a>{' '}
          (use a chave PGP publicada em /trust/security.txt — em construção). Comprometemo-nos com:
        </P>
        <UL
          items={[
            'Acuse de recebimento em até 48 horas.',
            'Triagem inicial em até 5 dias úteis.',
            'Não-litigância em casos de pesquisa de boa-fé que respeitem nosso Safe Harbor.',
            'Reconhecimento público (Hall of Fame), mediante autorização do pesquisador.',
            'Recompensa simbólica em casos de vulnerabilidade crítica (em construção — programa formal previsto para 2026 H2).',
          ]}
        />
      </Section>

      <Section title="7. Histórico de incidentes públicos">
        <P>
          Nenhum incidente de segurança envolvendo dados pessoais foi identificado e/ou notificado à
          ANPD desde o início das operações. Eventuais incidentes futuros serão divulgados nesta
          seção em até 5 dias úteis após a notificação à ANPD, observando o sigilo necessário para
          preservar a investigação e os direitos dos titulares.
        </P>
        <P>
          O{' '}
          <Link href="/status" className="font-medium text-blue-700 underline">
            painel público de status
          </Link>{' '}
          exibe, em tempo real, indicadores operacionais (uptime 7/30/90 dias por componente) e o
          histórico de incidentes operacionais detectados pelos coletores internos. Esses
          indicadores são <em>operacionais</em> e independem desta seção, que continua reservada à
          comunicação formal de incidentes de privacidade.
        </P>
      </Section>

      <Section title="8. Contato">
        <UL
          items={[
            'Encarregado (DPO): dpo@clinipharma.com.br',
            'Privacidade (titulares): privacidade@clinipharma.com.br',
            'Segurança (incidentes/pesquisadores): security@clinipharma.com.br',
            'Jurídico: juridico@clinipharma.com.br',
            'Comercial: contato@clinipharma.com.br',
          ]}
        />
      </Section>

      <div className="mt-8 border-t pt-4 text-xs text-slate-500">
        <p>
          <strong>Versão:</strong> 1.0 (17/04/2026)
        </p>
        <p className="mt-1">
          <strong>Frequência de atualização:</strong> esta página é revisada a cada inclusão de novo
          sub-processador, novo controle de segurança ou alteração relevante na postura de
          conformidade.
        </p>
      </div>
    </LegalLayout>
  )
}
