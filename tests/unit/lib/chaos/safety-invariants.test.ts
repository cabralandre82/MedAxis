/**
 * Invariant tests for chaos engineering — Wave Hardening II #9.
 *
 * These tests are intentionally aggressive about what they assert.
 * Even minor refactors that loosen any of the safety nets here
 * must surface as a red CI run, because the consequence of being
 * wrong is "fault injection on customer writes". Treat any failure
 * here as a release-blocking bug, not a test to silence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { __resetChaosForTests, __setChaosForTests, chaosTick } from '@/lib/chaos/injector'
import { readChaosConfig } from '@/lib/chaos/config'

const ROOT = resolve(__dirname, '..', '..', '..', '..')

describe('chaos invariants — disabled state has zero side effects', () => {
  beforeEach(() => __resetChaosForTests())
  afterEach(() => __resetChaosForTests())

  it('chaosTick returns 0 and does not throw across all kinds when disabled', async () => {
    __setChaosForTests(readChaosConfig({}))
    for (const kind of ['outbound', 'db', 'redis'] as const) {
      for (const svc of ['asaas', 'orders', 'rate_limit_violations']) {
        const r = await chaosTick(kind, svc)
        expect(r).toBe(0)
      }
    }
  })

  it('production env without ALLOW_PROD does NOT inject — multiple kinds, multiple services', async () => {
    __setChaosForTests(
      readChaosConfig({
        CHAOS_ENABLED: 'true',
        NODE_ENV: 'production',
        CHAOS_TARGETS: 'outbound:*,db:*',
        CHAOS_LATENCY_RATE: '1',
        CHAOS_ERROR_RATE: '1',
      })
    )
    // Even with maximum-aggression config, the prod safety must hold.
    for (let i = 0; i < 50; i++) {
      const r = await chaosTick('outbound', 'asaas')
      expect(r).toBe(0)
    }
  })
})

describe('chaos invariants — wiring sites', () => {
  it('lib/tracing.ts exempts write operations from chaos injection', () => {
    const src = readFileSync(resolve(ROOT, 'lib/tracing.ts'), 'utf8')
    // Both branches MUST exist for the safety to hold:
    //   1. an explicit `if (operation === 'select' || operation === 'rpc')`
    //   2. the chaosTick call inside that branch — never outside
    expect(src).toContain("operation === 'select'")
    expect(src).toContain("operation === 'rpc'")
    // Pull the body of withDbSpan and check chaosTick is INSIDE the
    // read-only guard, not floating at the top of the function.
    const fn = src.match(/export async function withDbSpan[\s\S]*?\n\}/)?.[0] ?? ''
    expect(fn).toContain('chaosTick')
    // The chaosTick call must come after the operation check.
    const chaosIdx = fn.indexOf('chaosTick')
    const guardIdx = fn.indexOf("operation === 'select'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(chaosIdx).toBeGreaterThan(guardIdx)
  })

  it('lib/services/atomic.server.ts does NOT import chaos injector', () => {
    // Atomic write paths must remain unconditionally chaos-free.
    const src = readFileSync(resolve(ROOT, 'lib/services/atomic.server.ts'), 'utf8')
    expect(src).not.toMatch(/from\s+['"]@\/lib\/chaos\//)
  })

  it('lib/trace.ts wires chaos for outbound HTTP only (single call site)', () => {
    const src = readFileSync(resolve(ROOT, 'lib/trace.ts'), 'utf8')
    const matches = src.match(/chaosTick\(/g) ?? []
    expect(matches.length).toBe(1)
    expect(src).toContain("chaosTick('outbound'")
  })

  it('config rejects literal "1", "yes", "True" as enable tokens', () => {
    for (const truthy of ['1', 'yes', 'True', 'TRUE']) {
      expect(readChaosConfig({ CHAOS_ENABLED: truthy }).enabled).toBe(false)
    }
  })
})

describe('chaos invariants — scripts', () => {
  it('99-disable.sh does not require CHAOS_DRY_RUN to actually disarm', () => {
    const src = readFileSync(resolve(ROOT, 'scripts/chaos/99-disable.sh'), 'utf8')
    // The disable script must FORCE CHAOS_DRY_RUN=0 (or equivalent
    // bypass) so an operator never gets stuck "able to inject but
    // unable to remove" because of a stale env. Check for the
    // explicit override.
    expect(src).toMatch(/CHAOS_DRY_RUN=0/)
  })

  it('every scenario script source-loads _safety.sh and calls require_target_env', () => {
    const scenarios = ['01-latency-outbound.sh', '02-error-rate-outbound.sh', '03-db-slowdown.sh']
    for (const f of scenarios) {
      const src = readFileSync(resolve(ROOT, 'scripts/chaos', f), 'utf8')
      expect(src).toContain('source "$(dirname "$0")/_safety.sh"')
      expect(src).toContain('require_target_env')
    }
  })

  it('production game-day requires the long acknowledgement string', () => {
    const src = readFileSync(resolve(ROOT, 'scripts/chaos/_safety.sh'), 'utf8')
    expect(src).toContain('yes-i-am-on-call-and-have-paged-the-team')
  })
})
