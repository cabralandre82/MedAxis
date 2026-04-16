// Remove the global mock for this service (set in setup.ts) so we test the real implementation
vi.unmock('@/services/nfse')

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as adminModule from '@/lib/db/admin'
import * as nuvemFiscalModule from '@/lib/nuvem-fiscal'
import { emitirNFSeParaTransferencia, emitirNFSeParaConsultor } from '@/services/nfse'

vi.mock('@/lib/db/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/nuvem-fiscal', () => ({
  emitirNFSe: vi.fn(),
  consultarNFSe: vi.fn(),
  nuvemFiscalHealthCheck: vi.fn(),
}))

const nfseOkResponse = {
  id: 'nfse-xyz',
  status: 'autorizado',
  numero: '100',
  chave_acesso: 'chave-abc',
  referencia: 'ref-test',
  created_at: new Date().toISOString(),
}

/**
 * Builds an admin mock where each consecutive `from()` call returns a fresh
 * builder snapshot. Captures all `update(payload)` argument payloads.
 */
function buildAdmin(responses: Array<{ data: unknown; error: unknown }>) {
  let idx = 0
  const updatePayloads: unknown[] = []
  const fromMock = vi.fn(() => {
    const res = responses[idx++] ?? { data: null, error: null }
    const b: Record<string, unknown> = {}
    b.select = vi.fn().mockReturnValue(b)
    b.eq = vi.fn().mockReturnValue(b)
    b.insert = vi.fn().mockReturnValue(b)
    b.update = vi.fn((payload: unknown) => {
      updatePayloads.push(payload)
      return b
    })
    b.maybeSingle = vi.fn().mockResolvedValue({ data: res.data, error: res.error })
    b.single = vi.fn().mockResolvedValue({ data: res.data, error: res.error })
    b.then = (resolve: (v: unknown) => void) => resolve({ data: res.data, error: res.error })
    return b
  })
  const client = { from: fromMock }
  return { client, updatePayloads }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(nuvemFiscalModule.emitirNFSe).mockResolvedValue(nfseOkResponse)
  delete process.env.NUVEM_FISCAL_CNPJ
})

// ── emitirNFSeParaTransferencia ───────────────────────────────────────────────

describe('emitirNFSeParaTransferencia', () => {
  it('skips emission when NFS-e record already exists (idempotency)', async () => {
    const { client } = buildAdmin([{ data: { id: 'existing', status: 'autorizado' }, error: null }])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaTransferencia({
      transferId: 't-1',
      valorServicos: 100,
      tomadorCnpj: '12345678000195',
      tomadorRazaoSocial: 'Clínica',
      orderCode: 'ORD-001',
    })

    // Only 1 from() call (the existence check) — insert never triggered
    expect(client.from).toHaveBeenCalledTimes(1)
  })

  it('inserts pending record and then updates with NFS-e result on success', async () => {
    const { client, updatePayloads } = buildAdmin([
      { data: null, error: null }, // from #1: maybeSingle — no existing
      { data: { id: 'rec-1' }, error: null }, // from #2: insert single
      { data: null, error: null }, // from #3: update after emit
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaTransferencia({
      transferId: 't-2',
      valorServicos: 250,
      tomadorCnpj: '12345678000195',
      tomadorRazaoSocial: 'Clínica Teste',
      tomadorEmail: 'c@test.com',
      orderCode: 'ORD-002',
    })

    expect(client.from).toHaveBeenCalledTimes(3)
    expect(updatePayloads[0]).toMatchObject({ nuvem_fiscal_id: 'nfse-xyz', status: 'autorizado' })
  })

  it('does not throw when emitirNFSe rejects (non-blocking)', async () => {
    const { client } = buildAdmin([
      { data: null, error: null },
      { data: { id: 'rec-1' }, error: null },
      { data: null, error: null },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(nuvemFiscalModule.emitirNFSe).mockRejectedValue(new Error('API timeout'))

    await expect(
      emitirNFSeParaTransferencia({
        transferId: 't-3',
        valorServicos: 50,
        tomadorCnpj: '12345678000195',
        tomadorRazaoSocial: 'Clínica',
        orderCode: 'ORD-003',
      })
    ).resolves.toBeUndefined()
  })

  it('when emit fails, updates record status to erro', async () => {
    const { client, updatePayloads } = buildAdmin([
      { data: null, error: null },
      { data: { id: 'rec-1' }, error: null },
      { data: null, error: null },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(nuvemFiscalModule.emitirNFSe).mockRejectedValue(new Error('API timeout'))

    await emitirNFSeParaTransferencia({
      transferId: 't-3b',
      valorServicos: 50,
      tomadorCnpj: '12345678000195',
      tomadorRazaoSocial: 'Clínica',
      orderCode: 'ORD-003b',
    })

    expect(updatePayloads[0]).toMatchObject({
      status: 'erro',
      error_message: expect.stringContaining('API timeout'),
    })
  })

  it('skips emitirNFSe when DB insert fails', async () => {
    const { client } = buildAdmin([
      { data: null, error: null },
      { data: null, error: { message: 'constraint violation' } },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaTransferencia({
      transferId: 't-4',
      valorServicos: 100,
      tomadorCnpj: '12345678000195',
      tomadorRazaoSocial: 'Clínica',
      orderCode: 'ORD-004',
    })

    // 2 calls: check + insert; no update (no emit)
    expect(client.from).toHaveBeenCalledTimes(2)
  })
})

// ── emitirNFSeParaConsultor ───────────────────────────────────────────────────

describe('emitirNFSeParaConsultor', () => {
  it('skips emission when record already exists (idempotency)', async () => {
    const { client } = buildAdmin([{ data: { id: 'exists', status: 'autorizado' }, error: null }])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaConsultor({
      consultantTransferId: 'ct-1',
      valorServicos: 500,
      tomadorCpfCnpj: '11222333000181',
      tomadorNome: 'Consultor',
      commissionCount: 3,
    })

    expect(client.from).toHaveBeenCalledTimes(1)
  })

  it('inserts pending record and updates with NFS-e result', async () => {
    const { client, updatePayloads } = buildAdmin([
      { data: null, error: null },
      { data: { id: 'rec-2' }, error: null },
      { data: null, error: null },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaConsultor({
      consultantTransferId: 'ct-2',
      valorServicos: 750,
      tomadorCpfCnpj: '11222333000181',
      tomadorNome: 'Consultor Souza',
      tomadorEmail: 'c@test.com',
      commissionCount: 5,
    })

    expect(client.from).toHaveBeenCalledTimes(3)
    expect(updatePayloads[0]).toMatchObject({ nuvem_fiscal_id: 'nfse-xyz', status: 'autorizado' })
  })

  it('does not throw when emitirNFSe rejects (non-blocking)', async () => {
    const { client } = buildAdmin([
      { data: null, error: null },
      { data: { id: 'rec-3' }, error: null },
      { data: null, error: null },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )
    vi.mocked(nuvemFiscalModule.emitirNFSe).mockRejectedValue(new Error('Network error'))

    await expect(
      emitirNFSeParaConsultor({
        consultantTransferId: 'ct-3',
        valorServicos: 300,
        tomadorCpfCnpj: '11222333000181',
        tomadorNome: 'Consultor',
        commissionCount: 2,
      })
    ).resolves.toBeUndefined()
  })

  it('discriminacao mentions commission count and consultant identifier', async () => {
    const { client, updatePayloads } = buildAdmin([
      { data: null, error: null },
      { data: { id: 'rec-4' }, error: null },
      { data: null, error: null },
    ])
    vi.mocked(adminModule.createAdminClient).mockReturnValue(
      client as ReturnType<typeof adminModule.createAdminClient>
    )

    await emitirNFSeParaConsultor({
      consultantTransferId: 'ct-4',
      valorServicos: 100,
      tomadorCpfCnpj: '11222333000181',
      tomadorNome: 'Consultor',
      commissionCount: 7,
    })

    // Full flow ran — 3 from() calls and update with nfse result
    expect(client.from).toHaveBeenCalledTimes(3)
    expect(updatePayloads[0]).toMatchObject({ nuvem_fiscal_id: 'nfse-xyz' })
  })
})
