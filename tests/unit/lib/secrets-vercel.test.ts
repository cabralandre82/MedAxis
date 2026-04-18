// @vitest-environment node
/**
 * Unit tests for `lib/secrets/vercel.ts` (Wave 15).
 *
 * We mock global `fetch` and assert:
 *
 *   - `readConfig()` throws `VercelConfigError` when env vars missing.
 *   - `listEnvs()` paginates correctly (stops on missing `next`).
 *   - `findEnv()` filters by key + target.
 *   - `rotateEnvValue()` does GET → PATCH and returns env id +
 *     previous fingerprint.
 *   - `triggerRedeploy()` POSTs to `/v13/deployments` with `target=production`
 *     and a `gitSource.ref=main`.
 *   - `fingerprint()` is deterministic 8-char hex.
 *   - HTTP errors raise `VercelApiError` with status, endpoint, body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VERCEL_TOKEN', 'tok_test')
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test')
  vi.stubEnv('VERCEL_TEAM_ID', 'team_test')
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllEnvs()
})

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('VercelConfigError', () => {
  // `vi.stubEnv('X', '')` sets the env to empty string which the
  // module's `if (!token)` truthy check treats as missing — this is
  // the only reliable way to "unset" an env across vitest helpers
  // when a .env file has already populated process.env.
  it('readConfig throws when VERCEL_TOKEN missing', async () => {
    vi.stubEnv('VERCEL_TOKEN', '')
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_x')
    const mod = await import('@/lib/secrets/vercel')
    expect(() => mod._internal.readConfig()).toThrow(mod.VercelConfigError)
  })

  it('readConfig throws when VERCEL_PROJECT_ID missing', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok_x')
    vi.stubEnv('VERCEL_PROJECT_ID', '')
    const mod = await import('@/lib/secrets/vercel')
    expect(() => mod._internal.readConfig()).toThrow(/VERCEL_PROJECT_ID/)
  })

  it('readConfig accepts missing teamId (personal account)', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok_x')
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_x')
    vi.stubEnv('VERCEL_TEAM_ID', '')
    const mod = await import('@/lib/secrets/vercel')
    const cfg = mod._internal.readConfig()
    // Either null or '' is acceptable — `buildUrl()` treats both as
    // "no team" because the truthy check on `cfg.teamId` skips the
    // query param either way.
    expect(cfg.teamId == null || cfg.teamId === '').toBe(true)
  })
})

describe('listEnvs / findEnv', () => {
  it('attaches teamId as query param + Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ envs: [], pagination: null }))
    const { listEnvs } = await import('@/lib/secrets/vercel')
    await listEnvs()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('teamId=team_test')
    expect(String(url)).toContain('/v9/projects/prj_test/env')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok_test',
    })
  })

  it('paginates through `pagination.next` until null', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResp({
          envs: [{ id: '1', key: 'A', type: 'encrypted', target: ['production'] }],
          pagination: { count: 1, next: 'cursor1' },
        })
      )
      .mockResolvedValueOnce(
        jsonResp({
          envs: [{ id: '2', key: 'B', type: 'encrypted', target: ['production'] }],
          pagination: { count: 1, next: null },
        })
      )
    const { listEnvs } = await import('@/lib/secrets/vercel')
    const envs = await listEnvs()
    expect(envs).toHaveLength(2)
    expect(envs.map((e) => e.key)).toEqual(['A', 'B'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = String(fetchMock.mock.calls[1][0])
    expect(secondCall).toContain('until=cursor1')
  })

  it('findEnv returns the matching env on the requested target only', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResp({
        envs: [
          { id: 'e1', key: 'API_KEY', type: 'encrypted', target: ['preview'] },
          { id: 'e2', key: 'API_KEY', type: 'encrypted', target: ['production'] },
          { id: 'e3', key: 'OTHER', type: 'encrypted', target: ['production'] },
        ],
        pagination: null,
      })
    )
    const { findEnv } = await import('@/lib/secrets/vercel')
    const env = await findEnv('API_KEY', 'production')
    expect(env?.id).toBe('e2')
  })

  it('findEnv returns null when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ envs: [], pagination: null }))
    const { findEnv } = await import('@/lib/secrets/vercel')
    const env = await findEnv('UNKNOWN')
    expect(env).toBeNull()
  })
})

describe('rotateEnvValue', () => {
  it('does GET → PATCH and returns env id + previous fingerprint', async () => {
    fetchMock
      // GET /env (listEnvs)
      .mockResolvedValueOnce(
        jsonResp({
          envs: [
            {
              id: 'env_old',
              key: 'CRON_SECRET',
              value: 'oldvalue',
              type: 'encrypted',
              target: ['production'],
            },
          ],
          pagination: null,
        })
      )
      // PATCH /env/:id
      .mockResolvedValueOnce(
        jsonResp({ id: 'env_old', key: 'CRON_SECRET', type: 'encrypted', target: ['production'] })
      )

    const { rotateEnvValue, fingerprint } = await import('@/lib/secrets/vercel')
    const out = await rotateEnvValue('CRON_SECRET', 'newvalue')
    expect(out.envId).toBe('env_old')
    expect(out.previousValueFingerprint).toBe(fingerprint('oldvalue'))

    const patchCall = fetchMock.mock.calls[1]
    const [url, init] = patchCall
    expect(String(url)).toContain('/v9/projects/prj_test/env/env_old')
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ value: 'newvalue' })
  })

  it('throws VercelConfigError when env not found on target', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ envs: [], pagination: null }))
    const { rotateEnvValue, VercelConfigError } = await import('@/lib/secrets/vercel')
    await expect(rotateEnvValue('NOT_THERE', 'v')).rejects.toBeInstanceOf(VercelConfigError)
  })

  it('propagates VercelApiError with status, endpoint, body on PATCH 4xx', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResp({
          envs: [
            {
              id: 'env_x',
              key: 'CRON_SECRET',
              type: 'encrypted',
              target: ['production'],
            },
          ],
          pagination: null,
        })
      )
      .mockResolvedValueOnce(new Response('forbidden detail', { status: 403 }))
    const { rotateEnvValue, VercelApiError } = await import('@/lib/secrets/vercel')
    try {
      await rotateEnvValue('CRON_SECRET', 'new')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(VercelApiError)
      const e = err as InstanceType<typeof VercelApiError>
      expect(e.status).toBe(403)
      expect(e.endpoint).toContain('/env/env_x')
      expect(e.body).toContain('forbidden')
    }
  })
})

describe('triggerRedeploy', () => {
  it('POSTs to /v13/deployments with target=production + gitSource main', async () => {
    fetchMock.mockResolvedValueOnce(jsonResp({ id: 'dpl_xyz', url: 'preview.vercel.app' }))
    const { triggerRedeploy } = await import('@/lib/secrets/vercel')
    const out = await triggerRedeploy('Wave 15 — auto-rotation')
    expect(out.id).toBe('dpl_xyz')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v13/deployments')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.target).toBe('production')
    expect(body.gitSource).toEqual({ type: 'github', ref: 'main' })
    expect(body.meta['rotation-source']).toBe('cron:rotate-secrets')
    expect(body.meta['rotation-reason']).toContain('Wave 15')
  })
})

describe('fingerprint', () => {
  it('returns deterministic 8-char lowercase hex', async () => {
    const { fingerprint } = await import('@/lib/secrets/vercel')
    const a = fingerprint('hello-world')
    expect(a).toMatch(/^[a-f0-9]{8}$/)
    expect(fingerprint('hello-world')).toBe(a)
    expect(fingerprint('hello-world!')).not.toBe(a)
  })
})
