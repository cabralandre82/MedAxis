import { Metadata } from 'next'
import Link from 'next/link'
import {
  LegalLayout,
  Section,
  Sub,
  P,
  UL,
  Highlight,
  Warning,
} from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'RIPD Global 2026-04 — Clinipharma',
  description:
    'Relatório de Impacto à Proteção de Dados (DPIA) global da Plataforma Clinipharma — versão executiva pública.',
  alternates: { canonical: '/legal/ripd-2026-04' },
}

type Activity = {
  id: string
  name: string
  data: string
  subjects: string
  basis: string
  retention: string
}

const ACTIVITIES: Activity[] = [
  {
    id: 'AT-01',
    name: 'Cadastro, autenticação e MFA de usuários B2B',
    data: 'Nome, e-mail, telefone, CPF, dados de organização, credenciais cifradas, fator MFA',
    subjects: 'Profissionais B2B',
    basis: 'Execução de contrato (art. 7º, V)',
    retention: 'Vida do contrato + 5 anos (audit log)',
  },
  {
    id: 'AT-02',
    name: 'Intermediação de pedidos de manipulação',
    data: 'Identificadores, itens, posologia, quantidades, status, preços',
    subjects: 'Profissionais B2B; pacientes (indireta)',
    basis: 'Execução de contrato + obrigação legal',
    retention: '10 anos (RDC 67/2007)',
  },
  {
    id: 'AT-03',
    name: 'Recepção e armazenamento de receitas médicas',
    data: 'Imagem/PDF da receita; dado de saúde sensível',
    subjects: 'Pacientes; médicos prescritores',
    basis: 'Tutela da saúde (art. 11, II, "f") + obrigação legal (art. 11, II, "a")',
    retention: '10 anos (Portaria 344/98 + RDC 67/2007)',
  },
  {
    id: 'AT-04',
    name: 'Processamento de pagamentos',
    data: 'ID do pedido, valor, método (PIX/boleto/cartão tokenizado), status',
    subjects: 'Profissionais B2B',
    basis: 'Execução de contrato',
    retention: '10 anos (Cód. Tributário)',
  },
  {
    id: 'AT-05',
    name: 'Notificações transacionais (e-mail, SMS, WhatsApp, push)',
    data: 'E-mail, telefone, conteúdo, identificador de dispositivo',
    subjects: 'Profissionais B2B',
    basis: 'Legítimo interesse (art. 7º, IX)',
    retention: '90 dias (logs); efêmero (conteúdo)',
  },
  {
    id: 'AT-06',
    name: 'Suporte ao cliente (tickets)',
    data: 'E-mail, conteúdo da mensagem, anexos',
    subjects: 'Profissionais B2B',
    basis: 'Execução de contrato',
    retention: '5 anos',
  },
  {
    id: 'AT-07',
    name: 'OCR opt-in de receitas via OpenAI',
    data: 'Imagem da receita; dado de saúde sensível',
    subjects: 'Pacientes; médicos prescritores',
    basis: 'Consentimento expresso da clínica (art. 11, I) — opt-in',
    retention: 'Não armazenado pelo operador (Zero Data Retention)',
  },
  {
    id: 'AT-08',
    name: 'Audit log imutável (hash chain)',
    data: 'ID do usuário, ação, recurso, timestamp, IP, user-agent',
    subjects: 'Profissionais B2B',
    basis: 'Cumprimento de obrigação legal (art. 7º, II)',
    retention: '5 a 7 anos',
  },
  {
    id: 'AT-09',
    name: 'Métricas de uso, telemetria e prevenção a fraude',
    data: 'IP, fingerprint, eventos agregados',
    subjects: 'Profissionais B2B; visitantes públicos',
    basis: 'Legítimo interesse (art. 7º, IX)',
    retention: '90 a 180 dias',
  },
  {
    id: 'AT-10',
    name: 'Cadastro e verificação de prescritores (CRM)',
    data: 'CRM, nome, UF, especialidade',
    subjects: 'Médicos',
    basis: 'Legítimo interesse + dado profissional público',
    retention: 'Vida da habilitação ativa + 2 anos',
  },
]

type Risk = {
  id: string
  description: string
  level: 'Alto' | 'Médio' | 'Baixo'
  mitigation: string
}

const RISKS: Risk[] = [
  {
    id: 'R01',
    description: 'Acesso não autorizado a pedidos por farmácia errada',
    level: 'Médio',
    mitigation: 'RLS por entidade; testes RBAC; auditoria contínua',
  },
  {
    id: 'R02',
    description: 'Comprometimento do storage com vazamento de receitas',
    level: 'Médio',
    mitigation: 'AES-256 em repouso; URLs pré-assinadas 5 min; bucket privado',
  },
  {
    id: 'R03',
    description: 'Download e retenção indevida pelo colaborador da farmácia',
    level: 'Médio',
    mitigation: 'URL expira 5 min; cláusula contratual; treinamento; audit log',
  },
  {
    id: 'R04',
    description: 'Falsificação de receita antes do upload',
    level: 'Alto',
    mitigation: 'Imutabilidade pós-upload; transferência contratual à clínica',
  },
  {
    id: 'R05',
    description: 'OCR via OpenAI sem opt-in válido',
    level: 'Baixo',
    mitigation: 'Botão dedicado com double opt-in; pseudonimização prévia; logs',
  },
  {
    id: 'R06',
    description: 'Retenção além do prazo necessário',
    level: 'Baixo',
    mitigation: 'Política de retenção em código com purga diária; revisão anual',
  },
  {
    id: 'R07',
    description: 'Pedido de eliminação por titular durante prazo regulatório',
    level: 'Baixo',
    mitigation: 'Base legal de obrigação prevalece (art. 16, I); resposta DPO em 15 dias',
  },
  {
    id: 'R08',
    description: 'Transferência internacional sem salvaguarda',
    level: 'Baixo',
    mitigation: 'DPAs com SCC; ZDR OpenAI; mapeamento /trust',
  },
  {
    id: 'R09',
    description: 'Comprometimento de credencial B2B (phishing/credential stuffing)',
    level: 'Alto',
    mitigation: 'MFA obrigatório SUPER_ADMIN; rate limit; JWT blacklist; alertas',
  },
  {
    id: 'R10',
    description: 'Incidente em sub-processador (Vercel/Supabase/Cloudflare)',
    level: 'Médio',
    mitigation: 'DPAs com notificação 24h; PITR; backup off-site; runbooks',
  },
  {
    id: 'R11',
    description: 'Uso indevido de receitas pela farmácia para fim diverso',
    level: 'Médio',
    mitigation: 'Proibição contratual (DPA Farmácias §11); auditoria anual; sanção',
  },
  {
    id: 'R12',
    description: 'Receita de menor sem consentimento do responsável',
    level: 'Alto',
    mitigation: 'Cláusula de responsabilidade da clínica (DPA Clínicas §7); treinamento',
  },
  {
    id: 'R13',
    description: 'Vazamento por compromentimento de provedor de notificação',
    level: 'Médio',
    mitigation: 'Conteúdo efêmero; sem PII sensível em payload; DPA Resend/Zenvia',
  },
  {
    id: 'R14',
    description: 'Webhook de pagamento adulterado (replay/fraude)',
    level: 'Médio',
    mitigation: 'Verificação de assinatura HMAC; idempotência; rate limit dedicado',
  },
  {
    id: 'R15',
    description: 'SQL injection / IDOR',
    level: 'Médio',
    mitigation: 'ORM tipado; RLS no banco; testes automatizados; ZAP scan periódico',
  },
  {
    id: 'R16',
    description: 'Decisão automatizada não revisável (art. 20 LGPD)',
    level: 'Médio',
    mitigation: 'Decisões críticas com revisão humana; explicabilidade documentada',
  },
  {
    id: 'R17',
    description: 'Acesso administrativo excessivo (privilege creep)',
    level: 'Alto',
    mitigation: 'Revisão trimestral de privilégios; Just-in-Time access (planejado); MFA',
  },
  {
    id: 'R18',
    description: 'Backup corrompido ou inacessível',
    level: 'Médio',
    mitigation: 'DR drill semestral; 3 cópias; PITR 7d',
  },
  {
    id: 'R19',
    description: 'Cookies sem consentimento adequado',
    level: 'Baixo',
    mitigation: 'Banner com granularidade; opt-in real; armazenamento da escolha',
  },
  {
    id: 'R20',
    description: 'Discriminação algorítmica em processamento de pedidos',
    level: 'Baixo',
    mitigation: 'Sem decisão automatizada significativa; revisão humana de exceções',
  },
  {
    id: 'R21',
    description: 'Falha em atender direito do titular dentro de 15 dias',
    level: 'Médio',
    mitigation: 'SLA interno; ticket dedicado para DPO; alerta em 10 dias',
  },
  {
    id: 'R22',
    description: 'Logs com dados pessoais excessivos (overlogging)',
    level: 'Médio',
    mitigation: 'PII scrubbing no Sentry; revisão de campos logados; redação centralizada',
  },
  {
    id: 'R23',
    description: 'CSP fraca permitindo XSS persistente',
    level: 'Médio',
    mitigation: 'CSP estrita com nonces (em execução); report-uri ativo',
  },
]

const LEVEL_STYLES: Record<Risk['level'], string> = {
  Alto: 'bg-red-50 text-red-700 border border-red-200',
  Médio: 'bg-amber-50 text-amber-700 border border-amber-200',
  Baixo: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

export default function RipdGlobalPage() {
  const totals = RISKS.reduce(
    (acc, r) => {
      acc[r.level]++
      return acc
    },
    { Alto: 0, Médio: 0, Baixo: 0 } as Record<Risk['level'], number>
  )

  return (
    <LegalLayout
      title="RIPD Global — Plataforma Clinipharma (2026-04)"
      version="1.0"
      effectiveDate="18 de abril de 2026"
      updatedDate="18 de abril de 2026"
    >
      <Highlight>
        Esta é a <strong>versão executiva pública</strong> do Relatório de Impacto à Proteção de
        Dados (DPIA / RIPD) global da Plataforma Clinipharma, em cumprimento ao art. 38 da LGPD e à
        Resolução CD/ANPD nº 2/2022. A versão integral, com fichas internas de Registro de
        Atividades de Tratamento (RAT — art. 37 LGPD), é arquivada com o DPO e disponibilizada à
        ANPD ou a parceiros mediante requerimento fundamentado.
      </Highlight>

      <Section title="1. Sumário executivo">
        <P>
          A Clinipharma opera marketplace B2B de intermediação entre clínicas e farmácias de
          manipulação. Trata, direta ou indiretamente, dados pessoais comuns e sensíveis (saúde) de
          cinco categorias de titulares. Esta avaliação consolidada de{' '}
          <strong>10 atividades de tratamento</strong> identificou{' '}
          <strong>{RISKS.length} riscos</strong> ({totals.Alto} altos, {totals.Médio} médios,{' '}
          {totals.Baixo} baixos), todos mitigados por medidas técnicas e organizacionais
          documentadas. O tratamento <strong>pode prosseguir com risco residual aceitável</strong>,
          condicionado à execução do plano de remediação descrito na Seção 8.
        </P>
        <UL
          items={[
            'Documento complementar: RIPD-001 (Receitas Médicas) — fluxo específico de prescrição.',
            'Cobertura de controles SOC 2 (TSC 2017/2022): ~92%.',
            'Plano de tratamento aprovado para os 4 riscos altos remanescentes.',
            'Próxima revisão obrigatória: 2027-04-18 (anual) ou em hipótese de mudança significativa.',
          ]}
        />
      </Section>

      <Section title="2. Identificação dos agentes">
        <Sub title="2.1 Controlador">
          <P>
            <strong>ALC INTERMEDIAÇÃO E REPRESENTAÇÃO LTDA</strong> — CNPJ 66.279.691/0001-12 ·
            marca comercial Clinipharma · sede operacional em Brasília-DF (cloud-first).
          </P>
        </Sub>
        <Sub title="2.2 Encarregado (DPO)">
          <P>
            <strong>André Cabral</strong> — prestador com cláusula de independência funcional ·
            canais oficiais: dpo@clinipharma.com.br · privacidade@clinipharma.com.br · página{' '}
            <Link href="/dpo" className="text-blue-700 underline">
              /dpo
            </Link>
            .
          </P>
        </Sub>
        <Sub title="2.3 Cocontroladores e sub-processadores">
          <P>
            Clínicas parceiras (DPA Clínicas v1.0) e farmácias parceiras (DPA Farmácias v1.0) atuam
            em regime de cocontrole para suas respectivas atividades. Os sub-processadores
            (operadores indiretos) estão listados em{' '}
            <Link href="/trust#sub-processadores" className="text-blue-700 underline">
              /trust
            </Link>{' '}
            e são objeto de aviso prévio de 30 dias para inclusão.
          </P>
        </Sub>
      </Section>

      <Section title="3. Atividades de tratamento mapeadas (AT-01 a AT-10)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Atividade</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Tipos de dado</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Titulares</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Base legal</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Retenção</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ACTIVITIES.map((a) => (
                <tr key={a.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600">{a.id}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{a.name}</td>
                  <td className="px-3 py-2 text-slate-700">{a.data}</td>
                  <td className="px-3 py-2 text-slate-700">{a.subjects}</td>
                  <td className="px-3 py-2 text-slate-700">{a.basis}</td>
                  <td className="px-3 py-2 text-slate-600">{a.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Cada AT possui ficha individual no Registro de Atividades de Tratamento (RAT — art. 37
          LGPD), arquivada com o DPO e auditável pela ANPD.
        </P>
      </Section>

      <Section title="4. Necessidade e proporcionalidade">
        <Sub title="4.1 Teste de necessidade">
          <P>
            Para cada AT a Plataforma adota o teste em três etapas (referencial EDPB Guidelines
            4/2019): (i) a finalidade é legítima? (ii) o tratamento é necessário? (iii) não pode ser
            atingido por meio menos invasivo? Em particular, a atividade AT-03 (receitas) e AT-04
            (pagamentos) são <strong>regulatoriamente exigidas</strong>; a AT-07 (OCR) é{' '}
            <strong>opcional e dispensável</strong>, ativada apenas mediante opt-in expresso da
            clínica.
          </P>
        </Sub>
        <Sub title="4.2 Proporcionalidade — minimização, limitação de finalidade e de retenção">
          <UL
            items={[
              'Campos identificatórios em receitas (nome do paciente, número da receita) são opcionais — o sistema não extrai PII estruturada automaticamente.',
              'Dados de saúde são utilizados exclusivamente para verificação regulatória, rastreabilidade do pedido, retenção legal e — quando solicitado — OCR pontual.',
              'Vedados: perfilamento, marketing, venda a terceiros e treinamento de modelos de IA com dados de receitas.',
              'Política de Retenção e Descarte com TTL por tabela, purga automatizada e log auditável.',
            ]}
          />
        </Sub>
      </Section>

      <Section title="5. Análise de risco consolidada (R01 a R23)">
        <P>
          Avaliação semântica probabilidade × impacto em escala 5×5, agregada em três níveis.
          Escopo: confidencialidade, integridade, disponibilidade e direitos dos titulares.
        </P>
        <div className="my-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-700">
            Alto: {totals.Alto}
          </span>
          <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700">
            Médio: {totals.Médio}
          </span>
          <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
            Baixo: {totals.Baixo}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Risco</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Nível</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Mitigação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {RISKS.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600">{r.id}</td>
                  <td className="px-3 py-2 text-slate-800">{r.description}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${LEVEL_STYLES[r.level]}`}
                    >
                      {r.level}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="6. Medidas técnicas e organizacionais (TOM)">
        <Sub title="6.1 Técnicas">
          <UL
            items={[
              'Criptografia em repouso AES-256-GCM para campos sensíveis e ao nível de volume.',
              'TLS 1.3 obrigatório com HSTS preload em todas as conexões.',
              'Autenticação JWT com refresh rotation, blacklist de revogação e MFA TOTP.',
              'Autorização RBAC com 6 papéis + Row Level Security em todas as tabelas sensíveis.',
              'Audit log imutável com hash chain e retenção de 5 a 7 anos.',
              'Segregação completa entre ambientes prod e staging (projetos Supabase distintos).',
              'Rate limiting (100 req/min/IP padrão; valores menores para login, reset e webhooks).',
              'Circuit breakers em todas as integrações externas (5 falhas → OPEN, recovery em 30 s).',
              'Headers de segurança: CSP, X-Frame-Options DENY, Permissions-Policy restritiva.',
              'Rotação automatizada de segredos quinzenal com manifesto idempotente.',
              'Backup diário + Point-in-Time Recovery 7 dias + cópia off-site mensal.',
              'Monitoramento Sentry (com PII scrubbing), métricas custom, alertas Slack 24/7.',
            ]}
          />
        </Sub>
        <Sub title="6.2 Organizacionais">
          <UL
            items={[
              'Política de Privacidade pública (/privacy) e Termos de Uso públicos (/terms).',
              'DPO com canal exclusivo e independência funcional (/dpo).',
              'DPAs assinados com toda clínica e farmácia parceira.',
              'Sub-processadores publicados em /trust com aviso de 30 dias para inclusão.',
              'Política de Resposta a Incidentes com SLA de notificação à ANPD em 3 dias úteis.',
              'Política de Continuidade de Negócios com DR drill semestral.',
              'Política de Classificação de Dados em 4 níveis (público / interno / confidencial / restrito).',
              'Política de Acesso Lógico com revisão trimestral de privilégios.',
              'Política de Vendor Management com avaliação anual de sub-processadores.',
              'Treinamento anual obrigatório em LGPD e segurança da informação.',
              'Programa de Divulgação Responsável (Bug Bounty informal — /trust §6) com SLA de triagem em 5 dias úteis.',
            ]}
          />
        </Sub>
      </Section>

      <Section title="7. Transferência internacional de dados (LGPD art. 33)">
        <P>
          O banco principal está provisionado em <strong>São Paulo (sa-east-1)</strong>;
          sub-processadores internacionais possuem DPA com Cláusulas Contratuais Padrão (SCC) e —
          quando aplicável — contrato de Zero Data Retention (ex.: OpenAI). Foi conduzida avaliação
          simplificada de impacto de transferência (TIA) para destinatários nos EUA, considerando o
          regime jurídico local; os dados sensíveis efetivamente transferidos são minimizados (OCR
          opt-in com pseudonimização viável; metadados de telemetria sem PII direta).
        </P>
      </Section>

      <Section title="8. Plano de remediação">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Item</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Prazo</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Owner</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-medium">MFA obrigatório para todos os papéis B2B</td>
                <td className="px-3 py-2 text-slate-700">2026-Q4</td>
                <td className="px-3 py-2 text-slate-700">Produto</td>
                <td className="px-3 py-2 text-amber-700">Em planejamento</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Just-in-Time access para SUPER_ADMIN</td>
                <td className="px-3 py-2 text-slate-700">2026-Q4</td>
                <td className="px-3 py-2 text-slate-700">Eng Lead</td>
                <td className="px-3 py-2 text-amber-700">Em planejamento</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Pentest externo independente</td>
                <td className="px-3 py-2 text-slate-700">2026-Q3</td>
                <td className="px-3 py-2 text-slate-700">Segurança + Procurement</td>
                <td className="px-3 py-2 text-amber-700">RFP em elaboração</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Política de retenção em código</td>
                <td className="px-3 py-2 text-slate-700">2026-Q2</td>
                <td className="px-3 py-2 text-slate-700">Eng Lead</td>
                <td className="px-3 py-2 text-blue-700">Em execução</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">CSP sem unsafe-inline (nonces SSR)</td>
                <td className="px-3 py-2 text-slate-700">2026-Q2</td>
                <td className="px-3 py-2 text-slate-700">Eng Lead</td>
                <td className="px-3 py-2 text-blue-700">Em execução</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Status page real (substituir placeholder)</td>
                <td className="px-3 py-2 text-slate-700">2026-Q2</td>
                <td className="px-3 py-2 text-slate-700">SRE</td>
                <td className="px-3 py-2 text-blue-700">Em execução</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">
                  Risk register sistematizado em ferramenta dedicada
                </td>
                <td className="px-3 py-2 text-slate-700">2026-Q3</td>
                <td className="px-3 py-2 text-slate-700">DPO</td>
                <td className="px-3 py-2 text-slate-600">A iniciar</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Code of Conduct e Org Chart formalizados</td>
                <td className="px-3 py-2 text-slate-700">2026-Q3</td>
                <td className="px-3 py-2 text-slate-700">RH + DPO</td>
                <td className="px-3 py-2 text-slate-600">A iniciar</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-medium">Treinamento de LGPD para 100% da equipe</td>
                <td className="px-3 py-2 text-slate-700">2026-Q2</td>
                <td className="px-3 py-2 text-slate-700">RH + DPO</td>
                <td className="px-3 py-2 text-blue-700">Em execução</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="9. Decisão de risco residual">
        <P>
          Considerando (i) a robustez dos controles técnicos e organizacionais já implementados
          (cobertura SOC 2 ≈ 92%), (ii) o conjunto de mitigações documentadas para cada risco, com o
          maior risco residual classificado como Alto apenas em quatro itens (R04 transferido,
          R09/R12/R17 com plano de tratamento e prazo) e (iii) a existência de plano de remediação
          aprovado:
        </P>
        <Highlight>
          <strong>Decisão (art. 38, parágrafo único, LGPD):</strong> o tratamento pode prosseguir
          sob a tutela da Clinipharma, com risco residual aceitável e proporcional ao benefício
          regulatório, sanitário, social e econômico. Esta decisão não dispensa monitoramento
          contínuo nem revisão antecipada em caso de mudança significativa, incidente grave ou nova
          orientação da ANPD.
        </Highlight>
      </Section>

      <Section title="10. Ciclo de revisão">
        <UL
          items={[
            'Frequência mínima: anual (próxima revisão obrigatória: 2027-04-18).',
            'Revisão antecipada: inclusão de novo sub-processador com acesso a dado sensível.',
            'Revisão antecipada: ampliação substancial de finalidades ou tipos de dado tratados.',
            'Revisão antecipada: incidente classificado como SEV-1 ou SEV-2 envolvendo dado pessoal.',
            'Revisão antecipada: publicação de nova regulamentação relevante da ANPD.',
            'Revisão antecipada: alteração significativa de arquitetura ou de localização de armazenamento.',
          ]}
        />
      </Section>

      <Section title="11. Documentos relacionados">
        <UL
          items={[
            'RIPD-001 (Receitas Médicas) — fluxo específico, sob solicitação ao DPO.',
            'DPA Clínicas v1.0 — sob solicitação ao DPO.',
            'DPA Farmácias v1.0 — sob solicitação ao DPO.',
            'Política de Privacidade — /privacy.',
            'Termos de Uso — /terms.',
            'Página do DPO — /dpo.',
            'Trust Center — /trust.',
            'Status de serviços — /status.',
          ]}
        />
      </Section>

      <Warning>
        <strong>Observação:</strong> a versão integral deste RIPD inclui campos internos de
        identificação de aprovadores (Eng Lead e Representante Legal) e fichas individuais de RAT,
        cujo conteúdo é classificado como confidencial e fica disponível ao DPO para apresentação à
        ANPD ou a parceiros mediante requerimento fundamentado.
      </Warning>

      <div className="mt-8 border-t pt-4 text-xs text-slate-500">
        <p>
          <strong>Versão:</strong> 1.0 (18/04/2026) · <strong>Próxima revisão:</strong> 18/04/2027
        </p>
        <p className="mt-1">
          <strong>Base normativa:</strong> Lei nº 13.709/2018 (LGPD), arts. 6º, 7º, 8º, 9º, 11, 16,
          18, 33, 37, 38, 39, 41, 50; Resolução CD/ANPD nº 2/2022 (transparência); Resolução CD/ANPD
          nº 4/2023 (transferência internacional); Resolução CD/ANPD nº 15/2024 (incidentes);
          Resolução CD/ANPD nº 18/2024 (Encarregado).
        </p>
      </div>
    </LegalLayout>
  )
}
