/**
 * Pre-Launch Onda S2 / T4 — Clicksign webhook watchdog.
 *
 * Tests para `snapshotClicksignWatch`. Pattern: injeção do admin client
 * via opts (a função já aceita `adminClient`), evitando vi.mock de
 * `createAdminClient` — fica mais simples e testa o exato comportamento
 * que será chamado em produção.
 *
 * Cobre 6 cenários:
 *   1. Cenário OK — webhooks recebidos nas últimas 24h.
 *   2. Cenário silent_with_pending — 0 webhooks 24h + contratos aged > 0.
 *      Sinal forte de canal quebrado; deve emitir warn no log.
 *   3. Cenário silent_no_pending — 0 webhooks 24h, 0 contratos esperando.
 *      Normal em pre-launch sem volume.
 *   4. webhook_events vazio nos últimos 7 dias mas com delivery histórica
 *      → busca o último mesmo fora da janela de 7d para popular
 *      `lastReceivedAgeSeconds`.
 *   5. webhook_events nunca recebeu nada → `lastReceivedAgeSeconds = null`
 *      (cron transforma em -1 antes de empurrar pra Grafana).
 *   6. Falha de query SQL → outcome 'error' com detail populado, não joga.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { snapshotClicksignWatch, runClicksignWatch } from '@/lib/contracts/clicksign-watch'
import { logger } from '@/lib/logger'

interface WebhookRow {
  received_at: string
}

interface MockState {
  webhookEvents: WebhookRow[]
  webhookEventsError?: { message: string } | null
  /** Último delivery clicksign EVER (caso lookup-fallback). Se undefined,
   * o fallback retorna []. */
  webhookEventsAllTime?: WebhookRow[]
  contractsTotal: number
  contractsAged: number
  contractsTotalError?: { message: string } | null
  contractsAgedError?: { message: string } | null
}

/** Constrói um admin client stub que responde às 3-4 queries que
 * `snapshotClicksignWatch` faz, na ordem:
 *
 *   1. webhook_events: select(received_at) eq(source) gte(received_at) order limit
 *   2. (opcional) webhook_events: select(received_at) eq(source) order limit
 *   3. contracts: select count head, in(status)
 *   4. contracts: select count head, in(status) lte(created_at)
 */
function makeAdminStub(state: MockState) {
  let webhookEventsCallCount = 0
  let contractsCallCount = 0

  return {
    from(table: string) {
      if (table === 'webhook_events') {
        webhookEventsCallCount++
        const isFirstCall = webhookEventsCallCount === 1

        // Two-phase init para evitar TDZ — `select`/`eq`/etc retornam
        // o próprio builder; `limit` resolve com a data.
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        builder.eq = vi.fn(() => builder)
        builder.gte = vi.fn(() => builder)
        builder.order = vi.fn(() => builder)
        builder.limit = vi.fn().mockResolvedValue(
          isFirstCall
            ? {
                data: state.webhookEventsError ? null : state.webhookEvents,
                error: state.webhookEventsError ?? null,
              }
            : {
                data: state.webhookEventsAllTime ?? [],
                error: null,
              }
        )
        return builder
      }
      if (table === 'contracts') {
        contractsCallCount++
        const isTotal = contractsCallCount === 1

        // Pattern: a query .total termina em `.in(...)` (PostgREST
        // resolve a promise no terminator). A query .aged termina em
        // `.lte(...)`. Para casar com isso fazemos `.in()` retornar um
        // builder thenable quando isTotal=true; quando isTotal=false,
        // `.in()` continua chainable e o resultado vem via `.lte()`.
        const builder: Record<string, unknown> = {}
        builder.select = vi.fn(() => builder)
        if (isTotal) {
          // .in() é o terminator — retorna a promise direto.
          builder.in = vi.fn().mockResolvedValue({
            count: state.contractsTotal,
            error: state.contractsTotalError ?? null,
          })
        } else {
          // .in() chainable, .lte() terminator.
          builder.in = vi.fn(() => builder)
          builder.lte = vi.fn().mockResolvedValue({
            count: state.contractsAged,
            error: state.contractsAgedError ?? null,
          })
        }
        return builder
      }
      throw new Error(`Unexpected from(${table})`)
    },
  }
}

beforeEach(() => {
  vi.mocked(logger.warn).mockClear()
  vi.mocked(logger.error).mockClear()
  vi.mocked(logger.info).mockClear()
})

describe('snapshotClicksignWatch — happy path', () => {
  it('outcome=ok quando há webhooks nas últimas 24h', async () => {
    const now = Date.now()
    const stub = makeAdminStub({
      webhookEvents: [
        { received_at: new Date(now - 1000 * 3600).toISOString() }, // 1h atrás
        { received_at: new Date(now - 1000 * 3600 * 5).toISOString() }, // 5h atrás
        { received_at: new Date(now - 1000 * 3600 * 48).toISOString() }, // 2d atrás (fora 24h)
      ],
      contractsTotal: 0,
      contractsAged: 0,
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('ok')
    expect(snap.receivedCount24h).toBe(2)
    expect(snap.receivedCount7d).toBe(3)
    expect(snap.lastReceivedAgeSeconds).toBeGreaterThanOrEqual(3500)
    expect(snap.lastReceivedAgeSeconds).toBeLessThanOrEqual(3700)
    expect(snap.pendingContractsAged).toBe(0)
    expect(snap.pendingContractsTotal).toBe(0)
  })
})

describe('snapshotClicksignWatch — silent_with_pending', () => {
  it('detecta canal silente com contratos esperando há > 6h', async () => {
    const now = Date.now()
    const stub = makeAdminStub({
      webhookEvents: [
        { received_at: new Date(now - 1000 * 3600 * 48).toISOString() }, // último: 2d atrás (fora 24h)
      ],
      contractsTotal: 3,
      contractsAged: 2, // 2 esperando > 6h
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('silent_with_pending')
    expect(snap.receivedCount24h).toBe(0)
    expect(snap.pendingContractsAged).toBe(2)
    expect(snap.pendingContractsTotal).toBe(3)
    expect(snap.detail).toContain('aguardando assinatura')
    expect(snap.detail).toContain('0 webhooks em 24h')
  })

  it('runClicksignWatch loga warn quando outcome=silent_with_pending', async () => {
    // Sem injeção: testa o caminho que vai pra produção via cron.
    // Mock do createAdminClient inteiro pra esse teste único.
    vi.resetModules()
    vi.doMock('@/lib/db/admin', () => ({
      createAdminClient: () =>
        makeAdminStub({
          webhookEvents: [],
          contractsTotal: 1,
          contractsAged: 1,
        }) as never,
    }))
    const { runClicksignWatch: runFresh } = await import('@/lib/contracts/clicksign-watch')

    const snap = await runFresh()
    expect(snap.outcome).toBe('silent_with_pending')
    expect(logger.warn).toHaveBeenCalledWith(
      '[clicksign-watch] webhook channel may be silent',
      expect.objectContaining({ pendingContractsAged: 1, receivedCount24h: 0 })
    )

    vi.doUnmock('@/lib/db/admin')
  })
})

describe('snapshotClicksignWatch — silent_no_pending', () => {
  it('outcome=silent_no_pending em pre-launch (zero contratos)', async () => {
    const stub = makeAdminStub({
      webhookEvents: [],
      contractsTotal: 0,
      contractsAged: 0,
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('silent_no_pending')
    expect(snap.receivedCount24h).toBe(0)
    expect(snap.pendingContractsTotal).toBe(0)
    expect(snap.pendingContractsAged).toBe(0)
  })
})

describe('snapshotClicksignWatch — fallback last_received', () => {
  it('busca último delivery EVER quando vazio nos últimos 7 dias', async () => {
    const now = Date.now()
    const stub = makeAdminStub({
      webhookEvents: [], // vazio na janela de 7d
      webhookEventsAllTime: [
        // último delivery foi há 30 dias
        { received_at: new Date(now - 1000 * 3600 * 24 * 30).toISOString() },
      ],
      contractsTotal: 0,
      contractsAged: 0,
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('silent_no_pending')
    expect(snap.receivedCount7d).toBe(0)
    // 30d ≈ 2_592_000s (margem de 1min)
    expect(snap.lastReceivedAgeSeconds).toBeGreaterThan(2_500_000)
    expect(snap.lastReceivedAgeSeconds).toBeLessThan(2_700_000)
  })

  it('lastReceivedAgeSeconds=null quando nunca houve delivery', async () => {
    const stub = makeAdminStub({
      webhookEvents: [],
      webhookEventsAllTime: [],
      contractsTotal: 0,
      contractsAged: 0,
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.lastReceivedAgeSeconds).toBeNull()
  })
})

describe('snapshotClicksignWatch — error paths', () => {
  it('retorna outcome=error quando webhook_events query falha', async () => {
    const stub = makeAdminStub({
      webhookEvents: [],
      webhookEventsError: { message: 'connection refused' },
      contractsTotal: 0,
      contractsAged: 0,
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('error')
    expect(snap.detail).toContain('webhook_events query failed')
    expect(snap.detail).toContain('connection refused')
  })

  it('retorna outcome=error quando contracts.aged query falha', async () => {
    const stub = makeAdminStub({
      webhookEvents: [{ received_at: new Date().toISOString() }],
      contractsTotal: 5,
      contractsAged: 0,
      contractsAgedError: { message: 'timeout' },
    })

    const snap = await snapshotClicksignWatch({
      adminClient: stub as never,
    })

    expect(snap.outcome).toBe('error')
    expect(snap.detail).toContain('contracts aged query failed')
    expect(snap.detail).toContain('timeout')
    // Mas valores que JÁ foram coletados são preservados:
    expect(snap.receivedCount24h).toBe(1)
  })
})
