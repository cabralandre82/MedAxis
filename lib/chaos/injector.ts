/**
 * Chaos engineering — runtime injector.
 *
 * Wave Hardening II — task **#9**.
 *
 * The injector is intentionally microscopic in surface area. Two
 * call points, both fire-and-forget if chaos is disarmed:
 *
 *   • `await maybeInjectLatency(kind, service)`  — sleeps a random
 *     amount when the latency probability fires for this target.
 *   • `maybeInjectError(kind, service): Error | null` — returns a
 *     synthetic Error to throw OR `null` if no injection. The caller
 *     decides how to translate the error (e.g. `fetchWithTrace`
 *     throws it directly so the metric path matches a real
 *     network failure exactly).
 *
 * Both helpers degrade to a sub-microsecond `if (config.enabled)`
 * check when chaos is disabled (the common case). Metrics are
 * recorded on every injection so SLO dashboards can see exactly how
 * much pain we manufactured during a game-day.
 *
 * Determinism: when `CHAOS_SEED` is set we use a tiny SplitMix64
 * PRNG. Tests rely on this so probability assertions are stable.
 *
 * @module lib/chaos/injector
 */

import { incCounter, observeHistogram, Metrics } from '@/lib/metrics'
import { matchesTarget, readChaosConfig, type ChaosConfig, type ChaosKind } from './config'

/** Cached config — re-read on every call to `chaosConfigForRequest`,
 *  but we keep a single instance per process to avoid the parse cost
 *  on the hot path. Tests can call `__resetChaosForTests()` to clear. */
let _cached: ChaosConfig | null = null

/** Test-only PRNG state (SplitMix64). Production uses `Math.random`. */
let _prngState: bigint | null = null

// SplitMix64 constants. We construct them with BigInt() at module
// load instead of using `123n` literals so this file compiles under
// the project's ES2017 target (BigInt *runtime* is fine on Node 10+
// and Edge — only the literal syntax requires ES2020).
const SPLITMIX_INC = BigInt('0x9e3779b97f4a7c15')
const SPLITMIX_M1 = BigInt('0xbf58476d1ce4e5b9')
const SPLITMIX_M2 = BigInt('0x94d049bb133111eb')
const U64_MASK = BigInt('0xffffffffffffffff')
const SHIFT_30 = BigInt(30)
const SHIFT_27 = BigInt(27)
const SHIFT_31 = BigInt(31)
const SHIFT_11 = BigInt(11)
const ONE = BigInt(1)

function ensureConfig(): ChaosConfig {
  if (_cached === null) {
    _cached = readChaosConfig()
    if (_cached.seed !== null) _prngState = BigInt(_cached.seed) | ONE
  }
  return _cached
}

/** Pseudo-random in [0, 1). Uses SplitMix64 when seeded (tests),
 *  Math.random otherwise (prod). */
function rand(): number {
  if (_prngState === null) return Math.random()
  // SplitMix64
  _prngState = (_prngState + SPLITMIX_INC) & U64_MASK
  let z = _prngState
  z = ((z ^ (z >> SHIFT_30)) * SPLITMIX_M1) & U64_MASK
  z = ((z ^ (z >> SHIFT_27)) * SPLITMIX_M2) & U64_MASK
  z = z ^ (z >> SHIFT_31)
  // Take top 53 bits as a JS-safe float in [0, 1).
  return Number(z >> SHIFT_11) / 2 ** 53
}

/** Test-only: reset the cached config + PRNG state. */
export function __resetChaosForTests(): void {
  _cached = null
  _prngState = null
}

/** Test-only: forcibly install a config (skips env parsing). */
export function __setChaosForTests(config: ChaosConfig | null): void {
  _cached = config
  if (config?.seed != null) _prngState = BigInt(config.seed) | ONE
  else _prngState = null
}

/** Public: read the active config (cached). */
export function getChaosConfig(): ChaosConfig {
  return ensureConfig()
}

/**
 * Possibly sleep a random amount of milliseconds. Returns the actual
 * delay applied (`0` if no injection). Always async — callers can
 * `await` unconditionally without an `if` branch on the hot path.
 */
export async function maybeInjectLatency(kind: ChaosKind, service: string): Promise<number> {
  const config = ensureConfig()
  if (!matchesTarget(config, kind, service)) return 0
  if (config.latency.rate <= 0) return 0
  if (rand() >= config.latency.rate) return 0

  const span = config.latency.maxMs - config.latency.minMs
  const delay = config.latency.minMs + Math.floor(rand() * (span + 1))
  if (delay <= 0) {
    // Still record the *attempt* so the dashboard shows the firing
    // rate even when min/max=0 (sometimes intentional in canaries).
    incCounter(Metrics.CHAOS_INJECTION_TOTAL, { kind, service, action: 'latency_zero' })
    return 0
  }

  await new Promise((resolve) => setTimeout(resolve, delay))
  incCounter(Metrics.CHAOS_INJECTION_TOTAL, { kind, service, action: 'latency' })
  observeHistogram(Metrics.CHAOS_INJECTION_LATENCY_MS, delay, { kind, service })
  return delay
}

/**
 * Possibly produce a synthetic error. Returns the Error to throw, or
 * `null` for no injection. The caller throws — keeping the throw at
 * the call site preserves the original stack and makes greps for
 * "where does this error type originate" still find one location.
 */
export function maybeInjectError(kind: ChaosKind, service: string): Error | null {
  const config = ensureConfig()
  if (!matchesTarget(config, kind, service)) return null
  if (config.error.rate <= 0) return null
  if (rand() >= config.error.rate) return null

  incCounter(Metrics.CHAOS_INJECTION_TOTAL, {
    kind,
    service,
    action: config.error.kind === 'timeout' ? 'error_timeout' : 'error_network',
  })

  if (config.error.kind === 'timeout') {
    const err = new Error('chaos: synthetic fetch timeout') as Error & { name: string }
    err.name = 'AbortError'
    return err
  }
  const err = new Error('chaos: synthetic network error') as Error & { code: string }
  err.code = 'ECONNRESET'
  return err
}

/**
 * Convenience helper for call sites that want both checks in a
 * single line. Sleeps if a latency injection fires; throws if an
 * error injection fires. Returns the latency delay (or 0).
 *
 * Layered ordering matters: latency BEFORE error so a test scenario
 * that wants "slow-then-fail" can observe both effects. Reverse
 * ordering would let an injected error skip the sleep.
 */
export async function chaosTick(kind: ChaosKind, service: string): Promise<number> {
  const delay = await maybeInjectLatency(kind, service)
  const err = maybeInjectError(kind, service)
  if (err) throw err
  return delay
}
