import 'server-only'
import OpenAI from 'openai'
import { withCircuitBreaker } from '@/lib/circuit-breaker'
import { logger } from '@/lib/logger'

// ── Client (singleton) ────────────────────────────────────────────────────────

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _client
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TicketCategory = 'ORDER' | 'PAYMENT' | 'TECHNICAL' | 'GENERAL' | 'COMPLAINT'
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export interface TicketClassification {
  category: TicketCategory
  priority: TicketPriority
  reasoning: string
}

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'very_negative'

export interface SentimentAnalysis {
  sentiment: Sentiment
  churnRisk: boolean
  shouldEscalate: boolean
  reasoning: string
}

export interface ExtractedDocumentData {
  cnpj?: string
  razao_social?: string
  validade?: string
  tipo_documento?: string
  responsavel_tecnico?: string
  municipio?: string
  uf?: string
  raw_confidence: 'high' | 'medium' | 'low'
}

// ── Ticket Classification ─────────────────────────────────────────────────────

const TICKET_SYSTEM_PROMPT = `Você é um classificador de tickets de suporte de uma plataforma B2B médica chamada Clinipharma.
A plataforma conecta clínicas, farmácias, médicos e consultores de vendas.

Classifique o ticket em:

Categorias:
- ORDER: problemas com pedidos (atraso, erro no produto, status, entrega, cancelamento)
- PAYMENT: problemas financeiros (cobrança, boleto, PIX, reembolso, nota fiscal)
- TECHNICAL: problemas técnicos na plataforma (login, erro de sistema, bug, acesso)
- COMPLAINT: reclamação formal sobre atendimento, conduta ou qualidade
- GENERAL: dúvidas gerais, informações, sugestões

Prioridades:
- URGENT: impacto financeiro imediato, ameaça de cancelamento ("vou cancelar", "absurdo", "processarei"), pedido crítico parado
- HIGH: problema ativo que bloqueia operação da clínica, prazo vencendo
- NORMAL: problema que pode esperar 1–2 dias úteis
- LOW: dúvida, sugestão, elogio, curiosidade

Responda APENAS JSON válido, sem markdown:
{"category":"ORDER","priority":"NORMAL","reasoning":"Breve justificativa em português"}`

export async function classifyTicket(
  title: string,
  body: string
): Promise<TicketClassification | null> {
  try {
    const result = await withCircuitBreaker(
      async () =>
        getClient().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: TICKET_SYSTEM_PROMPT },
            { role: 'user', content: `Título: ${title}\n\nMensagem: ${body}` },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 200,
          temperature: 0.1,
        }),
      { name: 'openai-classify' }
    )

    const text = result.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(text) as TicketClassification

    const validCategories: TicketCategory[] = [
      'ORDER',
      'PAYMENT',
      'TECHNICAL',
      'GENERAL',
      'COMPLAINT',
    ]
    const validPriorities: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

    if (!validCategories.includes(parsed.category) || !validPriorities.includes(parsed.priority)) {
      logger.warn('[ai] classifyTicket returned invalid values', { parsed })
      return null
    }

    return parsed
  } catch (err) {
    logger.error('[ai] classifyTicket failed', { err })
    return null
  }
}

// ── Sentiment Analysis ────────────────────────────────────────────────────────

const SENTIMENT_SYSTEM_PROMPT = `Você é um analisador de sentimento para mensagens de clientes de uma plataforma B2B médica.

Analise o sentimento e risco de churn da mensagem.

sentiments: positive | neutral | negative | very_negative
churnRisk: true se há sinais de cancelamento, ameaça jurídica ou abandono da plataforma
shouldEscalate: true se churnRisk=true OU sentiment=very_negative

Palavras de churn a detectar: "cancelar", "vou embora", "nunca mais", "absurdo", "processarei", "advogado", "judicial", "denunciar", "procon", "reclame aqui", "péssimo", "horrível", "incompetente"

Responda APENAS JSON válido:
{"sentiment":"neutral","churnRisk":false,"shouldEscalate":false,"reasoning":"Justificativa breve"}`

const VALID_SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative', 'very_negative']

export async function analyzeSentiment(text: string): Promise<SentimentAnalysis | null> {
  try {
    const result = await withCircuitBreaker(
      async () =>
        getClient().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 150,
          temperature: 0.1,
        }),
      { name: 'openai-sentiment' }
    )

    const raw = result.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw) as SentimentAnalysis

    if (!VALID_SENTIMENTS.includes(parsed.sentiment)) {
      logger.warn('[ai] analyzeSentiment returned invalid sentiment', { parsed })
      return null
    }

    if (typeof parsed.churnRisk !== 'boolean' || typeof parsed.shouldEscalate !== 'boolean') {
      logger.warn('[ai] analyzeSentiment returned non-boolean flags', { parsed })
      return null
    }

    return parsed
  } catch (err) {
    logger.error('[ai] analyzeSentiment failed', { err })
    return null
  }
}

// ── Document OCR ──────────────────────────────────────────────────────────────

const OCR_SYSTEM_PROMPT = `Você é um extrator de dados de documentos empresariais brasileiros.
Extraia os seguintes campos do documento (se presentes):
- cnpj: formato XX.XXX.XXX/XXXX-XX
- razao_social: razão social completa
- validade: data de validade no formato DD/MM/YYYY (para alvarás, licenças)
- tipo_documento: "CNPJ", "Alvará Sanitário", "Licença de Funcionamento", "CRM", "RG", "CPF", "Contrato Social", "Outro"
- responsavel_tecnico: nome do responsável técnico (farmacêutico, médico responsável)
- municipio: município
- uf: estado (2 letras)
- raw_confidence: "high" se leu claramente, "medium" se parcial, "low" se documento ilegível

Responda APENAS JSON válido. Use null para campos não encontrados.`

export async function extractDocumentData(imageUrl: string): Promise<ExtractedDocumentData | null> {
  try {
    const result = await withCircuitBreaker(
      async () =>
        getClient().chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: OCR_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: imageUrl, detail: 'high' },
                },
                { type: 'text', text: 'Extraia os dados deste documento.' },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 400,
          temperature: 0,
        }),
      { name: 'openai-ocr' }
    )

    const text = result.choices[0]?.message?.content ?? '{}'
    return JSON.parse(text) as ExtractedDocumentData
  } catch (err) {
    logger.error('[ai] extractDocumentData failed', { err })
    return null
  }
}

// ── Contract Text Generation ──────────────────────────────────────────────────

export interface ContractParty {
  type: 'CLINIC' | 'DOCTOR' | 'PHARMACY' | 'CONSULTANT'
  name: string
  cnpj?: string
  email?: string
  city?: string
  state?: string
  commissionRate?: number
}

export async function generateContractText(party: ContractParty): Promise<string | null> {
  const TITLES: Record<string, string> = {
    CLINIC: 'Contrato de Adesão — Clínica Parceira',
    DOCTOR: 'Contrato de Adesão — Médico Parceiro',
    PHARMACY: 'Contrato de Fornecimento — Farmácia Parceira',
    CONSULTANT: 'Contrato de Consultoria Comercial',
  }

  const context = [
    `Tipo de entidade: ${party.type}`,
    `Nome/Razão social: ${party.name}`,
    party.cnpj ? `CNPJ: ${party.cnpj}` : '',
    party.city && party.state ? `Localização: ${party.city}/${party.state}` : '',
    party.commissionRate ? `Taxa de comissão: ${party.commissionRate}%` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await withCircuitBreaker(
      async () =>
        getClient().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é um redator jurídico especializado em contratos de plataformas digitais de saúde no Brasil.
Redija o corpo de um contrato formal e personalizado (3–5 parágrafos) para inclusão em um PDF.
Use linguagem jurídica formal em português brasileiro.
NÃO inclua cabeçalho, assinaturas, datas ou cláusulas — apenas o corpo principal.
Personalize com os dados fornecidos. Mencione a Clinipharma como plataforma intermediadora.`,
            },
            {
              role: 'user',
              content: `Redija o corpo do contrato "${TITLES[party.type]}" com os seguintes dados:\n${context}`,
            },
          ],
          max_tokens: 800,
          temperature: 0, // deterministic — same data must produce same contract body
        }),
      { name: 'openai-contract' }
    )

    return result.choices[0]?.message?.content ?? null
  } catch (err) {
    logger.error('[ai] generateContractText failed', { err })
    return null
  }
}
