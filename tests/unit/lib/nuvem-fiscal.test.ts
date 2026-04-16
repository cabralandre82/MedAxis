/**
 * Tests for lib/nuvem-fiscal.ts
 * Uses vi.importActual to bypass the global mock from setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as NuvemFiscalTypes from '@/lib/nuvem-fiscal'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/circuit-breaker', () => ({
  withCircuitBreaker: vi.fn((fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

let nuvemFiscal: typeof NuvemFiscalTypes

beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.NUVEM_FISCAL_CLIENT_ID
  delete process.env.NUVEM_FISCAL_CLIENT_SECRET
  delete process.env.NUVEM_FISCAL_CNPJ
  // Reset module cache so the module-level tokenCache is cleared on re-import
  vi.resetModules()
  nuvemFiscal = (await vi.importActual('@/lib/nuvem-fiscal')) as typeof NuvemFiscalTypes
})

function setCredentials() {
  process.env.NUVEM_FISCAL_CLIENT_ID = 'cid-test'
  process.env.NUVEM_FISCAL_CLIENT_SECRET = 'csecret-test'
  process.env.NUVEM_FISCAL_CNPJ = '66279691000112'
  process.env.NODE_ENV = 'production'
}

// ── credential validation ─────────────────────────────────────────────────────
// Note: emitirNFSe checks NUVEM_FISCAL_CNPJ first, then calls getAccessToken.

describe('credential validation', () => {
  it('throws CNPJ error when CNPJ env var is absent', async () => {
    // CLIENT_ID set but no CNPJ — CNPJ check fires first in emitirNFSe
    process.env.NUVEM_FISCAL_CLIENT_ID = 'cid'
    process.env.NUVEM_FISCAL_CLIENT_SECRET = 'cs'
    await expect(
      nuvemFiscal.emitirNFSe({
        referencia: 'r',
        valorServicos: 10,
        discriminacao: 'S',
        tomador: { cpfCnpj: '00', razaoSocial: 'T' },
      })
    ).rejects.toThrow('NUVEM_FISCAL_CNPJ not configured')
  })

  it('throws credentials error when CLIENT_ID is absent (CNPJ set)', async () => {
    // CNPJ present but no CLIENT_ID — credentials check fires in getAccessToken
    process.env.NUVEM_FISCAL_CNPJ = '66279691000112'
    await expect(
      nuvemFiscal.emitirNFSe({
        referencia: 'r',
        valorServicos: 10,
        discriminacao: 'S',
        tomador: { cpfCnpj: '00', razaoSocial: 'T' },
      })
    ).rejects.toThrow('Nuvem Fiscal credentials not configured')
  })

  it('throws credentials error when credentials are PENDING_CNPJ placeholder', async () => {
    process.env.NUVEM_FISCAL_CLIENT_ID = 'PENDING_CNPJ'
    process.env.NUVEM_FISCAL_CLIENT_SECRET = 'PENDING_CNPJ'
    process.env.NUVEM_FISCAL_CNPJ = '66279691000112'
    await expect(
      nuvemFiscal.emitirNFSe({
        referencia: 'r',
        valorServicos: 10,
        discriminacao: 'S',
        tomador: { cpfCnpj: '00', razaoSocial: 'T' },
      })
    ).rejects.toThrow('Nuvem Fiscal credentials not configured')
  })
})

// ── OAuth2 token ──────────────────────────────────────────────────────────────

describe('OAuth2 token acquisition', () => {
  it('requests token with correct grant_type, client_id and scope', async () => {
    setCredentials()
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'n1', status: 'pendente', referencia: 'r' }),
      })

    await nuvemFiscal.emitirNFSe({
      referencia: 'r',
      valorServicos: 100,
      discriminacao: 'S',
      tomador: { cpfCnpj: '12345678000195', razaoSocial: 'E' },
    })

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('oauth/token')
    const body = opts.body.toString()
    expect(body).toContain('client_id=cid-test')
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('scope=nfse')
  })

  it('throws auth error when token request fails', async () => {
    setCredentials()
    // First fetch call = token request → fail
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' })
    await expect(
      nuvemFiscal.emitirNFSe({
        referencia: 'r',
        valorServicos: 10,
        discriminacao: 'S',
        tomador: { cpfCnpj: '00', razaoSocial: 'T' },
      })
    ).rejects.toThrow('401')
  })

  it('healthCheck returns false when credentials are missing', async () => {
    expect(await nuvemFiscal.nuvemFiscalHealthCheck()).toBe(false)
  })

  it('healthCheck returns true when token obtained successfully', async () => {
    setCredentials()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tok', expires_in: 3600 }),
    })
    expect(await nuvemFiscal.nuvemFiscalHealthCheck()).toBe(true)
  })
})

// ── NFS-e payload and response ────────────────────────────────────────────────

describe('emitirNFSe — payload and response', () => {
  it('sends correct payload with prestador CNPJ, item_lista_servico and tomador', async () => {
    setCredentials()
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-2', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'nfse-abc',
          status: 'autorizado',
          numero: '42',
          chave_acesso: 'chave-1',
          referencia: 'ref-1',
        }),
      })

    const result = await nuvemFiscal.emitirNFSe({
      referencia: 'ref-1',
      valorServicos: 250.5,
      discriminacao: 'Intermediação Clinipharma',
      tomador: { cpfCnpj: '12345678000195', razaoSocial: 'Clínica Teste', email: 'c@test.com' },
    })

    const [nfseUrl, nfseOpts] = mockFetch.mock.calls[1]
    expect(nfseUrl).toContain('/nfse')
    expect(nfseOpts.method).toBe('POST')
    expect(nfseOpts.headers['Authorization']).toBe('Bearer tok-2')

    const body = JSON.parse(nfseOpts.body)
    expect(body.referencia).toBe('ref-1')
    expect(body.servico.valor_servicos).toBe(250.5)
    expect(body.tomador.cpf_cnpj).toBe('12345678000195')
    expect(body.prestador.cpf_cnpj).toBe('66279691000112')
    expect(body.servico.item_lista_servico).toBe('17.06')
    expect(body.ambiente).toBe('producao')

    expect(result.id).toBe('nfse-abc')
    expect(result.numero).toBe('42')
    expect(result.status).toBe('autorizado')
  })

  it('throws API error when /nfse returns 422', async () => {
    setCredentials()
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-3', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Unprocessable' })
    await expect(
      nuvemFiscal.emitirNFSe({
        referencia: 'r',
        valorServicos: 50,
        discriminacao: 'S',
        tomador: { cpfCnpj: '00', razaoSocial: 'T' },
      })
    ).rejects.toThrow('Nuvem Fiscal API error 422')
  })
})
