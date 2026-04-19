import type { Metadata } from 'next'
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
  title: 'Política de Privacidade | Clinipharma',
  robots: 'index, follow',
}

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      version="1.2"
      effectiveDate="08 de abril de 2026"
      updatedDate="17 de abril de 2026"
    >
      <Highlight>
        Esta Política de Privacidade foi elaborada em conformidade com a Lei Geral de Proteção de
        Dados Pessoais (Lei nº 13.709/2018 — LGPD), o Marco Civil da Internet (Lei nº 12.965/2014),
        a Resolução da Diretoria Colegiada ANVISA nº 204/2017 e demais normas regulatórias
        aplicáveis ao setor farmacêutico e de saúde no Brasil.
      </Highlight>

      {/* 1 */}
      <Section title="1. Identificação do Controlador">
        <P>
          A <strong>Clinipharma</strong> é uma plataforma B2B de intermediação entre clínicas
          médicas, médicos prescritores e farmácias de manipulação, operada por pessoa jurídica
          constituída sob as leis do Brasil (<strong>&ldquo;Clinipharma&rdquo;</strong>,{' '}
          <strong>&ldquo;nós&rdquo;</strong> ou <strong>&ldquo;Controlador&rdquo;</strong>).
        </P>
        <P>
          Para exercer seus direitos como titular de dados ou entrar em contato com nosso
          Encarregado de Proteção de Dados (DPO), utilize:
        </P>
        <UL
          items={[
            'E-mail: privacidade@clinipharma.com.br',
            'Prazo de resposta: até 15 dias corridos (LGPD Art. 19)',
          ]}
        />
      </Section>

      {/* 2 */}
      <Section title="2. Dados Pessoais que Coletamos">
        <Sub title="2.1 Dados de identificação e cadastro">
          <UL
            items={[
              'Nome completo e razão social',
              'CPF e/ou CNPJ',
              'Endereço de e-mail (login e comunicações)',
              'Número de telefone e celular (criptografado em repouso — AES-256-GCM)',
              'Número do CRM/CRF com UF (para médicos e farmacêuticos — criptografado)',
              'Endereço completo (logradouro, CEP, cidade, estado)',
            ]}
          />
        </Sub>

        <Sub title="2.2 Dados de uso da plataforma">
          <UL
            items={[
              'Registros de acesso: IP, data, hora, duração de sessão (Marco Civil da Internet, Art. 15)',
              'Histórico de pedidos, orçamentos e rastreabilidade de entrega',
              'Ações realizadas na plataforma (logs de auditoria imutáveis)',
              'Preferências de notificação',
              'Dispositivo, navegador e sistema operacional (para segurança e suporte)',
            ]}
          />
        </Sub>

        <Sub title="2.3 Dados financeiros">
          <UL
            items={[
              'Dados de cobrança e formas de pagamento (processados pelo Asaas — PCI DSS Level 1)',
              'Histórico de transações e comprovantes',
              'Informações bancárias para repasse de comissões (conta, agência, banco)',
            ]}
          />
        </Sub>

        <Sub title="2.4 Dados de documentos e formulários">
          <UL
            items={[
              'Documentos enviados no processo de cadastro (CNES, Alvará, CRF, CRM)',
              'Formulários de solicitação de manipulação (dados do paciente, quando aplicável)',
              'Contratos assinados digitalmente via Clicksign',
            ]}
          />
        </Sub>

        <Warning>
          <strong>Dado sensível:</strong> Informações relacionadas à saúde do paciente eventualmente
          presentes em formulários de manipulação são tratadas com base no Art. 11, II,
          &ldquo;a&rdquo; (cumprimento de obrigação legal — RDC ANVISA nº 67/2007 e Portaria SVS/MS
          nº 344/1998) e no Art. 11, II, &ldquo;g&rdquo; da LGPD (tutela da saúde, exclusivamente,
          em procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade
          sanitária) e ficam acessíveis exclusivamente ao médico prescritor, à farmácia executante e
          ao paciente, nunca sendo compartilhadas com terceiros para fins comerciais.
        </Warning>
      </Section>

      {/* 3 */}
      <Section title="3. Finalidade e Base Legal do Tratamento">
        <P>
          Tratamos seus dados pessoais com base nas seguintes hipóteses legais previstas no Art. 7º
          da LGPD:
        </P>

        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 font-semibold text-slate-600">
                <th className="px-3 py-2 text-left">Finalidade</th>
                <th className="px-3 py-2 text-left">Base Legal (LGPD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['Autenticação e controle de acesso', 'Art. 7º, V — execução de contrato'],
                ['Processamento de pedidos e pagamentos', 'Art. 7º, V — execução de contrato'],
                [
                  'Emissão de NF-e/NFS-e e escrituração fiscal',
                  'Art. 7º, II — cumprimento de obrigação legal/regulatória',
                ],
                ['Contratos digitais (Clicksign)', 'Art. 7º, V — execução de contrato'],
                [
                  'Verificação de CNPJ e situação cadastral',
                  'Art. 7º, V — execução de contrato (procedimento preliminar); Art. 7º, IX — legítimo interesse de prevenção a fraude',
                ],
                [
                  'Compliance regulatório ANVISA/CFF',
                  'Art. 7º, II — cumprimento de obrigação legal/regulatória',
                ],
                ['Notificações transacionais (e-mail, SMS)', 'Art. 7º, V — execução de contrato'],
                ['Suporte ao usuário e gestão de tickets', 'Art. 7º, V — execução de contrato'],
                [
                  'Auditoria e logs de acesso',
                  'Art. 7º, II — obrigação legal (Marco Civil da Internet, Art. 15); Art. 7º, IX — legítimo interesse de segurança',
                ],
                [
                  'Análise de desempenho da plataforma (dados agregados)',
                  'Art. 7º, IX — legítimo interesse',
                ],
                ['Prevenção a fraudes', 'Art. 7º, IX — legítimo interesse'],
                [
                  'Atendimento aos direitos do titular (LGPD)',
                  'Art. 7º, II — cumprimento de obrigação legal/regulatória',
                ],
                [
                  'Tratamento de dados de saúde em receitas (cocontrole com a clínica)',
                  'Art. 11, II, "a" — obrigação legal (ANVISA); Art. 11, II, "g" — tutela da saúde',
                ],
                [
                  'Datasets anonimizados para pesquisa, segurança e produto',
                  'Art. 12 — dados anonimizados não estão sujeitos à LGPD',
                ],
              ].map(([fin, base], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-2 text-slate-700">{fin}</td>
                  <td className="px-3 py-2 text-slate-500">{base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <P>
          <strong>Não realizamos</strong> marketing direto, venda de dados a terceiros, perfilamento
          comportamental para publicidade ou decisões automatizadas que produzam efeitos jurídicos
          sem revisão humana.
        </P>
      </Section>

      {/* 4 */}
      <Section title="4. Compartilhamento de Dados (Operadores e Suboperadores)">
        <P>
          Compartilhamos dados estritamente na medida necessária para a prestação dos serviços, com
          os seguintes operadores e suboperadores. Esta lista é a fonte única de verdade e está
          alinhada com os Acordos de Tratamento de Dados (DPAs) celebrados com clínicas e farmácias
          parceiras:
        </P>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 font-semibold text-slate-600">
                <th className="px-3 py-2 text-left">Operador</th>
                <th className="px-3 py-2 text-left">País-sede</th>
                <th className="px-3 py-2 text-left">Finalidade</th>
                <th className="px-3 py-2 text-left">Instrumento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                [
                  'Supabase Inc.',
                  'EUA',
                  'Banco de dados PostgreSQL e autenticação',
                  'DPA Supabase + Cláusulas Contratuais Padrão',
                ],
                ['Vercel Inc.', 'EUA', 'Hospedagem e edge runtime', 'DPA Vercel'],
                ['Cloudflare Inc.', 'EUA', 'CDN, DNS e proteção contra ataques', 'DPA Cloudflare'],
                [
                  'Asaas Pagamentos S.A.',
                  'Brasil',
                  'Gateway de pagamento (PCI DSS Level 1) e split',
                  'Contrato bilateral Asaas',
                ],
                [
                  'Clicksign Gestão de Documentos S.A.',
                  'Brasil',
                  'Assinatura eletrônica avançada (Lei 14.063/2020, Art. 5º)',
                  'Contrato bilateral Clicksign',
                ],
                ['Resend Inc.', 'EUA', 'E-mail transacional', 'DPA Resend'],
                [
                  'Zenvia Mobile Serviços Digitais S.A.',
                  'Brasil',
                  'SMS e WhatsApp transacionais',
                  'Contrato bilateral Zenvia',
                ],
                [
                  'Google LLC (Firebase Cloud Messaging)',
                  'EUA',
                  'Push notifications (token FCM)',
                  'DPA Google Cloud',
                ],
                [
                  'OpenAI LLC',
                  'EUA',
                  'OCR de documentos cadastrais e (sob demanda) receitas; classificação de tickets',
                  'DPA OpenAI — zero data retention via API',
                ],
                ['Inngest Inc.', 'EUA', 'Orquestração de jobs assíncronos', 'DPA Inngest'],
                [
                  'Sentry (Functional Software Inc.)',
                  'EUA',
                  'Monitoramento de erros (sem PII no payload)',
                  'DPA Sentry',
                ],
                [
                  'Nuvem Fiscal',
                  'Brasil',
                  'Emissão de NF-e/NFS-e',
                  'Contrato bilateral Nuvem Fiscal',
                ],
                [
                  'ReceitaWS / SerproWS',
                  'Brasil',
                  'Consulta de situação cadastral de CNPJ (dados públicos da Receita Federal)',
                  'Termos de uso públicos',
                ],
                [
                  'Autoridades públicas (ANPD, ANVISA, RFB, CFF, Poder Judiciário)',
                  'Brasil',
                  'Cumprimento de ordem judicial, requisição regulatória ou obrigação legal',
                  'LGPD Art. 7º, II e VI',
                ],
              ].map(([op, pais, fin, inst], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-2 font-medium text-slate-700">{op}</td>
                  <td className="px-3 py-2 text-slate-600">{pais}</td>
                  <td className="px-3 py-2 text-slate-600">{fin}</td>
                  <td className="px-3 py-2 text-slate-500">{inst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Todos os operadores e suboperadores são contratualmente obrigados a tratar dados pessoais
          exclusivamente conforme nossas instruções, manter medidas de segurança adequadas e não
          subcontratarem terceiros sem nossa autorização prévia por escrito. A inclusão de novo
          suboperador é comunicada às clínicas e farmácias parceiras com antecedência mínima de{' '}
          <strong>30 (trinta) dias corridos</strong>, com direito de oposição motivada.
        </P>
      </Section>

      {/* 5 */}
      <Section title="5. Transferência Internacional de Dados">
        <P>
          Alguns operadores listados na Seção 4 armazenam ou processam dados fora do Brasil (EUA,
          União Europeia). Adotamos as seguintes garantias:
        </P>
        <UL
          items={[
            'Cláusulas contratuais padrão (Standard Contractual Clauses — SCCs) exigidas pela ANPD',
            'Operadores localizados em países com nível de proteção adequado reconhecido pela ANPD ou pela Comissão Europeia',
            'Data Processing Agreements (DPA) celebrados com cada operador internacional',
          ]}
        />
      </Section>

      {/* 6 */}
      <Section title="6. Retenção e Exclusão de Dados">
        <div className="mt-2 overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 font-semibold text-slate-600">
                <th className="px-3 py-2 text-left">Categoria de dado</th>
                <th className="px-3 py-2 text-left">Prazo de retenção</th>
                <th className="px-3 py-2 text-left">Base legal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ['Dados financeiros e contábeis', '10 anos', 'Lei nº 9.613/98; IN RFB nº 1.757/17'],
                [
                  'Logs de acesso à plataforma',
                  '6 meses (mínimo legal)',
                  'Marco Civil da Internet, Art. 15',
                ],
                ['Logs de auditoria interna', '5 anos', 'Legítimo interesse / compliance'],
                [
                  'Dados de PII (telefone, CRM)',
                  '5 anos após último acesso',
                  'LGPD — proporcionalidade',
                ],
                [
                  'Documentos regulatórios (CNES, Alvará)',
                  '5 anos após vigência',
                  'Resolução ANVISA RDC 204/2017',
                ],
                ['Formulários de manipulação', '10 anos', 'RDC ANVISA nº 67/2007 (Farmácias)'],
                ['Contratos digitais (Clicksign)', '5 anos', 'Código Civil, Art. 205'],
                ['Dados de suporte (tickets)', '2 anos após encerramento', 'Legítimo interesse'],
              ].map(([cat, prazo, base], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  <td className="px-3 py-2 text-slate-700">{cat}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{prazo}</td>
                  <td className="px-3 py-2 text-slate-500">{base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Findo o prazo legal, os dados são anonimizados ou deletados de forma segura, conforme
          nossa Política de Retenção e Descarte implementada no sistema (job automático mensal).
        </P>
      </Section>

      {/* 7 */}
      <Section title="7. Segurança dos Dados">
        <P>
          Implementamos medidas técnicas e organizacionais compatíveis com o estado da arte e com o
          porte da operação:
        </P>
        <UL
          items={[
            'Criptografia em trânsito: TLS 1.3 em todas as conexões',
            'Criptografia em repouso: AES-256-GCM para dados sensíveis (telefone, CRM, formulários)',
            'Autenticação: JWT com expiração curta + blacklist de tokens revogados; sessões revogadas imediatamente em caso de desativação ou suspeita de comprometimento',
            'Controle de acesso: RBAC granular com Row Level Security (RLS) no banco de dados — cada entidade acessa apenas seus dados',
            'Auditoria: log imutável de todas as ações críticas com X-Request-ID rastreável; retenção de 5 anos (10 anos para registros financeiros)',
            'Rate limiting: por IP e por usuário em todos os endpoints da API',
            'Circuit breaker em integrações externas (Resend, Zenvia, OpenAI, Asaas, Clicksign)',
            'Monitoramento: alertas de anomalia via Sentry e UptimeRobot; deep health probe contínuo',
            'Backups automáticos com point-in-time recovery e ledger criptográfico de integridade',
            'Política de senha: mínimo 12 caracteres com complexidade (maiúsculas, minúsculas, números e símbolos); troca obrigatória em caso de suspeita de comprometimento',
            'MFA disponível para todos os usuários e exigido para perfis com acesso a dados sensíveis',
            'Rotação automatizada de segredos críticos com ledger encadeado (hash chain SHA-256)',
          ]}
        />
        <P>
          Em caso de incidente de segurança que represente risco ou dano relevante aos titulares,
          notificaremos a ANPD e os titulares afetados em até <strong>72 horas</strong> após a
          ciência do incidente, conforme Art. 48 da LGPD.
        </P>
      </Section>

      {/* 8 */}
      <Section title="8. Direitos do Titular de Dados">
        <P>
          Nos termos dos Arts. 17 a 22 da LGPD, você tem os seguintes direitos em relação aos seus
          dados pessoais tratados pela Clinipharma:
        </P>
        <UL
          items={[
            'Confirmação da existência de tratamento (Art. 18, I)',
            'Acesso — obter cópia dos dados que mantemos sobre você (Art. 18, II)',
            'Correção de dados incompletos, inexatos ou desatualizados (Art. 18, III)',
            'Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade (Art. 18, IV)',
            'Portabilidade dos dados a outro fornecedor de serviço, em formato estruturado e interoperável (Art. 18, V)',
            'Eliminação dos dados tratados com base em consentimento, ressalvadas as hipóteses do Art. 16 (Art. 18, VI)',
            'Informação sobre as entidades públicas e privadas com as quais o controlador realizou uso compartilhado (Art. 18, VII)',
            'Informação sobre a possibilidade de não fornecer consentimento e suas consequências (Art. 18, VIII)',
            'Revogação do consentimento, quando o tratamento for baseado nesta hipótese (Art. 18, IX)',
            'Oposição ao tratamento realizado com fundamento em uma das hipóteses de dispensa de consentimento, em caso de descumprimento da LGPD (Art. 18, §2º)',
            'Revisão de decisões automatizadas que afetem seus interesses (Art. 20, caput)',
            'Informação clara e adequada sobre os critérios e procedimentos utilizados para a decisão automatizada (Art. 20, §1º)',
          ]}
        />
        <Highlight>
          Para exercer qualquer desses direitos, acesse o <strong>Portal LGPD</strong> disponível em
          sua conta (menu → Privacidade) ou envie e-mail para{' '}
          <strong>privacidade@clinipharma.com.br</strong>. Responderemos em até{' '}
          <strong>15 dias corridos</strong>.
        </Highlight>
      </Section>

      {/* 9 */}
      <Section title="9. Cookies e Rastreamento">
        <P>
          Utilizamos apenas cookies <strong>estritamente necessários</strong> ao funcionamento da
          plataforma (sessão, segurança CSRF, preferências de idioma). Não utilizamos cookies de
          rastreamento publicitário, pixels de terceiros ou ferramentas de analytics comportamental.
        </P>
        <UL
          items={[
            'sb-access-token / sb-refresh-token — autenticação Supabase (sessão, HttpOnly, Secure, SameSite=Lax)',
            '__vercel_toolbar — apenas em ambiente de desenvolvimento (não enviado à produção)',
          ]}
        />
      </Section>

      {/* 10 */}
      <Section title="10. Crianças e Adolescentes (LGPD Art. 14)">
        <P>
          A Clinipharma é uma plataforma exclusivamente <strong>B2B</strong>, destinada a pessoas
          jurídicas e profissionais de saúde devidamente habilitados.{' '}
          <strong>
            Não coletamos dados de crianças (menores de 12 anos) ou de adolescentes (12 a 18 anos
            incompletos) de forma direta.
          </strong>
        </P>
        <P>
          Eventualmente, dados de crianças ou adolescentes podem constar de receitas médicas
          inseridas pelas clínicas parceiras. Nesses casos:
        </P>
        <UL
          items={[
            'Para crianças (até 12 anos incompletos), o tratamento ocorre com consentimento específico e em destaque do pai, da mãe ou do responsável legal, obtido pela clínica controladora originária, conforme Art. 14, §1º, LGPD;',
            'Para adolescentes (12 a 18 anos incompletos), o tratamento observa o princípio do melhor interesse e o regime previsto na Resolução CD/ANPD nº 4/2023;',
            'Em ambos os casos, aplicam-se as bases legais do Art. 11, II, "a" (obrigação legal — ANVISA) e "g" (tutela da saúde) e as salvaguardas reforçadas previstas nos DPAs com as clínicas.',
          ]}
        />
      </Section>

      {/* 10A */}
      <Section title="10A. Pacientes (não-usuários da plataforma)">
        <P>
          Pacientes cujos dados constam em receitas médicas inseridas pelas clínicas{' '}
          <strong>não possuem relação contratual direta com a Clinipharma</strong>. A clínica que
          atendeu o paciente é a <strong>controladora originária</strong> e o ponto de contato
          primário para exercício de direitos. A Clinipharma atua como{' '}
          <strong>cocontroladora</strong> apenas para os fins estritamente necessários à
          intermediação tecnológica entre clínica e farmácia.
        </P>
        <Sub title="Direitos do paciente">
          <P>
            Mesmo sem relação contratual direta, o paciente pode exercer{' '}
            <strong>todos os direitos previstos no art. 18 da LGPD</strong> (confirmação, acesso,
            correção, anonimização, eliminação, portabilidade, informação sobre compartilhamento,
            revogação de consentimento e oposição) por dois caminhos:
          </P>
          <UL
            items={[
              'Canal primário (recomendado): contatar a clínica que originou o atendimento, indicada na receita ou no documento de origem.',
              'Canal direto à Clinipharma: privacidade@clinipharma.com.br ou dpo@clinipharma.com.br — encaminharemos à clínica controladora e cooperaremos para resposta em até 15 dias corridos (LGPD art. 19, II).',
              'Canal de denúncia: titulares também podem peticionar diretamente à ANPD (gov.br/anpd) caso entendam que seus direitos não foram atendidos.',
            ]}
          />
        </Sub>
        <Sub title="Como identificar a clínica controladora">
          <P>
            Caso o paciente não disponha do contato direto da clínica, basta nos enviar dados
            mínimos (nome, e-mail e, se possível, data aproximada da prescrição); identificaremos a
            clínica controladora e faremos a ponte, sem expor dados sensíveis adicionais a
            terceiros.
          </P>
        </Sub>
        <Sub title="Decisões automatizadas">
          <P>
            O paciente tem direito a <strong>revisão humana</strong> de decisões automatizadas que o
            afetem (LGPD art. 20), inclusive nas hipóteses em que a Clinipharma utilize OCR/IA no
            tratamento de receitas — caso disponível e ativado pela clínica.
          </P>
        </Sub>
      </Section>

      {/* 10B */}
      <Section title="10B. Dados Anonimizados (LGPD Art. 12)">
        <P>
          Conforme o Art. 12 da LGPD, dados anonimizados não são considerados dados pessoais.
          Podemos produzir e utilizar <strong>datasets agregados e anonimizados</strong> derivados
          dos dados que tratamos, exclusivamente para finalidades de:
        </P>
        <UL
          items={[
            'Melhoria contínua dos produtos e da experiência do usuário',
            'Pesquisa estatística agregada e benchmark de mercado (sem reidentificação)',
            'Treinamento e validação de modelos internos de prevenção a fraude e segurança',
            'Publicação de relatórios de transparência e relatórios setoriais agregados',
          ]}
        />
        <P>
          Os datasets anonimizados <strong>não podem ser revertidos</strong> para identificação dos
          titulares. Caso a anonimização seja revertida ou se demonstrar reversível, o conjunto
          retorna ao regime de dados pessoais e às regras desta Política. O titular pode solicitar
          informações sobre a metodologia de anonimização adotada nos termos do Art. 12, §3º, LGPD.
        </P>
      </Section>

      {/* 11 */}
      <Section title="11. Alterações a Esta Política">
        <P>
          Podemos atualizar esta Política periodicamente para refletir mudanças legais, regulatórias
          ou operacionais. Alterações substanciais serão comunicadas com antecedência mínima de{' '}
          <strong>30 dias</strong> por e-mail e notificação na plataforma. A data de vigência
          constará sempre no cabeçalho deste documento.
        </P>
        <P>
          O uso continuado da plataforma após a entrada em vigor das alterações implica concordância
          com a nova versão. Caso discorde, você pode solicitar o encerramento de sua conta.
        </P>
      </Section>

      {/* 12 */}
      <Section title="12. Contato e DPO">
        <UL
          items={[
            'DPO (Encarregado de Proteção de Dados): privacidade@clinipharma.com.br',
            'Suporte geral: suporte@clinipharma.com.br',
            'Autoridade Nacional de Proteção de Dados (ANPD): www.gov.br/anpd',
          ]}
        />
        <P>
          Se não estiver satisfeito com nossa resposta, você tem o direito de peticionar à{' '}
          <strong>ANPD</strong> (Autoridade Nacional de Proteção de Dados) conforme Art. 18, §1º da
          LGPD.
        </P>
      </Section>

      <div className="mt-8 border-t pt-6 text-xs text-slate-600">
        <p>
          Clinipharma — Política de Privacidade v1.2 · Vigência original: 08/04/2026 · Última
          atualização: 17/04/2026 (M-06: ampliação da seção de pacientes não-usuários).
        </p>
        <p className="mt-2">
          <strong>Referências normativas:</strong> LGPD (Lei nº 13.709/2018), Resolução CD/ANPD nº
          2/2022 (RIPD e RAT), Resolução CD/ANPD nº 4/2023 (sanções), Marco Civil da Internet (Lei
          nº 12.965/2014), Lei nº 14.063/2020 (assinaturas eletrônicas), MP 2.200-2/2001
          (ICP-Brasil), RDC ANVISA nº 67/2007, RDC ANVISA nº 20/2011, RDC ANVISA nº 204/2017,
          Portaria SVS/MS nº 344/1998, Resolução CFM nº 1.821/2007, Código Civil (Lei nº
          10.406/2002), Código de Defesa do Consumidor (Lei nº 8.078/1990, em hipóteses
          subsidiárias), Lei nº 9.613/1998 (PLD), Estatuto da Criança e do Adolescente (Lei nº
          8.069/1990).
        </p>
        <p className="mt-2">
          <strong>Histórico:</strong> v1.1 (17/04/2026) — correção das bases legais do Art. 7º LGPD;
          correção da citação do Art. 11, II, &ldquo;g&rdquo; (tutela da saúde); alinhamento da
          lista de operadores com os DPAs vigentes (substituição de Twilio por Zenvia; inclusão de
          Cloudflare, OpenAI, Sentry, Inngest, Firebase, Asaas e Nuvem Fiscal); senha mínima de 12
          caracteres; inclusão do direito completo do Art. 20 LGPD (revisão e explicação de
          critérios); seção específica para crianças e adolescentes (Art. 14); seção específica para
          pacientes (não-titulares contratuais); seção sobre dados anonimizados (Art. 12).
        </p>
      </div>
    </LegalLayout>
  )
}
