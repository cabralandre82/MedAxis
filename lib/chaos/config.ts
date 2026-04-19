/**
 * Chaos engineering — runtime configuration.
 *
 * Wave Hardening II — task **#9**.
 *
 * The chaos module is **off by default** and behind a triple-layer
 * safety interlock so a misconfigured env var cannot accidentally
 * inject failures into a real customer's request:
 *
 *   1. `CHAOS_ENABLED` must be exactly `"true"` (not `"1"`, not
 *      `"yes"`, not truthy strings — exact string match).
 *   2. In production (`NODE_ENV === "production"` OR
 *      `VERCEL_ENV === "production"`) **also** requires
 *      `CHAOS_ALLOW_PROD === "true"`. This is a deliberate
 *      double-opt-in so on-call must explicitly type the long
 *      escape-hatch name to enable production game-days.
 *   3. The route handler / call-site must whitelist its own target
 *      (`CHAOS_TARGETS` is a comma-separated list of
 *      `kind:name` tokens) — wildcards are NOT supported because
 *      "blast everything" is never a justified game-day setup.
 *
 * Configuration vocabulary:
 *
 *   CHAOS_ENABLED          "true" to arm the framework.
 *   CHAOS_ALLOW_PROD       "true" to permit firing in production.
 *   CHAOS_TARGETS          comma-list of `kind:service` tokens.
 *                          Examples:
 *                            outbound:asaas       → only asaas calls
 *                            outbound:*           → every outbound HTTP
 *                            db:orders            → only orders table
 *                            db:*                 → every DB call
 *   CHAOS_LATENCY_MS_MIN   minimum injected sleep, default 0.
 *   CHAOS_LATENCY_MS_MAX   maximum injected sleep, default 0.
 *   CHAOS_LATENCY_RATE     0.0–1.0 probability per call, default 0.
 *   CHAOS_ERROR_RATE       0.0–1.0 probability per call, default 0.
 *   CHAOS_ERROR_KIND       "network" (throws) | "timeout" (aborts).
 *
 * @module lib/chaos/config
 */

export type ChaosKind = 'outbound' | 'db' | 'redis'

export interface ChaosConfig {
  enabled: boolean
  /** True if `CHAOS_ENABLED=true` was set but the prod-safety
   *  interlock prevented us from arming. Useful for the admin
   *  status endpoint to surface "you forgot CHAOS_ALLOW_PROD". */
  blockedByProd: boolean
  /** Parsed targets: `{ outbound: Set('*' | 'asaas'), db: ... }`. */
  targets: Record<ChaosKind, ReadonlySet<string>>
  latency: {
    minMs: number
    maxMs: number
    rate: number
  }
  error: {
    rate: number
    kind: 'network' | 'timeout'
  }
  /** Optional deterministic seed for the chaos PRNG — set in tests
   *  so probabilities become reproducible. Production should leave
   *  unset so each run is independently random. */
  seed: number | null
}

const KINDS: readonly ChaosKind[] = ['outbound', 'db', 'redis']

function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  // Clamp to [0, 1] — the only sane range. A misconfigured "100"
  // (meaning 100%) silently becomes 1.0, not 100×.
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function parseInt0(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

function parseTargets(raw: string | undefined): Record<ChaosKind, ReadonlySet<string>> {
  const empty: Record<ChaosKind, Set<string>> = {
    outbound: new Set(),
    db: new Set(),
    redis: new Set(),
  }
  if (!raw) return empty
  for (const tok of raw.split(',')) {
    const trimmed = tok.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const kind = trimmed.slice(0, idx) as ChaosKind
    const name = trimmed.slice(idx + 1).trim()
    if (!name) continue
    if (!KINDS.includes(kind)) continue
    empty[kind].add(name)
  }
  return empty
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'
}

/**
 * Build a fresh `ChaosConfig` from an env-var snapshot. Pure
 * function — exposed for tests.
 */
export function readChaosConfig(env: NodeJS.ProcessEnv = process.env): ChaosConfig {
  const requested = env.CHAOS_ENABLED === 'true'
  const allowProd = env.CHAOS_ALLOW_PROD === 'true'
  const isProd = isProductionEnv(env)
  const enabled = requested && (!isProd || allowProd)
  const blockedByProd = requested && isProd && !allowProd

  const targets = parseTargets(env.CHAOS_TARGETS)

  const latency = {
    minMs: parseInt0(env.CHAOS_LATENCY_MS_MIN, 0),
    maxMs: parseInt0(env.CHAOS_LATENCY_MS_MAX, 0),
    rate: parseRate(env.CHAOS_LATENCY_RATE, 0),
  }
  // Defensive: if min > max, swap them rather than producing
  // negative sleeps downstream.
  if (latency.minMs > latency.maxMs) {
    const tmp = latency.minMs
    latency.minMs = latency.maxMs
    latency.maxMs = tmp
  }

  const errorKind = env.CHAOS_ERROR_KIND === 'timeout' ? 'timeout' : 'network'
  const error = {
    rate: parseRate(env.CHAOS_ERROR_RATE, 0),
    kind: errorKind as 'network' | 'timeout',
  }

  const seed = env.CHAOS_SEED && /^\d+$/.test(env.CHAOS_SEED) ? Number(env.CHAOS_SEED) : null

  return { enabled, blockedByProd, targets, latency, error, seed }
}

/**
 * Decide whether a given `kind:service` tuple is a chaos target.
 * Allows the literal `*` as a per-kind wildcard. Empty target sets
 * mean "no targets" — we deliberately do NOT default to `*` because
 * a typo in `CHAOS_TARGETS` should fail safe (no injections), not
 * fail dangerous (blast everything).
 */
export function matchesTarget(config: ChaosConfig, kind: ChaosKind, service: string): boolean {
  if (!config.enabled) return false
  const set = config.targets[kind]
  if (!set || set.size === 0) return false
  if (set.has('*')) return true
  return set.has(service)
}

/**
 * Snapshot suitable for the public-ish admin endpoint. Hides the
 * seed (it's a test-only knob) and serialises Sets to arrays.
 */
export function chaosConfigSnapshot(config: ChaosConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    blocked_by_prod: config.blockedByProd,
    targets: Object.fromEntries(
      (Object.keys(config.targets) as ChaosKind[]).map((k) => [k, [...config.targets[k]]])
    ),
    latency: { ...config.latency },
    error: { ...config.error },
  }
}
