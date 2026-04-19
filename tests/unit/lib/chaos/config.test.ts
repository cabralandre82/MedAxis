import { describe, it, expect } from 'vitest'
import { chaosConfigSnapshot, matchesTarget, readChaosConfig } from '@/lib/chaos/config'

function env(...pairs: [string, string][]): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {}
  for (const [k, v] of pairs) e[k] = v
  return e
}

describe('readChaosConfig — defaults & safety', () => {
  it('disabled by default with empty env', () => {
    const c = readChaosConfig({})
    expect(c.enabled).toBe(false)
    expect(c.blockedByProd).toBe(false)
    expect(c.targets.outbound.size).toBe(0)
    expect(c.latency.rate).toBe(0)
    expect(c.error.rate).toBe(0)
  })

  it('CHAOS_ENABLED only accepts the literal string "true"', () => {
    for (const truthy of ['1', 'yes', 'TRUE', 'True', 'on']) {
      const c = readChaosConfig(env(['CHAOS_ENABLED', truthy]))
      expect(c.enabled).toBe(false)
    }
    expect(readChaosConfig(env(['CHAOS_ENABLED', 'true'])).enabled).toBe(true)
  })

  it('refuses to enable in production without CHAOS_ALLOW_PROD', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['NODE_ENV', 'production']))
    expect(c.enabled).toBe(false)
    expect(c.blockedByProd).toBe(true)
  })

  it('refuses to enable when VERCEL_ENV=production without ALLOW_PROD', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['VERCEL_ENV', 'production']))
    expect(c.enabled).toBe(false)
    expect(c.blockedByProd).toBe(true)
  })

  it('allows production firing when CHAOS_ALLOW_PROD=true', () => {
    const c = readChaosConfig(
      env(['CHAOS_ENABLED', 'true'], ['CHAOS_ALLOW_PROD', 'true'], ['NODE_ENV', 'production'])
    )
    expect(c.enabled).toBe(true)
    expect(c.blockedByProd).toBe(false)
  })
})

describe('readChaosConfig — targets', () => {
  it('parses comma-separated kind:name tokens', () => {
    const c = readChaosConfig(
      env(['CHAOS_ENABLED', 'true'], ['CHAOS_TARGETS', 'outbound:asaas,db:orders,outbound:*'])
    )
    expect(c.targets.outbound.has('asaas')).toBe(true)
    expect(c.targets.outbound.has('*')).toBe(true)
    expect(c.targets.db.has('orders')).toBe(true)
    expect(c.targets.redis.size).toBe(0)
  })

  it('ignores unknown kinds and malformed tokens', () => {
    const c = readChaosConfig(
      env(['CHAOS_ENABLED', 'true'], ['CHAOS_TARGETS', 'foo:bar,baz,db:,:asaas'])
    )
    expect(c.targets.outbound.size).toBe(0)
    expect(c.targets.db.size).toBe(0)
  })

  it('ignores whitespace and empty entries', () => {
    const c = readChaosConfig(
      env(['CHAOS_ENABLED', 'true'], ['CHAOS_TARGETS', ' outbound:asaas , , db:orders '])
    )
    expect(c.targets.outbound.has('asaas')).toBe(true)
    expect(c.targets.db.has('orders')).toBe(true)
  })
})

describe('readChaosConfig — latency and error rates', () => {
  it('clamps rate to [0, 1]', () => {
    const a = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_LATENCY_RATE', '-0.5']))
    expect(a.latency.rate).toBe(0)
    const b = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_LATENCY_RATE', '5']))
    expect(b.latency.rate).toBe(1)
  })

  it('parses min/max latency and swaps them when min > max', () => {
    const c = readChaosConfig(
      env(
        ['CHAOS_ENABLED', 'true'],
        ['CHAOS_LATENCY_MS_MIN', '900'],
        ['CHAOS_LATENCY_MS_MAX', '100']
      )
    )
    expect(c.latency.minMs).toBe(100)
    expect(c.latency.maxMs).toBe(900)
  })

  it('rejects invalid numbers and falls back to default', () => {
    const c = readChaosConfig(
      env(
        ['CHAOS_ENABLED', 'true'],
        ['CHAOS_LATENCY_MS_MIN', 'NaN'],
        ['CHAOS_LATENCY_RATE', 'banana']
      )
    )
    expect(c.latency.minMs).toBe(0)
    expect(c.latency.rate).toBe(0)
  })

  it('error.kind defaults to network', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true']))
    expect(c.error.kind).toBe('network')
  })

  it('error.kind=timeout is honoured', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_ERROR_KIND', 'timeout']))
    expect(c.error.kind).toBe('timeout')
  })

  it('rejects non-numeric CHAOS_SEED', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_SEED', 'abc']))
    expect(c.seed).toBeNull()
  })

  it('accepts numeric CHAOS_SEED', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_SEED', '42']))
    expect(c.seed).toBe(42)
  })
})

describe('matchesTarget', () => {
  function build(targets: string): ReturnType<typeof readChaosConfig> {
    return readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['CHAOS_TARGETS', targets]))
  }

  it('returns false when chaos disabled even if targets match', () => {
    const c = readChaosConfig(env(['CHAOS_TARGETS', 'outbound:*']))
    expect(matchesTarget(c, 'outbound', 'anything')).toBe(false)
  })

  it('matches exact service name', () => {
    expect(matchesTarget(build('outbound:asaas'), 'outbound', 'asaas')).toBe(true)
    expect(matchesTarget(build('outbound:asaas'), 'outbound', 'clicksign')).toBe(false)
  })

  it('honours wildcard *', () => {
    const c = build('outbound:*')
    expect(matchesTarget(c, 'outbound', 'asaas')).toBe(true)
    expect(matchesTarget(c, 'outbound', 'novel-service')).toBe(true)
    expect(matchesTarget(c, 'db', 'orders')).toBe(false)
  })

  it('returns false for empty target set (typo guard)', () => {
    const c = build('')
    expect(matchesTarget(c, 'outbound', 'asaas')).toBe(false)
  })
})

describe('chaosConfigSnapshot', () => {
  it('serialises sets to arrays and omits the seed', () => {
    const c = readChaosConfig(
      env(['CHAOS_ENABLED', 'true'], ['CHAOS_TARGETS', 'outbound:asaas,db:*'], ['CHAOS_SEED', '7'])
    )
    const snap = chaosConfigSnapshot(c)
    expect(snap.enabled).toBe(true)
    expect((snap.targets as Record<string, string[]>).outbound).toEqual(['asaas'])
    expect((snap.targets as Record<string, string[]>).db).toEqual(['*'])
    expect('seed' in snap).toBe(false)
  })

  it('exposes blocked_by_prod for operator visibility', () => {
    const c = readChaosConfig(env(['CHAOS_ENABLED', 'true'], ['NODE_ENV', 'production']))
    const snap = chaosConfigSnapshot(c)
    expect(snap.enabled).toBe(false)
    expect(snap.blocked_by_prod).toBe(true)
  })
})
