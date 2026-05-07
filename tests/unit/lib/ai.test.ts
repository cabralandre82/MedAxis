// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all server-only dependencies before importing lib/ai
vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Mock circuit breaker to pass through the function call
vi.mock('@/lib/circuit-breaker', () => ({
  withCircuitBreaker: vi.fn().mockImplementation(async (fn: () => unknown) => fn()),
  CircuitOpenError: class CircuitOpenError extends Error {},
}))

// Mock metrics so we can assert on incCounter without spinning the
// real registry. T8 introduced ocr_extraction_total — we want strong
// evidence we keep emitting it on every code path.
const mockIncCounter = vi.fn()
vi.mock('@/lib/metrics', () => ({
  incCounter: (...args: unknown[]) => mockIncCounter(...args),
  Metrics: {
    OCR_EXTRACTION_TOTAL: 'ocr_extraction_total',
  },
}))

// Mock OpenAI SDK
const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}))

import { classifyTicket, analyzeSentiment, extractDocumentData } from '@/lib/ai'

function makeOpenAIResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  }
}

describe('classifyTicket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-AI-01: classifica ticket de pedido corretamente', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({ category: 'ORDER', priority: 'HIGH', reasoning: 'Problema com pedido' })
      )
    )

    const result = await classifyTicket(
      'Pedido atrasado',
      'Meu pedido ORD-001 está há 3 dias em processamento'
    )
    expect(result).not.toBeNull()
    expect(result!.category).toBe('ORDER')
    expect(result!.priority).toBe('HIGH')
    expect(result!.reasoning).toBeTruthy()
  })

  it('TC-AI-02: classifica ticket de pagamento como URGENT', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({ category: 'PAYMENT', priority: 'URGENT', reasoning: 'Cobrança duplicada' })
      )
    )

    const result = await classifyTicket(
      'Fui cobrado duas vezes',
      'Minha clínica foi debitada em duplicidade'
    )
    expect(result!.category).toBe('PAYMENT')
    expect(result!.priority).toBe('URGENT')
  })

  it('TC-AI-03: retorna null se OpenAI falhar', async () => {
    mockCreate.mockRejectedValueOnce(new Error('OpenAI timeout'))
    const result = await classifyTicket('Título', 'Descrição')
    expect(result).toBeNull()
  })

  it('TC-AI-04: retorna null se categoria inválida for retornada', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({ category: 'INVALID_CAT', priority: 'NORMAL', reasoning: 'x' })
      )
    )
    const result = await classifyTicket('Título', 'Descrição')
    expect(result).toBeNull()
  })

  it('TC-AI-05: retorna null se prioridade inválida for retornada', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({ category: 'GENERAL', priority: 'SUPER_HIGH', reasoning: 'x' })
      )
    )
    const result = await classifyTicket('Título', 'Descrição')
    expect(result).toBeNull()
  })
})

describe('analyzeSentiment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-AI-06: detecta sentimento negativo com risco de churn', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          sentiment: 'very_negative',
          churnRisk: true,
          shouldEscalate: true,
          reasoning: 'Ameaça de cancelamento',
        })
      )
    )

    const result = await analyzeSentiment('Vou cancelar minha conta, isso é um absurdo!')
    expect(result).not.toBeNull()
    expect(result!.sentiment).toBe('very_negative')
    expect(result!.churnRisk).toBe(true)
    expect(result!.shouldEscalate).toBe(true)
  })

  it('TC-AI-07: detecta sentimento neutro sem risco de churn', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          sentiment: 'neutral',
          churnRisk: false,
          shouldEscalate: false,
          reasoning: 'Pergunta técnica simples',
        })
      )
    )

    const result = await analyzeSentiment('Como faço para atualizar meu cadastro?')
    expect(result!.sentiment).toBe('neutral')
    expect(result!.churnRisk).toBe(false)
    expect(result!.shouldEscalate).toBe(false)
  })

  it('TC-AI-08: retorna null se OpenAI falhar', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))
    const result = await analyzeSentiment('mensagem')
    expect(result).toBeNull()
  })

  it('TC-AI-08b: retorna null se sentiment fora do enum (ex: "happy")', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          sentiment: 'happy', // inválido
          churnRisk: false,
          shouldEscalate: false,
          reasoning: 'x',
        })
      )
    )
    const result = await analyzeSentiment('mensagem')
    expect(result).toBeNull()
  })

  it('TC-AI-08c: retorna null se churnRisk ou shouldEscalate não forem boolean', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          sentiment: 'neutral',
          churnRisk: 'true', // string em vez de boolean
          shouldEscalate: 1, // número em vez de boolean
          reasoning: 'x',
        })
      )
    )
    const result = await analyzeSentiment('mensagem')
    expect(result).toBeNull()
  })
})

describe('extractDocumentData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-AI-09: extrai dados de documento com alta confiança', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          cnpj: '12.345.678/0001-90',
          razao_social: 'Farmácia Exemplo Ltda',
          validade: '31/12/2027',
          tipo_documento: 'Alvará Sanitário',
          responsavel_tecnico: 'Dr. Carlos Souza',
          municipio: 'São Paulo',
          uf: 'SP',
          raw_confidence: 'high',
        })
      )
    )

    const result = await extractDocumentData('https://storage.example.com/doc.pdf')
    expect(result).not.toBeNull()
    expect(result!.cnpj).toBe('12.345.678/0001-90')
    expect(result!.razao_social).toBe('Farmácia Exemplo Ltda')
    expect(result!.raw_confidence).toBe('high')
    expect(result!.tipo_documento).toBe('Alvará Sanitário')
    // T8 baseline metric
    expect(mockIncCounter).toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'high',
    })
  })

  it('TC-AI-10: retorna null se OpenAI Vision falhar', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Vision API error'))
    const result = await extractDocumentData('https://storage.example.com/doc.pdf')
    expect(result).toBeNull()
    expect(mockIncCounter).toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'error',
    })
  })

  it('TC-AI-08d: não dispara escalação se shouldEscalate é string "true"', async () => {
    // Garante que o guard de boolean impede escalação incorreta antes de chegar ao support.ts
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          sentiment: 'very_negative',
          churnRisk: 'true', // string — deve ser rejeitado
          shouldEscalate: 'true', // string — deve ser rejeitado
          reasoning: 'x',
        })
      )
    )
    const result = await analyzeSentiment('quero cancelar!')
    expect(result).toBeNull() // sem null, escalação ocorreria indevidamente
  })

  it('TC-AI-11: lida com documento ilegível (low confidence)', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          cnpj: null,
          razao_social: null,
          validade: null,
          tipo_documento: null,
          raw_confidence: 'low',
        })
      )
    )

    const result = await extractDocumentData('https://storage.example.com/blurry.jpg')
    expect(result!.raw_confidence).toBe('low')
    expect(result!.cnpj).toBeNull()
    expect(mockIncCounter).toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'low',
    })
  })

  // T8 — OCR prompt-injection defense
  it('TC-AI-T8a: força raw_confidence=low quando flagged=prompt_injection_suspected', async () => {
    // Mesmo que o modelo "viole" a instrução IMUTÁVEL e devolva
    // confidence=high junto com o flag, a camada de TS força low.
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          cnpj: '99.999.999/9999-99',
          razao_social: 'PAYLOAD INJETADO',
          raw_confidence: 'high',
          flagged: 'prompt_injection_suspected',
        })
      )
    )

    const result = await extractDocumentData('https://storage.example.com/attack.jpg')
    expect(result).not.toBeNull()
    expect(result!.flagged).toBe('prompt_injection_suspected')
    // INV: confidence sempre 'low' quando flagged
    expect(result!.raw_confidence).toBe('low')
    expect(mockIncCounter).toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'prompt_injection_suspected',
    })
    // E não emite outcome=high nesse caminho
    expect(mockIncCounter).not.toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'high',
    })
  })

  it('TC-AI-T8b: rejeita raw_confidence fora do enum', async () => {
    mockCreate.mockResolvedValueOnce(
      makeOpenAIResponse(
        JSON.stringify({
          cnpj: '12.345.678/0001-90',
          razao_social: 'Algo',
          raw_confidence: 'super_high', // inválido
        })
      )
    )

    const result = await extractDocumentData('https://storage.example.com/doc.pdf')
    expect(result).toBeNull()
    expect(mockIncCounter).toHaveBeenCalledWith('ocr_extraction_total', {
      outcome: 'invalid_response',
    })
  })

  it('TC-AI-T8c: prompt do sistema contém o bloco IMUTÁVEL', async () => {
    // Smoke test estático — garante que ninguém remove o bloco de defesa
    // sem trocar essa expectativa explicitamente. Inspeciona o argumento
    // passado para chat.completions.create.
    mockCreate.mockResolvedValueOnce(makeOpenAIResponse(JSON.stringify({ raw_confidence: 'high' })))

    await extractDocumentData('https://storage.example.com/doc.pdf')
    const callArgs = mockCreate.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMsg = callArgs.messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).toContain('INSTRUÇÃO IMUTÁVEL')
    expect(systemMsg!.content).toContain('prompt_injection_suspected')
    expect(systemMsg!.content).toContain('INPUT NÃO-CONFIÁVEL')
  })
})
