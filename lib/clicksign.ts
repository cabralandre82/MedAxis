import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { withCircuitBreaker } from '@/lib/circuit-breaker'

const BASE_URL = process.env.CLICKSIGN_API_URL ?? 'https://sandbox.clicksign.com/api/v1'
const ACCESS_TOKEN = process.env.CLICKSIGN_ACCESS_TOKEN ?? ''

async function clicksignFetchRaw<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}?access_token=${ACCESS_TOKEN}`
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Clicksign error ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function clicksignFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return withCircuitBreaker(() => clicksignFetchRaw<T>(path, options), { name: 'clicksign' })
}

// ── Document ──────────────────────────────────────────────────────────────────

interface ClicksignDocument {
  document: { key: string; filename: string; status: string }
}

/**
 * Upload a base64-encoded PDF to Clicksign.
 * Returns the document key.
 */
export async function uploadDocument(params: {
  filename: string
  base64Content: string
  deadline?: string // ISO date
}): Promise<string> {
  const result = await clicksignFetch<ClicksignDocument>('/documents', {
    method: 'POST',
    body: JSON.stringify({
      document: {
        path: `/${params.filename}`,
        content_base64: `data:application/pdf;base64,${params.base64Content}`,
        deadline_at: params.deadline,
        auto_close: true,
        locale: 'pt-BR',
        sequence_enabled: false,
      },
    }),
  })
  return result.document.key
}

// ── Signer ────────────────────────────────────────────────────────────────────

interface ClicksignSigner {
  signer: { key: string }
}

/** Add a signer to a document. Returns the signer key. */
export async function addSigner(params: {
  documentKey: string
  email: string
  name: string
  cpf?: string
  hasMobileApp?: boolean
  selfie?: boolean
}): Promise<string> {
  // Create signer
  const signerResult = await clicksignFetch<ClicksignSigner>('/signers', {
    method: 'POST',
    body: JSON.stringify({
      signer: {
        email: params.email,
        phone_number: '',
        auths: ['email'],
        name: params.name,
        documentation: params.cpf ?? '',
        birthday: '',
        has_documentation: !!params.cpf,
      },
    }),
  })

  const signerKey = signerResult.signer.key

  // Add to document
  await clicksignFetch<unknown>('/lists', {
    method: 'POST',
    body: JSON.stringify({
      list: {
        document_key: params.documentKey,
        signer_key: signerKey,
        sign_as: 'sign',
        refusable: false,
        message: 'Por favor, assine este contrato da Clinipharma.',
      },
    }),
  })

  return signerKey
}

// ── Notify signers ────────────────────────────────────────────────────────────

/** Send signing request emails to all signers of a document. */
export async function notifySigners(documentKey: string): Promise<void> {
  await clicksignFetch<unknown>(`/documents/${documentKey}/notifications`, {
    method: 'POST',
    body: JSON.stringify({ message: 'Seu contrato Clinipharma está pronto para assinatura.' }),
  })
}

// ── PDF generation ────────────────────────────────────────────────────────────

export type ContractType = 'CLINIC' | 'DOCTOR' | 'PHARMACY' | 'CONSULTANT'

interface ContractParty {
  name: string
  cpfCnpj?: string
  email?: string
}

// ── Company constants ─────────────────────────────────────────────────────────

const CLINIPHARMA = {
  razaoSocial: 'ALC INTERMEDIACAO E REPRESENTACAO LTDA',
  cnpj: '66.279.691/0001-12',
  endereco: 'SQS 212, Bloco K, apto 402, Asa Sul, Brasília-DF, CEP 70275-110',
  foro: 'Circunscrição Especial Judiciária de Brasília-DF',
  site: 'clinipharma.com.br',
}

// ── PDF layout helpers ────────────────────────────────────────────────────────

interface PageContext {
  doc: PDFDocument
  font: ReturnType<PDFDocument['embedFont']> extends Promise<infer F> ? F : never
  boldFont: ReturnType<PDFDocument['embedFont']> extends Promise<infer F> ? F : never
  pages: ReturnType<PDFDocument['addPage']>[]
  currentPage: ReturnType<PDFDocument['addPage']>
  y: number
  pageNum: number
}

async function createPageContext(doc: PDFDocument): Promise<PageContext> {
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([595, 842])
  return { doc, font, boldFont, pages: [page], currentPage: page, y: 800, pageNum: 1 }
}

function addNewPage(ctx: PageContext): void {
  const page = ctx.doc.addPage([595, 842])
  ctx.pages.push(page)
  ctx.currentPage = page
  ctx.y = 800
  ctx.pageNum++
}

function ensureSpace(ctx: PageContext, needed: number): void {
  if (ctx.y - needed < 60) addNewPage(ctx)
}

function drawText(
  ctx: PageContext,
  text: string,
  opts: {
    size?: number
    bold?: boolean
    color?: ReturnType<typeof rgb>
    x?: number
    indent?: number
  }
): void {
  const size = opts.size ?? 10
  const font = opts.bold ? ctx.boldFont : ctx.font
  const color = opts.color ?? rgb(0.15, 0.15, 0.15)
  const x = opts.x ?? opts.indent ?? 50
  ctx.currentPage.drawText(text, { x, y: ctx.y, font, size, color })
  ctx.y -= size + 5
}

function drawWrappedText(
  ctx: PageContext,
  text: string,
  opts: { size?: number; bold?: boolean; maxWidth?: number; indent?: number; lineSpacing?: number }
): void {
  const size = opts.size ?? 10
  const maxChars = opts.maxWidth ?? 88
  const indent = opts.indent ?? 50
  const lineH = size + (opts.lineSpacing ?? 5)
  const font = opts.bold ? ctx.boldFont : ctx.font

  const words = text.split(' ')
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (test.length > maxChars) {
      ensureSpace(ctx, lineH)
      ctx.currentPage.drawText(line, {
        x: indent,
        y: ctx.y,
        font,
        size,
        color: rgb(0.15, 0.15, 0.15),
      })
      ctx.y -= lineH
      line = word
    } else {
      line = test
    }
  }
  if (line) {
    ensureSpace(ctx, lineH)
    ctx.currentPage.drawText(line, {
      x: indent,
      y: ctx.y,
      font,
      size,
      color: rgb(0.15, 0.15, 0.15),
    })
    ctx.y -= lineH
  }
}

function drawHRule(ctx: PageContext, thickness = 0.5): void {
  ctx.currentPage.drawLine({
    start: { x: 50, y: ctx.y },
    end: { x: 545, y: ctx.y },
    thickness,
    color: rgb(0.8, 0.8, 0.8),
  })
  ctx.y -= 12
}

function drawSection(ctx: PageContext, title: string, body: string[]): void {
  ensureSpace(ctx, 40)
  ctx.y -= 6
  drawText(ctx, title, { bold: true, size: 10, color: rgb(0.07, 0.22, 0.37) })
  ctx.y -= 2
  for (const line of body) {
    if (line === '') {
      ctx.y -= 4
      continue
    }
    drawWrappedText(ctx, line, { indent: 50 })
  }
}

function drawPageNumbers(ctx: PageContext, total: number): void {
  const small = ctx.font
  for (let i = 0; i < ctx.pages.length; i++) {
    ctx.pages[i].drawText(`Página ${i + 1} de ${total}`, {
      x: 480,
      y: 30,
      font: small,
      size: 8,
      color: rgb(0.5, 0.5, 0.5),
    })
  }
}

// ── DPA PDF generation ────────────────────────────────────────────────────────

/**
 * Generate a complete Data Processing Agreement PDF for CLINIC or PHARMACY.
 * Returns base64-encoded PDF.
 */
export async function generateDpaPdf(params: {
  type: 'CLINIC' | 'PHARMACY'
  party: ContractParty
  date?: string
}): Promise<string> {
  const doc = await PDFDocument.create()
  const ctx = await createPageContext(doc)
  const { type, party } = params
  const date = params.date ?? new Date().toLocaleDateString('pt-BR')
  const dpaUrl =
    type === 'PHARMACY'
      ? `${CLINIPHARMA.site}/legal/dpa-farmacias`
      : `${CLINIPHARMA.site}/legal/dpa-clinicas`

  const title =
    type === 'PHARMACY'
      ? 'INSTRUMENTO DE ADESÃO AO ACORDO DE TRATAMENTO DE DADOS (DPA) — FARMÁCIA PARCEIRA'
      : 'INSTRUMENTO DE ADESÃO AO ACORDO DE TRATAMENTO DE DADOS (DPA) — CLÍNICA PARCEIRA'

  const partyRole =
    type === 'PHARMACY' ? 'OPERADOR / CONTROLADOR INDEPENDENTE' : 'CONTROLADOR CONJUNTO'

  // ── Cover ──────────────────────────────────────────────────────────────────
  ctx.currentPage.drawText('CLINIPHARMA', {
    x: 50,
    y: ctx.y,
    font: ctx.boldFont,
    size: 18,
    color: rgb(0.07, 0.22, 0.37),
  })
  ctx.y -= 26

  drawWrappedText(ctx, title, { bold: true, size: 12, maxWidth: 70 })
  ctx.y -= 6
  drawHRule(ctx, 1)
  ctx.y -= 4

  // Parties block
  drawText(ctx, 'PARTES', { bold: true, size: 10, color: rgb(0.07, 0.22, 0.37) })
  ctx.y -= 2

  drawText(ctx, `CONTROLADOR / PLATAFORMA:`, { bold: true, size: 9 })
  drawWrappedText(
    ctx,
    `${CLINIPHARMA.razaoSocial}, CNPJ ${CLINIPHARMA.cnpj}, com sede em ${CLINIPHARMA.endereco} ("Clinipharma").`,
    { indent: 50, size: 9 }
  )
  ctx.y -= 4

  drawText(ctx, `${partyRole}:`, { bold: true, size: 9 })
  const partyDesc = party.cpfCnpj
    ? `${party.name}, CNPJ/CPF ${party.cpfCnpj}${party.email ? `, e-mail ${party.email}` : ''} ("Parceiro").`
    : `${party.name}${party.email ? `, e-mail ${party.email}` : ''} ("Parceiro").`
  drawWrappedText(ctx, partyDesc, { indent: 50, size: 9 })
  ctx.y -= 8

  drawHRule(ctx)

  // ── Clause 1 – Object ──────────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 1 — OBJETO', [
    '1.1. O presente instrumento tem por objeto formalizar a adesão do Parceiro ao Acordo de Processamento de Dados (DPA) da Clinipharma, na versão vigente disponível em ' +
      dpaUrl +
      ', o qual regula o tratamento de dados pessoais realizados no âmbito da utilização da plataforma digital Clinipharma, nos termos da Lei 13.709/2018 (LGPD).',
    '',
    '1.2. O DPA incorporado é parte integrante e indissociável deste instrumento, tendo plena eficácia jurídica como se aqui transcrito estivesse.',
  ])

  // ── Clause 2 – Roles ──────────────────────────────────────────────────────
  if (type === 'CLINIC') {
    drawSection(ctx, 'CLÁUSULA 2 — QUALIFICAÇÃO DAS PARTES', [
      '2.1. A Clinipharma e a Clínica Parceira atuam como CONTROLADORAS CONJUNTAS (art. 65, I, LGPD) em relação aos dados pessoais de pacientes inseridos na plataforma para fins de intermediação de pedidos de medicamentos.',
      '',
      '2.2. A Clínica é a originadora dos dados do paciente (nome, data de nascimento, prescrição médica), sendo responsável por obter o consentimento livre, informado e inequívoco do paciente antes de inserir seus dados na plataforma.',
      '',
      '2.3. A Clinipharma processa esses dados para execução do contrato (art. 7º, V, LGPD) — intermediação, faturamento e logística — e para cumprimento de obrigações legais.',
    ])
  } else {
    drawSection(ctx, 'CLÁUSULA 2 — QUALIFICAÇÃO DAS PARTES', [
      '2.1. A Farmácia Parceira atua como OPERADORA (art. 5º, VII, LGPD) em relação aos dados pessoais de pacientes transmitidos pela Clinipharma para fins de processamento e entrega de pedidos.',
      '',
      '2.2. A Farmácia atua adicionalmente como CONTROLADORA INDEPENDENTE em relação aos dados que deve manter por imposição legal (ANVISA, Portaria SVS/MS 344/1998, RDC 20/2011), sem subordinação à Clinipharma para esses fins.',
      '',
      '2.3. A Farmácia somente tratará os dados pessoais dos pacientes nas finalidades estritamente necessárias para executar o pedido e cumprir obrigações regulatórias, sendo vedado qualquer uso secundário sem base legal autônoma.',
    ])
  }

  // ── Clause 3 – Data categories ────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 3 — CATEGORIAS DE DADOS TRATADOS', [
    '3.1. São tratados no âmbito desta parceria:',
    '  (a) DADOS COMUNS: nome, e-mail, telefone, endereço, CNPJ/CPF, dados de faturamento.',
    '  (b) DADOS DE SAÚDE (sensíveis — art. 11 LGPD): prescrições médicas, CRM do prescritor, medicamentos, posologia, diagnóstico implícito.',
    '',
    '3.2. O tratamento de dados de saúde baseia-se em:',
    '  • Tutela da saúde (art. 11, II, "f", LGPD) — para entrega do medicamento ao paciente.',
    '  • Cumprimento de obrigação legal (art. 11, II, "a") — para escrituração nos livros de dispensação exigidos pela ANVISA.',
    '',
    '3.3. Nenhum dado de saúde será utilizado para fins de marketing, profiling ou inteligência comercial sem base legal autônoma e específica.',
  ])

  // ── Clause 4 – Key obligations ────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 4 — OBRIGAÇÕES DO PARCEIRO', [
    '4.1. O Parceiro compromete-se a:',
    '  (i) Tratar os dados pessoais exclusivamente nas finalidades previstas neste instrumento e no DPA incorporado;',
    '  (ii) Implementar medidas técnicas e organizacionais adequadas (ABNT NBR ISO/IEC 27001) para proteger os dados contra acesso não autorizado, perda, alteração ou divulgação indevida;',
    '  (iii) Notificar a Clinipharma, em até 48 horas, sobre qualquer incidente de segurança que possa afetar dados pessoais tratados nesta parceria;',
    '  (iv) Não subcontratar o tratamento de dados a terceiros sem prévia autorização escrita da Clinipharma;',
    '  (v) Submeter-se a auditorias realizadas pela Clinipharma ou por auditores independentes, mediante aviso prévio de 5 dias úteis;',
    '  (vi) Ao término da parceria, destruir ou devolver, conforme solicitado, todos os dados pessoais, exceto quando a retenção for exigida por lei.',
  ])

  // ── Clause 5 – Security ───────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 5 — SEGURANÇA DA INFORMAÇÃO', [
    '5.1. A Clinipharma implementa os seguintes controles de segurança na plataforma:',
    '  • Criptografia AES-256-GCM em repouso; TLS 1.3 em trânsito.',
    '  • Autenticação JWT com refresh token rotation e revogação por evento.',
    '  • Row Level Security (RLS) no banco de dados — cada entidade acessa apenas seus dados.',
    '  • Rate limiting (100 req/min por IP) e circuit breaker em integrações externas.',
    '  • Logs de auditoria imutáveis com retenção de 5 anos.',
    '',
    '5.2. A IA da plataforma (OpenAI GPT-4o Vision) opera com zero data retention — dados de prescrições não são usados para treinar modelos.',
  ])

  // ── Clause 6 – Data subject rights ───────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 6 — DIREITOS DOS TITULARES', [
    '6.1. Os titulares de dados (pacientes, médicos) poderão exercer seus direitos previstos no art. 18 da LGPD (acesso, correção, portabilidade, eliminação, revogação) diretamente pela plataforma ou pelo e-mail privacidade@clinipharma.com.br.',
    '',
    '6.2. Ambas as partes cooperarão para atender solicitações de titulares no prazo de 15 dias corridos, conforme exigido pela ANPD.',
  ])

  // ── Clause 7 – Liability ──────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 7 — RESPONSABILIDADE E PENALIDADES', [
    '7.1. O descumprimento de qualquer cláusula deste instrumento ou do DPA incorporado sujeitará a parte infratora a:',
    '  (i) Rescisão imediata desta parceria, sem ônus para a parte inocente;',
    '  (ii) Indenização integral pelos danos diretos e indiretos causados à outra parte e a titulares de dados;',
    '  (iii) Notificação à ANPD, quando a infração constituir violação grave à LGPD.',
    '',
    '7.2. A responsabilidade de cada parte por atos de seus próprios subprocessadores é solidária perante os titulares de dados, conforme art. 42 LGPD.',
  ])

  // ── Clause 8 – Term ───────────────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 8 — VIGÊNCIA', [
    '8.1. Este instrumento entra em vigor na data de assinatura eletrônica por ambas as partes e permanece válido enquanto houver relação comercial ativa entre as partes.',
    '',
    '8.2. As obrigações de confidencialidade e proteção de dados subsistem por 5 anos após o término desta parceria ou pelo prazo exigido por lei, o que for maior.',
  ])

  // ── Clause 9 – Governing law ──────────────────────────────────────────────
  drawSection(ctx, 'CLÁUSULA 9 — LEI APLICÁVEL E FORO', [
    `9.1. Este instrumento é regido pelas leis da República Federativa do Brasil, em especial pela LGPD (Lei 13.709/2018) e legislação regulatória da ANVISA.`,
    '',
    `9.2. Fica eleito o Foro da ${CLINIPHARMA.foro} para dirimir quaisquer controvérsias decorrentes deste instrumento, renunciando as partes a qualquer outro, por mais privilegiado que seja.`,
  ])

  // ── Signature block ───────────────────────────────────────────────────────
  ensureSpace(ctx, 140)
  ctx.y -= 10
  drawHRule(ctx)

  drawText(ctx, `Brasília, DF, ${date}`, { size: 9, color: rgb(0.4, 0.4, 0.4) })
  ctx.y -= 20

  // Left sig
  ctx.currentPage.drawLine({
    start: { x: 50, y: ctx.y },
    end: { x: 250, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  // Right sig
  ctx.currentPage.drawLine({
    start: { x: 300, y: ctx.y },
    end: { x: 545, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  ctx.y -= 14
  drawText(ctx, party.name.slice(0, 36), { size: 8, x: 50 })
  ctx.currentPage.drawText('ALC INTERMEDIACAO E REPRESENTACAO LTDA', {
    x: 300,
    y: ctx.y + 14,
    font: ctx.font,
    size: 7,
    color: rgb(0.15, 0.15, 0.15),
  })
  ctx.currentPage.drawText(`CNPJ ${CLINIPHARMA.cnpj}`, {
    x: 300,
    y: ctx.y,
    font: ctx.font,
    size: 7,
    color: rgb(0.4, 0.4, 0.4),
  })
  ctx.y -= 12
  if (party.cpfCnpj) {
    ctx.currentPage.drawText(`CNPJ/CPF: ${party.cpfCnpj}`, {
      x: 50,
      y: ctx.y,
      font: ctx.font,
      size: 7,
      color: rgb(0.4, 0.4, 0.4),
    })
  }

  drawPageNumbers(ctx, ctx.pages.length)

  const pdfBytes = await doc.save()
  return Buffer.from(pdfBytes).toString('base64')
}

/** Generate a contract PDF and return base64 string.
 * Uses aiGeneratedBody if provided, otherwise falls back to static template text.
 * For CLINIC and PHARMACY types, delegates to generateDpaPdf for the full DPA document. */
export async function generateContractPdf(params: {
  type: ContractType
  party: ContractParty
  date?: string
  aiGeneratedBody?: string
}): Promise<string> {
  // DPA types get the full multi-page LGPD-compliant PDF
  if (params.type === 'CLINIC' || params.type === 'PHARMACY') {
    return generateDpaPdf({ type: params.type, party: params.party, date: params.date })
  }

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const { type, party } = params
  const date = params.date ?? new Date().toLocaleDateString('pt-BR')

  const TITLES: Record<ContractType, string> = {
    CLINIC: 'Contrato de Adesão — Clínica',
    DOCTOR: 'Contrato de Adesão — Médico',
    PHARMACY: 'Contrato de Fornecimento — Farmácia',
    CONSULTANT: 'Contrato de Consultoria Comercial',
  }

  const BODIES: Record<ContractType, string[]> = {
    CLINIC: [],
    PHARMACY: [],
    DOCTOR: [
      `Pelo presente instrumento, o médico acima identificado ("Contratante") adere à`,
      `plataforma Clinipharma ("Contratada"), concordando com os termos de uso, política`,
      `de privacidade e regras operacionais vigentes, disponíveis em clinipharma.com.br.`,
      ``,
      `O Contratante declara possuir registro ativo no CRM e autoriza a Clinipharma a`,
      `processar pedidos de medicamentos em seu nome, vinculados à(s) clínica(s) à(s)`,
      `qual(is) está associado.`,
    ],
    CONSULTANT: [
      `Pelo presente instrumento, o consultor acima identificado ("Contratado") firma`,
      `contrato de prestação de serviços comerciais com a Clinipharma ("Contratante").`,
      ``,
      `O Contratado atuará na captação e gestão de clínicas e médicos na plataforma,`,
      `recebendo comissão percentual sobre o valor dos pedidos das clínicas sob sua`,
      `responsabilidade, conforme tabela de comissões vigente.`,
    ],
  }

  let y = 780

  // Header
  page.drawText('CLINIPHARMA', { x: 50, y, font: boldFont, size: 16, color: rgb(0.07, 0.22, 0.37) })
  y -= 25
  page.drawText(TITLES[type], { x: 50, y, font: boldFont, size: 13, color: rgb(0.1, 0.1, 0.1) })
  y -= 30

  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  page.drawText('PARTES:', { x: 50, y, font: boldFont, size: 10 })
  y -= 16
  page.drawText(`CONTRATANTE: ${party.name}`, { x: 50, y, font, size: 10 })
  y -= 14
  if (party.cpfCnpj) {
    page.drawText(`CPF/CNPJ: ${party.cpfCnpj}`, { x: 50, y, font, size: 10 })
    y -= 14
  }
  if (party.email) {
    page.drawText(`E-mail: ${party.email}`, { x: 50, y, font, size: 10 })
    y -= 14
  }
  page.drawText(`CONTRATADA: ${CLINIPHARMA.razaoSocial}`, { x: 50, y, font, size: 10 })
  y -= 14
  page.drawText(`CNPJ: ${CLINIPHARMA.cnpj}`, { x: 50, y, font, size: 10 })
  y -= 25

  page.drawText('OBJETO E CONDIÇÕES:', { x: 50, y, font: boldFont, size: 10 })
  y -= 16
  const bodyLines = params.aiGeneratedBody
    ? params.aiGeneratedBody.split('\n').flatMap((line) => {
        const words = line.split(' ')
        const wrapped: string[] = []
        let current = ''
        for (const word of words) {
          if ((current + ' ' + word).length > 90) {
            wrapped.push(current)
            current = word
          } else {
            current = current ? current + ' ' + word : word
          }
        }
        if (current) wrapped.push(current)
        return wrapped
      })
    : BODIES[type]

  for (const line of bodyLines) {
    page.drawText(line, { x: 50, y, font, size: 10, color: rgb(0.2, 0.2, 0.2) })
    y -= 15
    if (y < 100) break
  }

  y -= 20
  page.drawLine({
    start: { x: 50, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })
  y -= 20

  page.drawText(`Este contrato é regido pelas leis brasileiras. Foro: ${CLINIPHARMA.foro}.`, {
    x: 50,
    y,
    font,
    size: 9,
    color: rgb(0.5, 0.5, 0.5),
  })
  y -= 15
  page.drawText(`Data: ${date}`, { x: 50, y, font, size: 9, color: rgb(0.5, 0.5, 0.5) })

  y -= 60
  page.drawLine({
    start: { x: 50, y },
    end: { x: 250, y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  page.drawLine({
    start: { x: 300, y },
    end: { x: 545, y },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  })
  y -= 14
  page.drawText(party.name, { x: 50, y, font, size: 8 })
  page.drawText(`${CLINIPHARMA.razaoSocial}`, { x: 300, y, font, size: 7 })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes).toString('base64')
}

// ── Full contract flow ────────────────────────────────────────────────────────

/**
 * Generate contract PDF, upload to Clicksign, add signers and notify.
 * Returns { documentKey, signerKey }.
 * Accepts an optional aiGeneratedBody to replace the static contract text.
 */
export async function createAndSendContract(params: {
  type: ContractType
  party: ContractParty
  clinipharmaRepEmail?: string
  /** AI-generated personalized contract body text */
  aiGeneratedBody?: string
}): Promise<{ documentKey: string; signerKey: string }> {
  const pdfBase64 = await generateContractPdf({
    type: params.type,
    party: params.party,
    aiGeneratedBody: params.aiGeneratedBody,
  })
  const filename = `contrato_${params.type.toLowerCase()}_${Date.now()}.pdf`
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const documentKey = await uploadDocument({ filename, base64Content: pdfBase64, deadline })

  // Add party signer
  const signerKey = await addSigner({
    documentKey,
    email: params.party.email ?? '',
    name: params.party.name,
    cpf: params.party.cpfCnpj,
  })

  // Add Clinipharma representative as co-signer when provided
  if (params.clinipharmaRepEmail) {
    await addSigner({
      documentKey,
      email: params.clinipharmaRepEmail,
      name: CLINIPHARMA.razaoSocial,
    })
  }

  await notifySigners(documentKey)

  return { documentKey, signerKey }
}
