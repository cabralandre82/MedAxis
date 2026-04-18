// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { attachCronGuard, loggerMock } from '@/tests/helpers/cron-guard-mock'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/logger', () => loggerMock())
vi.mock('@/lib/ai', () => ({
  extractDocumentData: vi.fn(),
  classifyTicket: vi.fn(),
  analyzeSentiment: vi.fn(),
}))
vi.mock('@/lib/inngest', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}))

import * as adminModule from '@/lib/db/admin'
import * as rbacModule from '@/lib/rbac'
import * as aiModule from '@/lib/ai'

function makeAdminClient(
  overrides: {
    registration?: unknown
    documents?: unknown
    signedUrl?: unknown
  } = {}
) {
  const storageBuilder = {
    list: vi.fn().mockResolvedValue({ data: overrides.documents ?? [], error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed/doc.pdf' },
    }),
  }

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: overrides.registration ?? null,
            error: overrides.registration ? null : { message: 'not found' },
          }),
        }),
      }),
    }),
    storage: {
      from: vi.fn().mockReturnValue(storageBuilder),
    },
  }
}

// ── OCR Route ─────────────────────────────────────────────────────────────────

describe('POST /api/admin/registrations/[id]/ocr', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-OCR-01: retorna 401 sem autenticação de admin', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValueOnce(new Error('UNAUTHORIZED'))

    const { POST } = await import('@/app/api/admin/registrations/[id]/ocr/route')
    const req = new NextRequest('http://localhost/api/admin/registrations/reg-1/ocr', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'reg-1' }) })
    expect(res.status).toBe(401)
  })

  it('TC-OCR-02: retorna 404 se registro não encontrado', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminClient({ registration: null }) as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/admin/registrations/[id]/ocr/route')
    const req = new NextRequest('http://localhost/api/admin/registrations/reg-1/ocr', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'reg-1' }) })
    expect(res.status).toBe(404)
  })

  it('TC-OCR-03: retorna 404 quando não há documentos', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminClient({
        registration: {
          id: 'reg-1',
          type: 'CLINIC',
          form_data: { cnpj: '12.345.678/0001-90' },
          user_id: 'u-1',
        },
        documents: [],
      }) as ReturnType<typeof adminModule.createAdminClient>
    )

    const { POST } = await import('@/app/api/admin/registrations/[id]/ocr/route')
    const req = new NextRequest('http://localhost/api/admin/registrations/reg-1/ocr', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'reg-1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('documento')
  })

  it('TC-OCR-04: analisa documentos e retorna summary com match de CNPJ', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminClient({
        registration: {
          id: 'reg-1',
          type: 'CLINIC',
          form_data: { cnpj: '12.345.678/0001-90', corporate_name: 'Farmácia Exemplo Ltda' },
          user_id: 'u-1',
        },
        documents: [{ name: 'alvara.pdf', metadata: { size: 1024, mimetype: 'application/pdf' } }],
      }) as ReturnType<typeof adminModule.createAdminClient>
    )

    vi.mocked(aiModule.extractDocumentData).mockResolvedValueOnce({
      cnpj: '12.345.678/0001-90',
      razao_social: 'Farmácia Exemplo Ltda',
      validade: '31/12/2027',
      tipo_documento: 'Alvará Sanitário',
      raw_confidence: 'high',
    })

    const { POST } = await import('@/app/api/admin/registrations/[id]/ocr/route')
    const req = new NextRequest('http://localhost/api/admin/registrations/reg-1/ocr', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'reg-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toBeDefined()
    expect(body.summary.cnpjMatch).toBe(true)
    expect(body.summary.overallConfidence).toBe('high')
    expect(body.extractions).toHaveLength(1)
  })

  it('TC-OCR-05: lida com falha do OCR sem travar', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      makeAdminClient({
        registration: {
          id: 'reg-1',
          type: 'CLINIC',
          form_data: { cnpj: '12.345.678/0001-90' },
          user_id: 'u-1',
        },
        documents: [{ name: 'doc.pdf', metadata: {} }],
      }) as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(aiModule.extractDocumentData).mockResolvedValueOnce(null)

    const { POST } = await import('@/app/api/admin/registrations/[id]/ocr/route')
    const req = new NextRequest('http://localhost/api/admin/registrations/reg-1/ocr', {
      method: 'POST',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'reg-1' }) })
    // Should not throw — returns 200 with null extraction
    expect(res.status).toBe(200)
  })
})

// ── Product Recommendations Route ─────────────────────────────────────────────

describe('GET /api/products/[id]/recommendations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('TC-RECO-API-01: retorna 401 sem autenticação', async () => {
    vi.mocked(rbacModule.requireRole).mockRejectedValueOnce(new Error('UNAUTHORIZED'))

    const { GET } = await import('@/app/api/products/[id]/recommendations/route')
    const req = new NextRequest('http://localhost/api/products/prod-1/recommendations')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })
    expect(res.status).toBe(401)
  })

  it('TC-RECO-API-02: retorna lista de recomendações ativas', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)

    const mockAssocData = [
      {
        product_b_id: 'prod-2',
        support: 8,
        confidence: 0.65,
        product: {
          id: 'prod-2',
          name: 'Vitamina D 2000UI',
          slug: 'vitamina-d-2000ui',
          price_current: 45.9,
          status: 'active',
          category: [{ name: 'Vitaminas' }],
        },
      },
    ]

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: mockAssocData, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as ReturnType<typeof adminModule.createAdminClient>)

    const { GET } = await import('@/app/api/products/[id]/recommendations/route')
    const req = new NextRequest('http://localhost/api/products/prod-1/recommendations')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0].name).toBe('Vitamina D 2000UI')
    expect(body.recommendations[0].confidence).toBe(0.65)
  })

  it('TC-RECO-API-03: filtra produtos inativos das recomendações', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)

    const mockAssocData = [
      {
        product_b_id: 'prod-inactive',
        support: 5,
        confidence: 0.4,
        product: {
          id: 'prod-inactive',
          name: 'Produto Inativo',
          slug: 'produto-inativo',
          price_current: 30.0,
          status: 'inactive', // should be filtered
          category: null,
        },
      },
    ]

    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: mockAssocData, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as ReturnType<typeof adminModule.createAdminClient>)

    const { GET } = await import('@/app/api/products/[id]/recommendations/route')
    const req = new NextRequest('http://localhost/api/products/prod-1/recommendations')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })

    const body = await res.json()
    expect(body.recommendations).toHaveLength(0) // inactive filtered out
  })

  it('TC-RECO-API-04: retorna lista vazia sem erro quando não há associações', async () => {
    vi.mocked(rbacModule.requireRole).mockResolvedValueOnce(undefined)
    vi.mocked(adminModule.createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    } as ReturnType<typeof adminModule.createAdminClient>)

    const { GET } = await import('@/app/api/products/[id]/recommendations/route')
    const req = new NextRequest('http://localhost/api/products/prod-1/recommendations')
    const res = await GET(req, { params: Promise.resolve({ id: 'prod-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recommendations).toEqual([])
  })
})

// ── Cron trigger routes ───────────────────────────────────────────────────────

describe('Cron trigger routes (churn-check, reorder-alerts, product-recommendations)', () => {
  const CRON_SECRET = 'test-cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET

    // Every cron route now runs under withCronGuard, which requires the
    // admin client to expose `rpc()` and a `from('cron_runs')` branch.
    const stub = attachCronGuard({ from: () => ({}) })
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      stub.admin as unknown as ReturnType<typeof adminModule.createAdminClient>
    )
  })

  async function testCronRoute(routePath: string) {
    const mod = await import(routePath)
    return mod.GET
  }

  it('TC-CRON-AI-01: churn-check retorna 401 sem Authorization', async () => {
    const GET = await testCronRoute('@/app/api/cron/churn-check/route')
    const req = new NextRequest('http://localhost/api/cron/churn-check')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('TC-CRON-AI-02: churn-check dispara evento Inngest com token correto', async () => {
    const { inngest } = await import('@/lib/inngest')
    const GET = await testCronRoute('@/app/api/cron/churn-check/route')
    const req = new NextRequest('http://localhost/api/cron/churn-check', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cron/churn.check' })
    )
  })

  it('TC-CRON-AI-03: reorder-alerts retorna 401 sem Authorization', async () => {
    const GET = await testCronRoute('@/app/api/cron/reorder-alerts/route')
    const req = new NextRequest('http://localhost/api/cron/reorder-alerts')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('TC-CRON-AI-04: reorder-alerts dispara evento Inngest com token correto', async () => {
    const { inngest } = await import('@/lib/inngest')
    const GET = await testCronRoute('@/app/api/cron/reorder-alerts/route')
    const req = new NextRequest('http://localhost/api/cron/reorder-alerts', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cron/reorder-alerts.check' })
    )
  })

  it('TC-CRON-AI-05: product-recommendations dispara evento Inngest com token correto', async () => {
    const { inngest } = await import('@/lib/inngest')
    const GET = await testCronRoute('@/app/api/cron/product-recommendations/route')
    const req = new NextRequest('http://localhost/api/cron/product-recommendations', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(vi.mocked(inngest.send)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cron/product-recommendations.rebuild' })
    )
  })
})
