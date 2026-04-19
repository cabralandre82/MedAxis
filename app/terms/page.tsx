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
  title: 'Termos de Uso | Clinipharma',
  robots: 'index, follow',
}

export default function TermsPage() {
  return (
    <LegalLayout
      title="Termos de Uso"
      version="1.1"
      effectiveDate="08 de abril de 2026"
      updatedDate="17 de abril de 2026"
    >
      <Highlight>
        Leia este documento com atenção. Ao acessar ou utilizar a Clinipharma, você declara ter
        capacidade legal plena, representar uma pessoa jurídica regularmente constituída, e
        concordar integralmente com estes Termos de Uso. Se não concordar, não utilize a plataforma.
      </Highlight>

      {/* 1 */}
      <Section title="1. Partes e Objeto">
        <Sub title="1.1 Partes">
          <P>
            <strong>Clinipharma</strong> (&ldquo;Plataforma&rdquo;, &ldquo;nós&rdquo;) é uma solução
            de software B2B que intermedeia relações comerciais entre clínicas médicas, médicos
            prescritores e farmácias de manipulação, operada por pessoa jurídica constituída sob as
            leis da República Federativa do Brasil.
          </P>
          <P>
            <strong>Usuário</strong> (&ldquo;você&rdquo;, &ldquo;Contratante&rdquo;) é a pessoa
            jurídica ou o profissional de saúde habilitado que acessa a plataforma mediante cadastro
            aprovado.
          </P>
        </Sub>

        <Sub title="1.2 Objeto">
          <P>Estes Termos regem o acesso e uso da plataforma Clinipharma, compreendendo:</P>
          <UL
            items={[
              'Gestão de pedidos de medicamentos manipulados entre clínicas/médicos e farmácias',
              'Intermediação comercial e financeira entre as partes',
              'Emissão e gestão de contratos digitais',
              'Painel administrativo para gestão de usuários, produtos, pedidos e relatórios',
              'Sistema de suporte e comunicação entre as partes',
            ]}
          />
        </Sub>
      </Section>

      {/* 2 */}
      <Section title="2. Elegibilidade e Cadastro">
        <Sub title="2.1 Requisitos de elegibilidade">
          <P>Para utilizar a Clinipharma, você deve:</P>
          <UL
            items={[
              'Ser maior de 18 anos e possuir capacidade civil plena',
              'Representar legalmente a pessoa jurídica cadastrada',
              'Para farmácias: possuir Autorização de Funcionamento (AFE/AE) válida emitida pela ANVISA, responsável técnico farmacêutico inscrito no CRF e alvará sanitário vigente',
              'Para clínicas: possuir CNES (Cadastro Nacional de Estabelecimentos de Saúde) ativo',
              'Para médicos: possuir CRM ativo e em situação regular no conselho regional competente',
              'Não estar impedido por decisão judicial, administrativa ou regulatória de exercer atividade na área da saúde',
            ]}
          />
        </Sub>

        <Sub title="2.2 Processo de cadastro">
          <P>
            O cadastro está sujeito à aprovação pela Clinipharma, que pode solicitar documentação
            comprobatória e realizar verificações de CNPJ junto à Receita Federal. A aprovação não
            cria qualquer obrigação de manutenção do acesso e pode ser revogada a qualquer momento
            mediante justa causa.
          </P>
        </Sub>

        <Sub title="2.3 Responsabilidade pelas credenciais">
          <P>
            Você é integralmente responsável pela confidencialidade de suas credenciais de acesso
            (e-mail e senha). Toda atividade realizada sob sua conta é de sua responsabilidade
            exclusiva. Em caso de acesso não autorizado, notifique imediatamente{' '}
            <strong>suporte@clinipharma.com.br</strong>.
          </P>
        </Sub>
      </Section>

      {/* 3 */}
      <Section title="3. Natureza da Intermediação">
        <Warning>
          <strong>Cláusula essencial.</strong> A Clinipharma atua exclusivamente como{' '}
          <strong>intermediadora tecnológica</strong>. Não é parte nos contratos de compra e venda
          de medicamentos, não é fabricante, distribuidora, importadora ou responsável técnica por
          qualquer produto negociado. A responsabilidade pela conformidade dos produtos com as
          normas ANVISA, pelo cumprimento das Boas Práticas de Manipulação (BPM — RDC nº 67/2007 e
          atualizações) e pela prestação dos serviços de saúde é exclusivamente das farmácias e
          profissionais de saúde cadastrados.
        </Warning>
        <P>
          As farmácias cadastradas respondem individualmente perante a ANVISA, o CRF, a Vigilância
          Sanitária estadual/municipal e seus clientes pela qualidade, segurança e eficácia dos
          produtos manipulados, bem como pelo cumprimento das normas de rastreabilidade e
          dispensação.
        </P>
      </Section>

      {/* 4 */}
      <Section title="4. Obrigações do Usuário">
        <Sub title="4.1 Obrigações gerais">
          <UL
            items={[
              'Manter seus dados cadastrais sempre atualizados e verídicos',
              'Utilizar a plataforma exclusivamente para os fins previstos nestes Termos',
              'Cumprir toda a legislação aplicável, incluindo normas do CFF, ANVISA, Receita Federal e LGPD',
              'Não ceder, sublicenciar ou transferir seu acesso a terceiros',
              'Notificar imediatamente qualquer suspeita de violação de segurança',
              'Manter os documentos regulatórios (AFE, CRM, CNES, CRF) válidos durante toda a vigência do acesso',
            ]}
          />
        </Sub>

        <Sub title="4.2 Obrigações específicas — Farmácias">
          <UL
            items={[
              'Manter AFE/AE válida durante toda a vigência do acesso',
              'Designar responsável técnico farmacêutico para todos os pedidos',
              'Assinar digitalmente as Ordens de Manipulação (OM) antes da dispensação',
              'Manter rastreabilidade de insumos e produtos acabados conforme RDC ANVISA vigente',
              'Não aceitar pedidos que violem a legislação de prescrição ou dispensação',
              'Cumprir os prazos de entrega acordados com os clientes',
            ]}
          />
        </Sub>

        <Sub title="4.3 Obrigações específicas — Médicos/Clínicas">
          <UL
            items={[
              'Realizar apenas prescrições dentro da área de especialidade habilitada',
              'Não utilizar a plataforma para intermediação de produtos sem prescrição médica válida',
              'Manter sigilo médico nos termos do CFM e do CDC',
              'Verificar a adequação da farmácia para a manipulação dos produtos prescritos',
            ]}
          />
        </Sub>
      </Section>

      {/* 5 */}
      <Section title="5. Uso Proibido">
        <P>
          É expressamente vedado ao Usuário, sob pena de rescisão imediata e responsabilidade civil
          e criminal:
        </P>
        <UL
          items={[
            'Utilizar a plataforma para intermediar produtos controlados sem as devidas autorizações ANVISA/Polícia Federal',
            'Cadastrar produtos ou serviços que não possuam registro ou notificação ANVISA, quando exigidos',
            'Forjar, alterar ou falsificar documentos enviados à plataforma',
            'Realizar engenharia reversa, decompilação ou tentativas de acesso não autorizado',
            'Utilizar bots, scrapers ou qualquer meio automatizado não previamente autorizado',
            'Praticar qualquer ato que configure lavagem de dinheiro, corrupção ou fraude',
            'Divulgar dados pessoais de pacientes ou clientes a terceiros não autorizados',
            'Utilizar a plataforma para fins de propaganda enganosa de medicamentos (Lei nº 9.294/1996)',
            'Disseminar malware, vírus ou qualquer código malicioso',
          ]}
        />
      </Section>

      {/* 6 */}
      <Section title="6. Pagamentos, Comissões e Repasses">
        <Sub title="6.1 Processamento de pagamentos">
          <P>
            Pagamentos realizados na plataforma são processados pelo{' '}
            <strong>Asaas Pagamentos S.A.</strong> (CNPJ: 19.540.550/0001-21), instituição de
            pagamento autorizada pelo Banco Central do Brasil. A Clinipharma não armazena dados de
            cartão de crédito em seus servidores.
          </P>
        </Sub>

        <Sub title="6.2 Comissões de consultores">
          <P>
            Quando aplicável, as comissões sobre vendas intermediadas por consultores cadastrados
            são calculadas automaticamente pela plataforma conforme tabela configurada pelo
            administrador, e repassadas mediante confirmação de pagamento pelo cliente final.
          </P>
        </Sub>

        <Sub title="6.3 Contestações">
          <P>
            Contestações sobre cobranças devem ser comunicadas em até{' '}
            <strong>30 dias corridos</strong> da data da transação, via sistema de suporte ou e-mail
            financeiro@clinipharma.com.br. Após esse prazo, as cobranças são consideradas
            tacitamente aceitas.
          </P>
        </Sub>

        <Sub title="6.4 Inadimplência">
          <P>
            O inadimplemento de obrigações financeiras pode acarretar a suspensão do acesso até
            regularização, sem prejuízo da cobrança de multa de 2% e juros de 1% ao mês, além de
            atualização monetária pelo IPCA.
          </P>
        </Sub>
      </Section>

      {/* 7 */}
      <Section title="7. Propriedade Intelectual">
        <P>
          Todo o conteúdo da plataforma — incluindo código-fonte, design, marcas, logotipos, textos,
          imagens, fluxos de trabalho e modelos de documentos — é de propriedade exclusiva da
          Clinipharma ou de seus licenciantes, protegido pela Lei nº 9.610/1998 (Direitos Autorais)
          e pela Lei nº 9.279/1996 (Propriedade Industrial).
        </P>
        <P>
          É concedida ao Usuário uma{' '}
          <strong>licença limitada, não exclusiva, intransferível e revogável</strong> para utilizar
          a plataforma exclusivamente para os fins previstos nestes Termos. Nenhum direito adicional
          é concedido por implicação ou outro meio.
        </P>
        <P>
          Dados e conteúdos inseridos pelo Usuário na plataforma permanecem de sua propriedade, mas
          o Usuário concede à Clinipharma uma licença não exclusiva para armazená-los, processá-los
          e transmiti-los na medida necessária à prestação dos serviços.
        </P>
      </Section>

      {/* 8 */}
      <Section title="8. Disponibilidade e Manutenção">
        <P>
          A Clinipharma envidará seus melhores esforços para manter a plataforma disponível{' '}
          <strong>24/7</strong>, mas não garante disponibilidade ininterrupta. Manutenções
          programadas serão comunicadas com antecedência mínima de <strong>24 horas</strong> via
          e-mail e notificação na plataforma. Manutenções emergenciais podem ocorrer sem aviso
          prévio.
        </P>
        <P>
          Nosso objetivo de disponibilidade (SLO) é de <strong>99,5% ao mês</strong>, excluindo
          janelas de manutenção programada.
        </P>
      </Section>

      {/* 9 */}
      <Section title="9. Limitação de Responsabilidade">
        <Warning>
          <strong>Leia com atenção.</strong> Na máxima extensão permitida pela legislação
          brasileira:
        </Warning>
        <UL
          items={[
            'A Clinipharma não se responsabiliza por danos decorrentes da qualidade ou segurança dos produtos manipulados pelas farmácias cadastradas',
            'Não garantimos que a plataforma estará livre de erros, interrupções ou perda de dados em qualquer momento',
            'Não nos responsabilizamos por decisões clínicas ou terapêuticas tomadas com base em informações da plataforma',
            'Não somos responsáveis por atos de terceiros (farmácias, médicos, clínicas, transportadoras) que causem danos a outras partes',
            'Nossa responsabilidade máxima perante qualquer Usuário, em qualquer hipótese, fica limitada ao valor pago pelo Usuário à Clinipharma nos 12 meses anteriores ao evento danoso',
          ]}
        />
        <P>
          Nada nesta cláusula exclui responsabilidade por dolo, fraude, morte ou dano corporal
          causado por nossa negligência, ou qualquer outra responsabilidade que não possa ser
          excluída pela legislação brasileira (Código de Defesa do Consumidor, quando aplicável).
        </P>
      </Section>

      {/* 10 */}
      <Section title="10. Indenização">
        <P>
          Você concorda em indenizar, defender e isentar a Clinipharma, seus sócios, diretores,
          funcionários e prestadores de serviço de quaisquer reclamações, danos, perdas, custos e
          despesas (incluindo honorários advocatícios razoáveis) decorrentes de:
        </P>
        <UL
          items={[
            'Violação por você destes Termos ou de qualquer legislação aplicável',
            'Uso indevido da plataforma por você ou por terceiros com suas credenciais',
            'Alegações de terceiros relacionadas a produtos ou serviços por você disponibilizados na plataforma',
            'Violação de direitos de propriedade intelectual ou privacidade de terceiros',
          ]}
        />
      </Section>

      {/* 11 */}
      <Section title="11. Vigência e Rescisão">
        <Sub title="11.1 Vigência">
          <P>
            Estes Termos vigoram por prazo indeterminado a partir da data de acesso à plataforma.
          </P>
        </Sub>

        <Sub title="11.2 Rescisão pelo Usuário">
          <P>
            Você pode encerrar sua conta a qualquer momento, sem custo, mediante solicitação ao
            suporte. O encerramento não isenta de obrigações financeiras pendentes.
          </P>
        </Sub>

        <Sub title="11.3 Rescisão pela Clinipharma">
          <P>
            Podemos suspender ou encerrar seu acesso, observado contraditório prévio quando cabível,
            nas seguintes hipóteses:
          </P>
          <UL
            items={[
              'Suspensão imediata, sem prévio aviso, em caso de: (i) cassação ou suspensão de licença regulatória por autoridade competente (AFE, CRM, CNES, CRF); (ii) determinação direta de autoridade competente (ANVISA, Vigilância Sanitária, Poder Judiciário, ANPD); (iii) conduta que coloque em risco iminente a segurança da plataforma, de outros usuários ou de pacientes; (iv) indícios concretos de fraude, falsificação documental ou crime contra a saúde pública',
              'Suspensão precedida de notificação com prazo de 10 (dez) dias úteis para regularização em caso de: (i) violação destes Termos ou da Política de Privacidade que admita correção; (ii) inadimplemento financeiro; (iii) expiração administrativa de licença regulatória sem cassação (período de renovação)',
              'Encerramento definitivo (rescisão) após reincidência ou descumprimento do prazo de regularização',
            ]}
          />
          <P>
            Em todas as hipóteses, será assegurado ao Usuário acesso aos seus próprios dados pelo
            prazo necessário ao cumprimento de obrigações legais regulatórias e ao exercício do
            contraditório, observada a Política de Privacidade.
          </P>
        </Sub>

        <Sub title="11.4 Efeitos da rescisão">
          <P>
            Com a rescisão, o acesso é imediatamente revogado. Dados serão retidos pelos prazos
            legais conforme Política de Privacidade, Seção 6. Pedidos em andamento serão tratados
            caso a caso.
          </P>
        </Sub>
      </Section>

      {/* 12 */}
      <Section title="12. Conformidade Regulatória Setorial">
        <P>
          A utilização da Clinipharma não substitui nem dispensa o cumprimento de quaisquer
          obrigações regulatórias específicas do setor de saúde, incluindo, sem limitação:
        </P>
        <UL
          items={[
            'RDC ANVISA nº 67/2007 — Boas Práticas de Manipulação de Preparações Magistrais e Oficinais',
            'RDC ANVISA nº 204/2017 — Regulamentação dos sistemas de controle e rastreabilidade de medicamentos',
            'Resolução CFM nº 1.931/2009 — Código de Ética Médica',
            'Resolução CFF nº 586/2013 — Prescrição Farmacêutica',
            'Lei nº 5.991/1973 — Controle Sanitário do Comércio de Drogas e Medicamentos',
            'Portaria SVS/MS nº 344/1998 — Substâncias e medicamentos sujeitos a controle especial',
            'Lei nº 13.709/2018 — LGPD (tratamento de dados de pacientes)',
          ]}
        />
      </Section>

      {/* 13 */}
      <Section title="13. Alterações aos Termos">
        <P>
          Reservamo-nos o direito de alterar estes Termos a qualquer momento. Alterações
          substanciais serão comunicadas com antecedência mínima de <strong>30 dias</strong> por
          e-mail e notificação na plataforma. O uso continuado após a entrada em vigor das
          alterações implica concordância com a nova versão.
        </P>
        <P>
          Versões anteriores dos Termos ficam arquivadas e disponíveis mediante solicitação ao
          suporte.
        </P>
      </Section>

      {/* 14 */}
      <Section title="14. Disposições Gerais">
        <Sub title="14.1 Legislação aplicável">
          <P>
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Aplicam-se
            subsidiariamente o Código Civil (Lei nº 10.406/2002) e, quando couber, o Código de
            Defesa do Consumidor (Lei nº 8.078/1990).
          </P>
        </Sub>

        <Sub title="14.2 Foro">
          <P>
            As partes elegem o{' '}
            <strong>Foro da Circunscrição Especial Judiciária de Brasília-DF</strong> para dirimir
            quaisquer controvérsias oriundas destes Termos, com renúncia expressa a qualquer outro,
            por mais privilegiado que seja, <strong>ressalvada</strong> (i) a competência da ANPD
            para apuração de infrações à LGPD; e (ii) o direito do Usuário hipossuficiente, quando
            aplicável o Código de Defesa do Consumidor, de propor a ação no foro de seu próprio
            domicílio (CDC, Art. 101, I; CPC, Art. 63, §3º).
          </P>
        </Sub>

        <Sub title="14.3 Assinatura eletrônica e validade jurídica">
          <P>
            Estes Termos vinculam o Usuário a partir do aceite eletrônico realizado no momento do
            cadastro ou do login (Lei nº 14.063/2020, Art. 4º — assinatura eletrônica simples) e,
            para os contratos específicos celebrados via Clicksign (DPAs, Contrato de Adesão,
            Contrato de Consultoria), por meio de assinatura eletrônica avançada nos termos do{' '}
            <strong>Art. 5º da Lei nº 14.063/2020</strong> e do Art. 10, §2º, da MP 2.200-2/2001.
          </P>
        </Sub>

        <Sub title="14.4 Independência das cláusulas">
          <P>
            Se qualquer disposição destes Termos for considerada inválida ou inaplicável, as demais
            disposições permanecerão em pleno vigor e efeito.
          </P>
        </Sub>

        <Sub title="14.5 Acordo integral">
          <P>
            Estes Termos, em conjunto com a Política de Privacidade e quaisquer adendos específicos
            celebrados entre as partes, constituem o acordo integral entre a Clinipharma e o
            Usuário, substituindo quaisquer entendimentos anteriores sobre o objeto aqui tratado.
          </P>
        </Sub>

        <Sub title="14.6 Renúncia">
          <P>
            A falha da Clinipharma em exigir o cumprimento de qualquer disposição destes Termos não
            constitui renúncia a esse direito para o futuro.
          </P>
        </Sub>

        <Sub title="14.7 Equilíbrio econômico-regulatório (hardship)">
          <P>
            Na hipótese de mudança regulatória superveniente (LGPD, ANPD, ANVISA, Receita Federal,
            CFM, CFF) que torne a execução destes Termos excessivamente onerosa para qualquer das
            partes, será assegurada a renegociação de boa-fé pelo prazo de até 60 (sessenta) dias.
            Não havendo consenso, poderá qualquer das partes resolver o vínculo sem ônus, observados
            os arts. 478 a 480 do Código Civil e o princípio da boa-fé objetiva (CC Art. 422).
          </P>
        </Sub>
      </Section>

      {/* 15 */}
      <Section title="15. Contato">
        <UL
          items={[
            'Suporte geral: suporte@clinipharma.com.br',
            'Questões jurídicas e contratos: juridico@clinipharma.com.br',
            'Questões financeiras: financeiro@clinipharma.com.br',
            'Privacidade e LGPD: privacidade@clinipharma.com.br',
          ]}
        />
      </Section>

      <div className="mt-8 border-t pt-6 text-xs text-slate-600">
        <p>
          Clinipharma — Termos de Uso v1.1 · Vigência original: 08/04/2026 · Última atualização:
          17/04/2026.
        </p>
        <p className="mt-2">
          <strong>Referências normativas:</strong> Código Civil (Lei nº 10.406/2002, em especial
          arts. 422-424, 478-480 e 402-403), Código de Processo Civil (Lei nº 13.105/2015, art. 63),
          CDC (Lei nº 8.078/1990, em hipóteses subsidiárias), LGPD (Lei nº 13.709/2018), Lei nº
          14.063/2020 (assinaturas eletrônicas), MP 2.200-2/2001 (ICP-Brasil), Marco Civil da
          Internet (Lei nº 12.965/2014), Lei nº 9.610/1998 (Direitos Autorais), Lei nº 9.279/1996
          (Propriedade Industrial), RDC ANVISA nº 67/2007, RDC ANVISA nº 20/2011, RDC ANVISA nº
          204/2017, Lei nº 5.991/1973, Portaria SVS/MS nº 344/1998, Resolução CFM nº 1.931/2009.
        </p>
        <p className="mt-2">
          <strong>Histórico:</strong> v1.1 (17/04/2026) — alinhamento de foro com a sede da
          Clinipharma (Brasília-DF) e ressalva ao foro do hipossuficiente; prazo de 10 dias úteis
          para regularização de pendências documentais antes de suspensão; citação expressa da Lei
          nº 14.063/2020 quanto à validade da assinatura eletrônica avançada via Clicksign; inclusão
          de cláusula de equilíbrio econômico-regulatório (hardship).
        </p>
      </div>
    </LegalLayout>
  )
}
