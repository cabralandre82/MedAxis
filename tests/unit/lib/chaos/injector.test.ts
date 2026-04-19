import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  __resetChaosForTests,
  __setChaosForTests,
  chaosTick,
  maybeInjectError,
  maybeInjectLatency,
} from '@/lib/chaos/injector'
import { readChaosConfig } from '@/lib/chaos/config'

function env(...pairs: [string, string][]): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {}
  for (const [k, v] of pairs) e[k] = v
  return e
}

describe('chaos/injector — disarmed (default)', () => {
  beforeEach(async () => {
    __resetChaosForTests()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
    __setChaosForTests(readChaosConfig({}))
  })

  afterEach(() => {
    __resetChaosForTests()
  })

  it('maybeInjectLatency returns 0 immediately', async () => {
    const t0 = Date.now()
    const delay = await maybeInjectLatency('outbound', 'asaas')
    expect(delay).toBe(0)
    expect(Date.now() - t0).toBeLessThan(20)
  })

  it('maybeInjectError returns null', () => {
    expect(maybeInjectError('outbound', 'asaas')).toBeNull()
  })

  it('chaosTick is a no-op (no throw, no sleep)', async () => {
    const t0 = Date.now()
    await expect(chaosTick('outbound', 'asaas')).resolves.toBe(0)
    expect(Date.now() - t0).toBeLessThan(20)
  })

  it('emits ZERO chaos metrics when disarmed', async () => {
    const { snapshotMetrics } = await import('@/lib/metrics')
    await chaosTick('outbound', 'asaas')
    await chaosTick('db', 'orders')
    const snap = snapshotMetrics()
    const chaosCounters = snap.counters.filter((c) => c.name.startsWith('chaos_injection'))
    expect(chaosCounters.length).toBe(0)
  })
})

describe('chaos/injector — latency injection (seeded)', () => {
  beforeEach(async () => {
    __resetChaosForTests()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
    __setChaosForTests(
      readChaosConfig(
        env(
          ['CHAOS_ENABLED', 'true'],
          ['CHAOS_TARGETS', 'outbound:asaas'],
          ['CHAOS_LATENCY_RATE', '1'], // always
          ['CHAOS_LATENCY_MS_MIN', '10'],
          ['CHAOS_LATENCY_MS_MAX', '30'],
          ['CHAOS_SEED', '42']
        )
      )
    )
  })

  afterEach(() => __resetChaosForTests())

  it('sleeps within [min, max] when target matches and rate=1', async () => {
    const t0 = Date.now()
    const delay = await maybeInjectLatency('outbound', 'asaas')
    const elapsed = Date.now() - t0
    expect(delay).toBeGreaterThanOrEqual(10)
    expect(delay).toBeLessThanOrEqual(30)
    // setTimeout drift on CI can be ±10 ms — allow generous slack.
    expect(elapsed).toBeGreaterThanOrEqual(8)
  })

  it('does not inject for a non-matching service', async () => {
    const delay = await maybeInjectLatency('outbound', 'clicksign')
    expect(delay).toBe(0)
  })

  it('records chaos_injection_total counter on injection', async () => {
    const { snapshotMetrics } = await import('@/lib/metrics')
    await maybeInjectLatency('outbound', 'asaas')
    const snap = snapshotMetrics()
    const counter = snap.counters.find(
      (c) =>
        c.name === 'chaos_injection_total' &&
        c.labels.kind === 'outbound' &&
        c.labels.service === 'asaas' &&
        c.labels.action === 'latency'
    )
    expect(counter?.value).toBeGreaterThanOrEqual(1)
  })
})

describe('chaos/injector — error injection', () => {
  beforeEach(async () => {
    __resetChaosForTests()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
  })

  afterEach(() => __resetChaosForTests())

  it('returns network error with ECONNRESET code when error.kind=network', () => {
    __setChaosForTests(
      readChaosConfig(
        env(
          ['CHAOS_ENABLED', 'true'],
          ['CHAOS_TARGETS', 'outbound:*'],
          ['CHAOS_ERROR_RATE', '1'],
          ['CHAOS_ERROR_KIND', 'network'],
          ['CHAOS_SEED', '123']
        )
      )
    )
    const err = maybeInjectError('outbound', 'asaas') as (Error & { code?: string }) | null
    expect(err).toBeInstanceOf(Error)
    expect(err?.code).toBe('ECONNRESET')
  })

  it('returns AbortError when error.kind=timeout', () => {
    __setChaosForTests(
      readChaosConfig(
        env(
          ['CHAOS_ENABLED', 'true'],
          ['CHAOS_TARGETS', 'outbound:*'],
          ['CHAOS_ERROR_RATE', '1'],
          ['CHAOS_ERROR_KIND', 'timeout'],
          ['CHAOS_SEED', '123']
        )
      )
    )
    const err = maybeInjectError('outbound', 'asaas')
    expect(err?.name).toBe('AbortError')
  })

  it('chaosTick throws the synthetic error', async () => {
    __setChaosForTests(
      readChaosConfig(
        env(
          ['CHAOS_ENABLED', 'true'],
          ['CHAOS_TARGETS', 'outbound:asaas'],
          ['CHAOS_ERROR_RATE', '1'],
          ['CHAOS_SEED', '7']
        )
      )
    )
    await expect(chaosTick('outbound', 'asaas')).rejects.toThrow(/chaos: synthetic/)
  })
})

describe('chaos/injector — probabilistic distribution (seeded)', () => {
  beforeEach(async () => {
    __resetChaosForTests()
    const { __resetMetricsForTests } = await import('@/lib/metrics')
    __resetMetricsForTests()
  })

  afterEach(() => __resetChaosForTests())

  it('with rate=0.5 and seed, fires roughly half the time across a thousand draws', () => {
    __setChaosForTests(
      readChaosConfig(
        env(
          ['CHAOS_ENABLED', 'true'],
          ['CHAOS_TARGETS', 'outbound:asaas'],
          ['CHAOS_ERROR_RATE', '0.5'],
          ['CHAOS_SEED', '999']
        )
      )
    )
    let fired = 0
    for (let i = 0; i < 1000; i++) {
      if (maybeInjectError('outbound', 'asaas')) fired++
    }
    // SplitMix64 on 1000 draws should land within ±5% of expected;
    // the looser bound (±10%) catches obvious bugs without being
    // flaky across runtimes.
    expect(fired).toBeGreaterThanOrEqual(400)
    expect(fired).toBeLessThanOrEqual(600)
  })

  it('seeded runs are reproducible', () => {
    function countErrors(): number {
      __resetChaosForTests()
      __setChaosForTests(
        readChaosConfig(
          env(
            ['CHAOS_ENABLED', 'true'],
            ['CHAOS_TARGETS', 'outbound:asaas'],
            ['CHAOS_ERROR_RATE', '0.5'],
            ['CHAOS_SEED', '12345']
          )
        )
      )
      let n = 0
      for (let i = 0; i < 200; i++) if (maybeInjectError('outbound', 'asaas')) n++
      return n
    }
    expect(countErrors()).toBe(countErrors())
  })
})
