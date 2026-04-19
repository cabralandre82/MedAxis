import { Metadata } from 'next'
import Link from 'next/link'
import { LegalLayout, Section, Sub, P, UL, Highlight } from '@/components/legal/legal-layout'

export const metadata: Metadata = {
  title: 'Encarregado de Proteção de Dados (DPO) — Clinipharma',
  description:
    'Carta de nomeação do Encarregado pelo Tratamento de Dados Pessoais da Clinipharma, nos termos do art. 41 da LGPD.',
  alternates: { canonical: '/dpo' },
}

export default function DpoPage() {
  return (
    <LegalLayout
      title="Encarregado de Proteção de Dados (DPO)"
      version="1.0"
      effectiveDate="17 de abril de 2026"
      updatedDate="17 de abril de 2026"
    >
      <Highlight>
        Esta página formaliza a nomeação do Encarregado pelo Tratamento de Dados Pessoais da
        Clinipharma, em cumprimento ao art. 41 da Lei nº 13.709/2018 (LGPD) e à Resolução CD/ANPD nº
        18/2024 (Encarregado).
      </Highlight>

      <Section title="1. Identificação do Encarregado">
        <P>
          Em conformidade com o disposto no art. 41 da LGPD e na Resolução CD/ANPD nº 18/2024, a
          Clinipharma designou pessoa natural como seu Encarregado pelo Tratamento de Dados Pessoais
          (Data Protection Officer / DPO), responsável por aceitar as comunicações dos titulares e
          da Autoridade Nacional de Proteção de Dados (ANPD), orientar funcionários e contratados
          sobre as práticas a serem tomadas em relação à proteção de dados, e executar as demais
          atribuições previstas em norma legal ou regulamentar.
        </P>
        <P>
          <strong>Nome:</strong> [a ser preenchido pela diretoria — ver nota ao final]
          <br />
          <strong>Função na empresa:</strong> Encarregado pelo Tratamento de Dados Pessoais (DPO)
          <br />
          <strong>Vínculo:</strong> empregado / prestador de serviços com cláusula de independência
          funcional
          <br />
          <strong>Data da designação:</strong> 17 de abril de 2026
        </P>
      </Section>

      <Section title="2. Canais de contato com o Encarregado">
        <P>
          O Encarregado pode ser contatado pelos canais abaixo, em conformidade com o art. 41, §1º,
          da LGPD (publicidade clara e objetiva no sítio eletrônico do controlador):
        </P>
        <UL
          items={[
            'E-mail dedicado: dpo@clinipharma.com.br (resposta em até 5 dias úteis)',
            'E-mail alternativo: privacidade@clinipharma.com.br',
            'Endereço postal: aos cuidados do Encarregado de Dados — Clinipharma, Brasília-DF',
            'Formulário on-line para exercício de direitos: /privacy#solicitacao (em construção)',
          ]}
        />
        <Highlight>
          <strong>Importante:</strong> os contatos acima destinam-se exclusivamente a (i) exercício
          de direitos por titulares (art. 18 e art. 20 LGPD), (ii) notificação de incidentes ou
          suspeitas de incidente, (iii) comunicação oficial da ANPD ou outra autoridade.
          Solicitações comerciais devem ser endereçadas a contato@clinipharma.com.br.
        </Highlight>
      </Section>

      <Section title="3. Atribuições do Encarregado (LGPD, art. 41, §2º)">
        <UL
          items={[
            'Receber e responder comunicações dos titulares de dados, prestando os esclarecimentos cabíveis e adotando as providências em até 15 dias corridos, prorrogáveis por igual período mediante justificativa (art. 19, II, LGPD).',
            'Receber comunicações da ANPD e adotar providências em até 5 dias úteis quando se tratar de notificação de incidente ou requerimento formal.',
            'Orientar funcionários e contratados da Clinipharma sobre as práticas a serem tomadas em relação à proteção de dados.',
            'Executar as demais atribuições determinadas pelo controlador ou estabelecidas em normas complementares da ANPD.',
            'Coordenar a manutenção do Registro de Atividades de Tratamento (RAT, art. 37 LGPD) e dos Relatórios de Impacto à Proteção de Dados Pessoais (RIPD, art. 38 LGPD).',
            'Coordenar a resposta a incidentes de segurança envolvendo dados pessoais, incluindo a notificação à ANPD em até 3 dias úteis (Resolução CD/ANPD nº 15/2024) e a comunicação aos titulares afetados em prazo razoável.',
          ]}
        />
      </Section>

      <Section title="4. Independência funcional">
        <P>
          Em alinhamento ao art. 41, §3º da LGPD e às boas práticas internacionais (GDPR art. 38), o
          Encarregado:
        </P>
        <UL
          items={[
            'Atua com independência funcional, reportando-se diretamente ao mais alto nível decisório da Clinipharma (Diretoria Executiva).',
            'Não pode ser punido por decisões legítimas tomadas no exercício de suas atribuições, observado o art. 41, §3º, LGPD.',
            'Não acumula funções que possam gerar conflito de interesses (compliance, jurídico, segurança da informação podem ser auxiliares, nunca subordinantes).',
            'Tem acesso irrestrito aos sistemas, processos e documentos da empresa para o exercício de suas atribuições.',
            'Recebe orçamento próprio anual para treinamento, certificação e ferramentas.',
          ]}
        />
      </Section>

      <Section title="5. Como exercer seus direitos">
        <P>
          Os titulares de dados pessoais (pacientes, médicos, profissionais de farmácia, usuários
          B2B em geral) podem exercer todos os direitos previstos no art. 18 da LGPD, conforme
          detalhado em nossa{' '}
          <a href="/privacy" className="text-blue-700 underline hover:text-blue-900">
            Política de Privacidade
          </a>
          .
        </P>
        <Sub title="5.1. Direitos garantidos (LGPD, art. 18)">
          <UL
            items={[
              'Confirmação da existência de tratamento.',
              'Acesso aos dados.',
              'Correção de dados incompletos, inexatos ou desatualizados.',
              'Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade.',
              'Portabilidade dos dados a outro fornecedor de serviço ou produto, mediante requisição expressa.',
              'Eliminação dos dados pessoais tratados com o consentimento do titular, exceto nas hipóteses do art. 16, LGPD.',
              'Informação das entidades públicas e privadas com as quais o controlador realizou uso compartilhado de dados.',
              'Informação sobre a possibilidade de não fornecer consentimento e sobre as consequências da negativa.',
              'Revogação do consentimento, nos termos do § 5º do art. 8º da LGPD.',
              'Oposição a tratamento realizado com fundamento em uma das hipóteses de dispensa de consentimento, em caso de descumprimento da LGPD.',
            ]}
          />
        </Sub>
        <Sub title="5.2. Direitos sobre decisões automatizadas (LGPD, art. 20)">
          <UL
            items={[
              'Solicitar revisão humana de decisões tomadas unicamente com base em tratamento automatizado de dados pessoais que afetem seus interesses.',
              'Obter informações claras e adequadas a respeito dos critérios e dos procedimentos utilizados para a decisão automatizada, observados os segredos comercial e industrial (art. 20, §1º).',
            ]}
          />
        </Sub>
        <Sub title="5.3. Prazo de resposta">
          <P>
            A Clinipharma compromete-se a responder a qualquer solicitação do titular em até{' '}
            <strong>15 (quinze) dias corridos</strong>, prorrogáveis por igual período mediante
            justificativa formal, conforme art. 19, II, LGPD. Em caso de impossibilidade de
            atendimento (ex.: dado já anonimizado, dado retido por obrigação legal), responderemos
            justificadamente.
          </P>
        </Sub>
      </Section>

      <Section title="6. Como reportar um incidente">
        <P>
          Suspeita de incidente de segurança envolvendo dados pessoais (vazamento, acesso não
          autorizado, alteração indevida, indisponibilidade) deve ser reportada imediatamente:
        </P>
        <UL
          items={[
            'Por e-mail: incidentes@clinipharma.com.br (canal monitorado 24/7).',
            'Aos cuidados do DPO: dpo@clinipharma.com.br.',
            'Por telefone (em horário comercial): central de atendimento.',
          ]}
        />
        <Highlight>
          <strong>Resposta:</strong> a Clinipharma confirma o recebimento em até 4 horas e inicia o
          procedimento previsto em sua Política de Resposta a Incidentes (PRI). A ANPD será
          notificada em até 3 dias úteis quando o incidente puder acarretar risco ou dano relevante
          aos titulares (Resolução CD/ANPD nº 15/2024).
        </Highlight>
      </Section>

      <Section title="7. Substituição e continuidade">
        <P>
          Em caso de afastamento temporário ou definitivo do Encarregado, a Clinipharma designará
          imediatamente um substituto e atualizará esta página em até 30 (trinta) dias, mantendo os
          canais de contato sempre operacionais.
        </P>
      </Section>

      <Section title="8. Documentos publicados pelo Encarregado">
        <P>
          O DPO mantém a seguinte documentação pública e atualizada, em cumprimento ao princípio da
          transparência (LGPD art. 6º, VI) e à Resolução CD/ANPD nº 2/2022:
        </P>
        <ul className="mt-2 ml-4 space-y-2 text-slate-700">
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>
              <Link href="/legal/ripd-2026-04" className="font-medium text-blue-700 underline">
                RIPD Global 2026-04
              </Link>{' '}
              — Relatório de Impacto à Proteção de Dados (DPIA) global da Plataforma, versão
              executiva.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>
              <Link href="/legal/retention" className="font-medium text-blue-700 underline">
                Política de Retenção e Eliminação de Dados
              </Link>{' '}
              — 23 categorias de dado mapeadas, prazos, base legal e mecanismos de enforcement.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>
              <Link href="/trust" className="font-medium text-blue-700 underline">
                Trust Center
              </Link>{' '}
              — controles de segurança, sub-processadores ativos e estado de conformidade.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>
              <Link href="/privacy" className="font-medium text-blue-700 underline">
                Política de Privacidade
              </Link>{' '}
              e{' '}
              <Link href="/terms" className="font-medium text-blue-700 underline">
                Termos de Uso
              </Link>{' '}
              — base normativa do tratamento de dados pessoais.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>
              <Link href="/status" className="font-medium text-blue-700 underline">
                Status de serviços
              </Link>{' '}
              — disponibilidade em tempo real e histórico de incidentes.
            </span>
          </li>
        </ul>
        <Highlight>
          Os seguintes documentos são <strong>internos</strong>, mas disponibilizados à ANPD e a
          parceiros mediante requerimento fundamentado: RIPD-001 (Receitas Médicas), DPA Clínicas,
          DPA Farmácias, Parecer Jurídico Sênior 2026-04, Self-Audit de Segurança e Runbook do DR
          Drill 2026-04.
        </Highlight>
      </Section>

      <Highlight>
        <strong>Nota interna (a remover antes da publicação definitiva):</strong> esta página foi
        gerada com base no parecer jurídico v1.0 (17/04/2026). O nome do DPO designado deve ser
        preenchido pela Diretoria Executiva. A carta de nomeação física deve ser arquivada no livro
        de atas e o original digitalizado deve ser anexado à pasta legal. A publicação definitiva
        dispensa este aviso.
      </Highlight>

      <div className="mt-8 border-t pt-4 text-xs text-slate-500">
        <p>
          <strong>Versão:</strong> 1.0 (17/04/2026)
        </p>
        <p className="mt-1">
          <strong>Base normativa:</strong> Lei nº 13.709/2018 (LGPD), arts. 41 e 50; Resolução
          CD/ANPD nº 18/2024 (Encarregado); Resolução CD/ANPD nº 15/2024 (Comunicação de
          incidentes).
        </p>
      </div>
    </LegalLayout>
  )
}
