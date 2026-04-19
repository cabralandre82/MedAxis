import { Metadata } from 'next'
import Link from 'next/link'
import { LegalLayout, Section, P, UL, Highlight } from '@/components/legal/legal-layout'
import { RETENTION_CATALOG, summarizeCatalog, type DataClass } from '@/lib/retention/policies'

export const metadata: Metadata = {
  title: 'Política de Retenção e Eliminação — Clinipharma',
  description:
    'Política pública de retenção e eliminação de dados pessoais da Plataforma Clinipharma — prazos, base legal e mecanismos de enforcement.',
  alternates: { canonical: '/legal/retention' },
}

const CLASS_LABEL: Record<DataClass, { label: string; color: string }> = {
  public: { label: 'Público', color: 'bg-slate-100 text-slate-700' },
  internal: { label: 'Interno', color: 'bg-blue-100 text-blue-700' },
  confidential: { label: 'Confidencial', color: 'bg-amber-100 text-amber-800' },
  restricted: { label: 'Restrito', color: 'bg-rose-100 text-rose-800' },
}

const GROUPS: { label: string; ids: string[] }[] = [
  { label: '1. Identidade e contas', ids: ['RP-01', 'RP-02', 'RP-03'] },
  { label: '2. Pedidos e receitas médicas', ids: ['RP-04', 'RP-05', 'RP-06'] },
  { label: '3. Financeiro e fiscal', ids: ['RP-07', 'RP-08', 'RP-09', 'RP-10'] },
  { label: '4. Comunicações e notificações', ids: ['RP-11', 'RP-12'] },
  { label: '5. Auditoria e logs', ids: ['RP-13', 'RP-14', 'RP-15'] },
  { label: '6. DSAR e suporte', ids: ['RP-16', 'RP-17'] },
  { label: '7. Cadastro e documentos', ids: ['RP-18', 'RP-19'] },
  { label: '8. Object storage', ids: ['RP-20', 'RP-21'] },
  { label: '9. Backups', ids: ['RP-22'] },
  { label: '10. Contratos', ids: ['RP-23'] },
]

export default function RetentionPolicyPage() {
  const summary = summarizeCatalog()
  return (
    <LegalLayout
      title="Política de Retenção e Eliminação de Dados"
      version="1.0"
      effectiveDate="18 de abril de 2026"
      updatedDate="18 de abril de 2026"
    >
      <Highlight>
        Esta página torna pública a Política de Retenção e Eliminação de Dados Pessoais da
        Clinipharma, em cumprimento ao princípio da transparência (LGPD art. 6º, VI) e à Resolução
        CD/ANPD nº 2/2022. A versão integral, com fundamentação detalhada, está em{' '}
        <code>docs/legal/retention-policy.md</code> e é mantida sob versionamento. A fonte de
        verdade técnica é o catálogo tipado em <code>lib/retention/policies.ts</code>, validado por
        teste de invariantes em CI.
      </Highlight>

      <Section title="1. Princípios">
        <P>
          A retenção de dados pessoais na Plataforma Clinipharma observa os princípios da
          necessidade, adequação, finalidade, transparência, segurança, não-discriminação e
          responsabilização (LGPD art. 6º). Cada categoria de dado tem prazo definido com base
          estrita na finalidade que a justificou e na obrigação legal aplicável.
        </P>
        <UL
          items={[
            'Eliminação automatizada por crons protegidos por single-flight lock (cron_runs).',
            'Anonimização irreversível como método padrão para dados de identidade (preserva integridade fiscal).',
            'Eliminação de audit_logs preserva a hash chain via RPC SECURITY DEFINER (audit_purge_retention).',
            'Legal hold suspende a eliminação enquanto houver investigação ou demanda judicial.',
            'Direito do titular à eliminação (art. 18 VI) processado em até 15 dias corridos.',
          ]}
        />
      </Section>

      <Section title="2. Resumo do catálogo">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Categorias mapeadas" value={String(summary.total)} />
          <SummaryCard
            label="Eliminação automatizada"
            value={`${summary.automated}/${summary.total}`}
          />
          <SummaryCard label="Honra legal hold" value={`${summary.honorsHold}/${summary.total}`} />
          <SummaryCard
            label="Bases legais distintas"
            value={String(Object.values(summary.byBasis).filter((n) => n > 0).length)}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {(Object.keys(summary.byClass) as DataClass[]).map((k) => (
            <span key={k} className={`rounded-full px-3 py-1 font-medium ${CLASS_LABEL[k].color}`}>
              {CLASS_LABEL[k].label}: {summary.byClass[k]}
            </span>
          ))}
        </div>
      </Section>

      <Section title="3. Catálogo por categoria">
        <P>
          Cada linha tem um identificador estável (<code>RP-NN</code>) referenciável em DPAs,
          contratos e respostas a titulares. Prazos podem ser superiores ao mínimo legal quando o
          superior atender também outra obrigação (ex.: 10 anos cobre simultaneamente CTN e RDC
          67/2007).
        </P>
        {GROUPS.map((group) => {
          const policies = RETENTION_CATALOG.filter((p) => group.ids.includes(p.id))
          return (
            <div key={group.label} className="mt-6">
              <h3 className="mb-2 text-sm font-bold text-slate-800">{group.label}</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="border-b bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Categoria / Tabela
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Classificação
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Prazo</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Base legal
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Mecanismo
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {policies.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono font-medium whitespace-nowrap text-slate-700">
                          {p.id}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-slate-800">{p.category}</div>
                          <code className="text-[10px] text-slate-500">{p.table}</code>
                          <div className="mt-1 text-slate-600">{p.description}</div>
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CLASS_LABEL[p.dataClass].color}`}
                          >
                            {CLASS_LABEL[p.dataClass].label}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-slate-700">{p.retentionLabel}</td>
                        <td className="px-3 py-2 align-top text-xs text-slate-600">
                          {p.legalCitation}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-slate-600">
                          <EnforcementCell p={p} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </Section>

      <Section title="4. Mecanismos de enforcement">
        <P>
          Toda eliminação automatizada é executada por cron Vercel protegido pelo middleware
          <code> withCronGuard </code> (single-flight lock + trilha em <code>cron_runs</code>):
        </P>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Cron</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Schedule (UTC)</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Cobre</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-mono">purge-revoked-tokens</td>
                <td className="px-3 py-2">0 3 * * * (diário)</td>
                <td className="px-3 py-2">RP-03</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono">purge-drafts</td>
                <td className="px-3 py-2">30 3 * * * (diário)</td>
                <td className="px-3 py-2">RP-18</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono">purge-server-logs</td>
                <td className="px-3 py-2">0 3 * * 1 (semanal)</td>
                <td className="px-3 py-2">RP-12, RP-14, RP-15</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono">enforce-retention</td>
                <td className="px-3 py-2">0 2 1 * * (mensal)</td>
                <td className="px-3 py-2">RP-01, RP-02, RP-11, RP-13</td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          Quanto às tabelas marcadas como <em>preservação obrigatória</em>, não há job de eliminação
          porque a manutenção decorre de obrigação legal (RDC ANVISA, CTN, Cód. Civil). Nesses casos
          a Clinipharma garante apenas as garantias de integridade (hash chain, imutabilidade
          pós-upload, RLS) e de minimização da exposição (acesso por contexto de contrato).
        </P>
      </Section>

      <Section title="5. Direito de eliminação pelo titular (LGPD art. 18, VI)">
        <P>
          O titular pode requerer a eliminação de seus dados pessoais. A Clinipharma atende em até
          15 dias corridos (prorrogáveis por igual período mediante justificativa formal — LGPD art.
          19, II). Quando a eliminação for parcialmente inviável por exceção do art. 16 LGPD (ex.:
          registro fiscal de pedido), a resposta detalha exatamente o que foi removido e o que foi
          retido, com a base legal específica.
        </P>
        <P>
          Solicitações são registradas em <code>dsar_requests</code> (RP-16), monitoradas por SLA
          horário (cron <code>dsar-sla-check</code>) e respondidas pelos canais do{' '}
          <Link href="/dpo" className="text-blue-700 underline">
            DPO
          </Link>
          .
        </P>
      </Section>

      <Section title="6. Legal hold">
        <P>
          Quando há investigação interna, demanda judicial ou requisição de autoridade, o DPO ou a
          Diretoria Jurídica podem registrar um <em>legal hold</em> que suspende as rotinas de
          eliminação para a entidade afetada. As políticas marcadas como{' '}
          <strong>&ldquo;honra legal hold&rdquo;</strong> consultam a tabela{' '}
          <code>legal_holds</code> antes de qualquer DELETE/anonimização. Bloqueios são
          contabilizados na métrica <code>legal_hold_purge_blocked_total</code> e auditados
          mensalmente pelo DPO.
        </P>
      </Section>

      <Section title="7. Sub-processadores">
        <P>
          Sub-processadores observam prazos próprios de retenção, registrados nos respectivos DPAs.
          Casos especiais:
        </P>
        <UL
          items={[
            'OpenAI (OCR de receitas) — opt-in expresso da clínica + ZDR contratado + payload pseudonimizado quando viável.',
            'Sentry — scrubbing automático de PII; retenção de 90 dias.',
            'Resend / Zenvia / Firebase Cloud Messaging — logs de envio retidos por 90 dias; conteúdo da mensagem não armazenado em texto pleno após envio.',
          ]}
        />
        <P>
          A lista completa e sempre atualizada está no{' '}
          <Link href="/trust" className="text-blue-700 underline">
            Trust Center
          </Link>
          .
        </P>
      </Section>

      <Section title="8. Auditoria e evidência">
        <UL
          items={[
            'Catálogo tipado: lib/retention/policies.ts (fonte de verdade)',
            'Documento canônico: docs/legal/retention-policy.md',
            'Implementação: lib/retention-policy.ts',
            'Histórico de execuções: tabela cron_runs (90 dias)',
            'Teste de invariantes: tests/unit/lib/retention-catalog.test.ts',
            'Métrica: legal_hold_purge_blocked_total',
          ]}
        />
      </Section>

      <Section title="9. Revisão e governança">
        <P>
          Esta política é revisada semestralmente (próxima revisão obrigatória: 18/10/2026) e a cada
          inclusão de nova tabela com dado pessoal. Mudanças relevantes para parceiros (clínicas e
          farmácias) são comunicadas com 30 dias de antecedência conforme cláusula DPA.
        </P>
      </Section>

      <div className="mt-8 border-t pt-4 text-xs text-slate-500">
        <p>
          <strong>Versão:</strong> 1.0 (18/04/2026) — aprovação: DPO + Diretoria Executiva.
        </p>
        <p className="mt-1">
          <strong>Base normativa:</strong> Lei nº 13.709/2018 (LGPD), arts. 6º, 16, 18, 19, 37 e 41;
          Resolução CD/ANPD nº 2/2022 (transparência); Resolução CD/ANPD nº 4/2023 (DSAR); RDC
          ANVISA nº 67/2007 e Portaria SVS/MS nº 344/1998 (prescrição); CTN art. 195; Cód. Civil
          art. 206; CFM 2.314/2022.
        </p>
      </div>
    </LegalLayout>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  )
}

function EnforcementCell({ p }: { p: (typeof RETENTION_CATALOG)[number] }) {
  const e = p.enforcement
  if (e.kind === 'cron') {
    return (
      <div>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
          cron
        </span>
        <div className="mt-1 font-mono text-[10px]">{e.cron}</div>
        <div className="text-[10px] text-slate-500">
          {e.schedule} · {e.action}
        </div>
      </div>
    )
  }
  if (e.kind === 'ttl') {
    return (
      <div>
        <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800">ttl</span>
        <div className="mt-1 font-mono text-[10px]">{e.column}</div>
      </div>
    )
  }
  if (e.kind === 'manual') {
    return (
      <div>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
          manual
        </span>
        <div className="mt-1 text-[10px] text-slate-500">{e.reason}</div>
      </div>
    )
  }
  return (
    <div>
      <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800">sem purga</span>
      <div className="mt-1 text-[10px] text-slate-500">{e.reason}</div>
    </div>
  )
}
