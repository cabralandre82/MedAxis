/**
 * Vercel REST client — Wave 15.
 *
 * Thin server-only wrapper around the Vercel API endpoints we need
 * for secret rotation. Lives in `lib/secrets/` because today the
 * cron is the only caller, but it's structured so future waves
 * (e.g. release automation) can `import { vercel } from '@/lib/secrets/vercel'`.
 *
 * Endpoints we use
 * ----------------
 *   GET    /v9/projects/:projectId/env                 — list env vars + ids
 *   PATCH  /v9/projects/:projectId/env/:envId          — update value
 *   POST   /v13/deployments                            — trigger redeploy
 *
 * Why not generate from OpenAPI?
 *   Vercel's OpenAPI spec is enormous; we exercise four operations.
 *   Hand-rolled keeps test surface minimal and forces explicit
 *   handling of every documented error.
 *
 * Auth: every request carries `Authorization: Bearer ${VERCEL_TOKEN}`
 * and (for team projects) `?teamId=${VERCEL_TEAM_ID}` as a query
 * parameter. Both come from `process.env`. Missing env vars throw
 * a typed error so the cron can record a structured rotation
 * failure rather than a stack trace.
 *
 * @module lib/secrets/vercel
 */

import 'server-only'
import { createHash } from 'node:crypto'

const API_BASE = 'https://api.vercel.com'

export class VercelApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly body: string
  ) {
    super(`Vercel API ${status} on ${endpoint}: ${body.slice(0, 300)}`)
    this.name = 'VercelApiError'
  }
}

export class VercelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VercelConfigError'
  }
}

export interface VercelEnvVar {
  id: string
  key: string
  value?: string
  type: 'plain' | 'encrypted' | 'system' | 'secret' | 'sensitive'
  target: ('production' | 'preview' | 'development')[]
  configurationId?: string | null
  createdAt?: number
  updatedAt?: number
}

interface VercelEnvListResponse {
  envs: VercelEnvVar[]
  pagination?: { count: number; next: string | null }
}

interface VercelClientConfig {
  token: string
  projectId: string
  teamId: string | null
}

function readConfig(): VercelClientConfig {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID ?? null
  if (!token || !projectId) {
    throw new VercelConfigError(
      `[vercel] Missing env: ${!token ? 'VERCEL_TOKEN ' : ''}${!projectId ? 'VERCEL_PROJECT_ID' : ''}`.trim()
    )
  }
  return { token, projectId, teamId }
}

function buildUrl(path: string, cfg: VercelClientConfig): string {
  const url = new URL(`${API_BASE}${path}`)
  if (cfg.teamId) url.searchParams.set('teamId', cfg.teamId)
  return url.toString()
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = readConfig()
  const url = buildUrl(path, cfg)
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    throw new VercelApiError(res.status, path, text)
  }
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new VercelApiError(500, path, `Invalid JSON: ${text.slice(0, 200)}`)
  }
}

/**
 * List every env var in the project. Returns a flat array; the
 * caller should filter by `target` and `key` themselves so we
 * don't bury the pagination semantics inside this module.
 *
 * Vercel paginates at 100. For our 25-ish envs, one page is
 * always enough — but we fetch up to 5 pages defensively in case
 * the project grows.
 */
export async function listEnvs(): Promise<VercelEnvVar[]> {
  const all: VercelEnvVar[] = []
  let after: string | null = null
  for (let page = 0; page < 5; page++) {
    const path: string =
      `/v9/projects/${readConfig().projectId}/env?decrypt=false&limit=100` +
      (after ? `&until=${encodeURIComponent(after)}` : '')
    const res = await call<VercelEnvListResponse>('GET', path)
    all.push(...res.envs)
    after = res.pagination?.next ?? null
    if (!after) break
  }
  return all
}

/**
 * Find a specific env var by key + target. Vercel allows multiple
 * envs with the same key on different targets (production /
 * preview / development). We always rotate against the production
 * variant unless `target` is specified explicitly.
 */
export async function findEnv(
  key: string,
  target: 'production' | 'preview' | 'development' = 'production'
): Promise<VercelEnvVar | null> {
  const all = await listEnvs()
  return (
    all.find((e) => e.key === key && Array.isArray(e.target) && e.target.includes(target)) ?? null
  )
}

/**
 * Patch the value of an existing env var. Vercel internally
 * versions the env so a redeploy is required for new values to
 * take effect at runtime — see `triggerRedeploy()` below.
 */
export async function updateEnvValue(envId: string, newValue: string): Promise<VercelEnvVar> {
  const cfg = readConfig()
  return await call<VercelEnvVar>('PATCH', `/v9/projects/${cfg.projectId}/env/${envId}`, {
    value: newValue,
  })
}

/**
 * Convenience: lookup by key + patch. Returns the env id of the
 * patched record so the caller can include it in the rotation
 * ledger details for forensic replay.
 */
export async function rotateEnvValue(
  key: string,
  newValue: string,
  target: 'production' | 'preview' | 'development' = 'production'
): Promise<{ envId: string; previousValueFingerprint: string | null }> {
  const env = await findEnv(key, target)
  if (!env) {
    throw new VercelConfigError(`[vercel] env var "${key}" not found on target=${target}`)
  }
  const before = env.value ? fingerprint(env.value) : null
  const updated = await updateEnvValue(env.id, newValue)
  return { envId: updated.id, previousValueFingerprint: before }
}

interface DeploymentResponse {
  id: string
  url: string
  state?: string
  inspectorUrl?: string
}

/**
 * Trigger a redeploy of the current production HEAD. We don't
 * supply files — the Deployment API picks up the latest commit
 * from the linked git repo and `target: production` promotes it
 * straight to prod. Same effect as clicking "Redeploy" in the
 * Vercel dashboard.
 *
 * Why redeploy instead of just patching env? Vercel only injects
 * env values into NEW deployments; existing serverless functions
 * keep the OLD value in memory until they are torn down. A fresh
 * deployment is the one mechanism that guarantees the new value
 * reaches every cold start within ~2 minutes.
 */
export async function triggerRedeploy(reason: string): Promise<DeploymentResponse> {
  const cfg = readConfig()
  return await call<DeploymentResponse>('POST', `/v13/deployments`, {
    name: cfg.projectId,
    project: cfg.projectId,
    target: 'production',
    meta: {
      'rotation-reason': reason.slice(0, 200),
      'rotation-source': 'cron:rotate-secrets',
    },
    gitSource: {
      type: 'github',
      ref: 'main',
    },
  })
}

/**
 * SHA-256 first-8-hex-chars of a value — used as a fingerprint in
 * the rotation ledger so an operator can verify "the live env
 * matches the ledger entry" without ever logging the secret.
 */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

/** Test-only handle so tests can stub the underlying call() without
 *  reaching for global fetch mocks. */
export const _internal = {
  call,
  readConfig,
}
