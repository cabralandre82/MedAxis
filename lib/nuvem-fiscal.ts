import { withCircuitBreaker } from '@/lib/circuit-breaker'
import { logger } from '@/lib/logger'

const BASE_URL = 'https://api.nuvemfiscal.com.br'
const AUTH_URL = 'https://auth.nuvemfiscal.com.br/oauth/token'

// ── OAuth2 token cache ────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string
  expiresAt: number // ms epoch
}

let tokenCache: TokenCache | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken
  }

  const clientId = process.env.NUVEM_FISCAL_CLIENT_ID
  const clientSecret = process.env.NUVEM_FISCAL_CLIENT_SECRET

  if (!clientId || !clientSecret || clientId === 'PENDING_CNPJ') {
    throw new Error('Nuvem Fiscal credentials not configured')
  }

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'nfse',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Nuvem Fiscal auth error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return tokenCache.accessToken
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function nuvemFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Nuvem Fiscal API error ${res.status}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NovaNFSeInput {
  /** Unique internal reference — used for idempotency (max 50 chars) */
  referencia: string
  /** Service value in BRL */
  valorServicos: number
  /** Free-text service description shown on the NFS-e */
  discriminacao: string
  /** Tomador (service recipient) */
  tomador: {
    cpfCnpj: string
    razaoSocial: string
    email?: string
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    codigoMunicipio?: string
    uf?: string
    cep?: string
  }
}

export interface NFSeResponse {
  id: string
  status: string
  numero?: string
  chave_acesso?: string
  pdf?: string
  referencia: string
  created_at: string
}

// ── Emit NFS-e ────────────────────────────────────────────────────────────────

export async function emitirNFSe(input: NovaNFSeInput): Promise<NFSeResponse> {
  const prestadorCnpj = process.env.NUVEM_FISCAL_CNPJ
  if (!prestadorCnpj || prestadorCnpj === 'PENDING_CNPJ') {
    throw new Error('NUVEM_FISCAL_CNPJ not configured')
  }

  const ambiente = process.env.NODE_ENV === 'production' ? 'producao' : 'homologacao'

  const payload = {
    cpf_cnpj: prestadorCnpj,
    ambiente,
    referencia: input.referencia,
    data_emissao: new Date().toISOString(),
    prestador: {
      cpf_cnpj: prestadorCnpj,
    },
    tomador: {
      cpf_cnpj: input.tomador.cpfCnpj,
      razao_social: input.tomador.razaoSocial,
      email: input.tomador.email ?? undefined,
      endereco: input.tomador.logradouro
        ? {
            logradouro: input.tomador.logradouro,
            numero: input.tomador.numero ?? 'S/N',
            complemento: input.tomador.complemento ?? undefined,
            bairro: input.tomador.bairro ?? undefined,
            codigo_municipio: input.tomador.codigoMunicipio ?? undefined,
            uf: input.tomador.uf ?? undefined,
            codigo_pais: '1058',
            pais: 'Brasil',
            cep: input.tomador.cep ?? undefined,
          }
        : undefined,
    },
    servico: {
      valor_servicos: input.valorServicos,
      discriminacao: input.discriminacao,
      // CNAE / item de lista de serviço para plataformas digitais de intermediação
      item_lista_servico: '17.06',
      codigo_tributacao_municipio: '1706',
    },
  }

  return withCircuitBreaker(
    () => nuvemFetch<NFSeResponse>('/nfse', { method: 'POST', body: JSON.stringify(payload) }),
    {
      name: 'nuvem-fiscal',
    }
  )
}

// ── Query NFS-e ───────────────────────────────────────────────────────────────

export async function consultarNFSe(nfseId: string): Promise<NFSeResponse> {
  return withCircuitBreaker(() => nuvemFetch<NFSeResponse>(`/nfse/${nfseId}`), {
    name: 'nuvem-fiscal',
  })
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function nuvemFiscalHealthCheck(): Promise<boolean> {
  try {
    await getAccessToken()
    return true
  } catch (err) {
    logger.error('[nuvem-fiscal] health check failed', { error: err })
    return false
  }
}
