/**
 * Cross-tenant RLS — E2E warn-only (T1 do pre-mortem hardening).
 *
 * Complementa, **não substitui**, o canário SQL diário em
 * `/api/cron/rls-canary` (mig 055). O canário SQL roda direto contra
 * PostgREST com JWT forjado e prova que `SELECT count(*) FROM <t>`
 * retorna 0 para um sujeito não-afiliado. Esse teste cobre
 * regressões de RLS nessa camada.
 *
 * O que ele NÃO cobre — e este E2E sim:
 *
 *   1. **Bypass na camada de aplicação**: rota usa `createAdminClient()`
 *      (BYPASSRLS) e esquece de validar membership. RLS no banco
 *      continua "ok", mas a API vaza dados.
 *   2. **Path traversal de UUID**: rota `/api/.../[id]` aceita qualquer
 *      UUID e renderiza dados de outro tenant via JOIN não-coberto.
 *   3. **Cookie/CSRF holes** que exponham dados privados sem auth.
 *
 * Política de findings
 * --------------------
 * Por default, qualquer suspeita vira **warn** (annotation no HTML
 * report + console.warn). Não derruba CI. Para virar hard-fail
 * (regressão = build vermelho), exporte `E2E_RLS_HARD_FAIL=true`.
 *
 * Quando virar comercial, ligar hard-fail é o gate. Hoje,
 * permanecemos em warn-only para evitar falsos positivos durante
 * a estabilização (ex: rota recém-criada com fixture de tenant
 * ainda inexistente).
 *
 * Quando 2 credenciais clinic estiverem disponíveis (CI secrets
 * `E2E_CLINIC_A_*` e `E2E_CLINIC_B_*`), a Parte C (cross-session
 * real) destrava automaticamente.
 *
 * READ-ONLY. Sem mutations, sem Asaas, sem Inngest.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { hasAuthSession } from './_helpers/auth-status'
import { recordFinding, annotateRlsMode, isHardFail } from './_helpers/rls-findings'

const HAS_AUTH = hasAuthSession()

/** UUID válido formato-RFC mas que jamais aparece no banco. */
const RANDOM_UUID = '99999999-9999-4999-8999-999999999999'
/** UUID malformado para testar 400 vs 200. */
const MALFORMED_ID = 'not-a-uuid'

/* ─────────────────────────────────────────────────────────────────────
 * Parte A — anon baseline (sem cookies de sessão)
 *
 * Endpoints que exigem auth devem rejeitar anônimo com:
 *   - 401/403 (resposta do próprio handler)            → OK
 *   - 307 + location:/login (middleware redireciona)   → OK
 *
 * 200 com payload concreto = vazamento (forceHard).
 *
 * IMPORTANTE: chamadas usam `maxRedirects: 0` para ver o status original.
 * Sem isso, o Playwright segue o 307 do middleware até `/login` e
 * recebe 200 com HTML — gera falso positivo `200-empty-payload`.
 * Validado contra prod 2026-05-07: middleware emite 307 location:/login
 * para todas as 6 rotas anon; helper precisa enxergar isso como OK.
 * ───────────────────────────────────────────────────────────────────── */
test.describe('RLS warn-only — Parte A: anonymous baseline', () => {
  // Limpa storageState herdado do projeto chromium (que injeta o
  // super-admin.json). Aqui simulamos request sem credencial.
  test.use({ storageState: { cookies: [], origins: [] } })

  // Opções padrão dos requests: NÃO seguir redirects (queremos ver 307
  // do middleware como sinal positivo, não chegar HTML do login com 200).
  const NO_REDIRECT = { maxRedirects: 0 } as const

  test('A1: GET /api/coupons/mine sem cookies → 401 ou 307→/login', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get('/api/coupons/mine', NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-coupons-mine', testInfo, 'coupons')
  })

  test('A2: GET /api/sessions sem cookies → 401 ou 307→/login', async ({ request }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get('/api/sessions', NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-sessions', testInfo)
  })

  test('A3: GET /api/profile/notification-preferences sem cookies → 401 ou 307→/login', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get('/api/profile/notification-preferences', NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-notification-prefs', testInfo)
  })

  test('A4: GET /api/admin/coupons sem cookies → 401/403 ou 307→/login', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get('/api/admin/coupons', NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-admin-coupons', testInfo, 'coupons', {
      allowed: [401, 403, 404, 405],
    })
  })

  test('A5: GET /api/admin/legal-hold/list sem cookies → 401/403 ou 307→/login', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get('/api/admin/legal-hold/list', NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-legal-hold-list', testInfo, undefined, {
      allowed: [401, 403, 404, 405],
    })
  })

  test('A6: GET /api/orders/[random-uuid]/prescription-state sem cookies → 401/403 ou 307→/login', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get(`/api/orders/${RANDOM_UUID}/prescription-state`, NO_REDIRECT)
    await assertNoAnonLeak(res, 'anon-prescription-state', testInfo, undefined, {
      allowed: [401, 403, 404],
    })
  })
})

/* ─────────────────────────────────────────────────────────────────────
 * Parte B — UUID forjado autenticado como SUPER_ADMIN
 *
 * SUPER_ADMIN tem visão global por design (RBAC). Se passar UUID
 * inexistente, esperamos 404 — NÃO 200 (com dados aleatórios).
 * Esse caso pega regressões onde a rota faz `.single()` e devolve
 * dados sem checar se a row existe.
 * ───────────────────────────────────────────────────────────────────── */
test.describe('RLS warn-only — Parte B: UUID forjado (super-admin)', () => {
  test.skip(!HAS_AUTH, 'sessão super-admin indisponível — pulando')

  test('B1: GET /api/orders/[random-uuid]/prescription-state → 404, nunca 200/5xx', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get(`/api/orders/${RANDOM_UUID}/prescription-state`)
    await assertForgedUuidIs404(res, 'forged-prescription-state', testInfo)
  })

  test('B2: GET /api/products/[random-uuid]/recommendations → 200 ok:false / 404, nunca 5xx', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get(`/api/products/${RANDOM_UUID}/recommendations`)
    // Esse endpoint pode retornar 200 com payload vazio (recommendations: [])
    // pra UUID inexistente — comportamento aceitável. O que NÃO pode é 5xx
    // ou 200 com dados não-relacionados. Aceitamos qualquer 2xx/4xx; só
    // alertamos se 5xx (regressão) ou 200 com array enorme.
    if (res.status() >= 500) {
      recordFinding(testInfo, {
        id: 'forged-product-recommendations-5xx',
        description: `5xx em /api/products/<random-uuid>/recommendations — endpoint deveria devolver vazio ou 404`,
        status: res.status(),
      })
    } else if (res.status() === 200) {
      const body = (await res.json().catch(() => null)) as { recommendations?: unknown[] } | null
      const count = Array.isArray(body?.recommendations) ? body!.recommendations!.length : 0
      if (count > 50) {
        // Heurística: para um produto inexistente, recomendações
        // legítimas seriam 0. > 50 sugere vazamento global.
        recordFinding(testInfo, {
          id: 'forged-product-recommendations-leak',
          description: `recommendations enorme (${count}) para UUID inexistente — possível bypass de filtro`,
          status: res.status(),
          details: { count },
        })
      }
    }
    expect(res.status()).toBeLessThan(500)
  })

  test('B3: GET /api/orders/[malformed]/prescription-state → 4xx, nunca 5xx', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get(`/api/orders/${MALFORMED_ID}/prescription-state`)
    if (res.status() >= 500) {
      recordFinding(testInfo, {
        id: 'malformed-prescription-state-5xx',
        description: `5xx em /api/orders/<malformed>/prescription-state — endpoint deveria validar UUID e retornar 4xx`,
        status: res.status(),
      })
    }
    expect(res.status()).toBeLessThan(500)
  })

  test('B4: GET /api/registration/[random-uuid] → 404 ou 403, nunca 200', async ({
    request,
  }, testInfo) => {
    annotateRlsMode(testInfo)
    const res = await request.get(`/api/registration/${RANDOM_UUID}`)
    if (res.status() === 200) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      // 200 com payload concreto = vazamento (registro de outro tenant).
      // Aceitamos 200 só se o body for explicitamente "not found" (raro).
      const looksLikeNotFound =
        !!body &&
        ((body.error as string | undefined)?.toLowerCase?.().includes('not') ||
          body.id === undefined)
      if (!looksLikeNotFound) {
        recordFinding(
          testInfo,
          {
            id: 'forged-registration-leak',
            description: `200 com payload em /api/registration/<random-uuid> — possível leak de registro alheio`,
            status: res.status(),
            details: {
              keys: body ? Object.keys(body).slice(0, 10) : [],
            },
          },
          { forceHard: true } // payload concreto = leak severo, hard.
        )
      }
    } else {
      expect([401, 403, 404, 422]).toContain(res.status())
    }
  })
})

/* ─────────────────────────────────────────────────────────────────────
 * Parte C — cross-session real (clinic A vs clinic B)
 *
 * Quando os dois conjuntos de credenciais estiverem em CI:
 *   - E2E_CLINIC_A_EMAIL / E2E_CLINIC_A_PASSWORD
 *   - E2E_CLINIC_B_EMAIL / E2E_CLINIC_B_PASSWORD
 *
 * o teste:
 *   1. Loga como A, lista pedidos próprios, captura 1 ID de pedido.
 *   2. Loga como B (descarta cookies de A).
 *   3. GET /api/orders/<id-de-A>/prescription-state como B → DEVE 403/404.
 *
 * Por hora, com credenciais ausentes, o test PULA com `test.skip()`.
 * Assim que provisionarmos as duas tenants de teste, este bloco
 * destrava automaticamente sem mudança de código.
 * ───────────────────────────────────────────────────────────────────── */
test.describe('RLS warn-only — Parte C: cross-session clinic A → clinic B', () => {
  const A_EMAIL = process.env.E2E_CLINIC_A_EMAIL
  const A_PASSWORD = process.env.E2E_CLINIC_A_PASSWORD
  const B_EMAIL = process.env.E2E_CLINIC_B_EMAIL
  const B_PASSWORD = process.env.E2E_CLINIC_B_PASSWORD
  const HAS_BOTH = !!A_EMAIL && !!A_PASSWORD && !!B_EMAIL && !!B_PASSWORD

  test.skip(
    !HAS_BOTH,
    'credenciais E2E_CLINIC_A_* / E2E_CLINIC_B_* não fornecidas — pulando cross-session real'
  )

  // Sem storageState — cada teste loga do zero.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('C1: clinic-B não consegue ler pedido de clinic-A via /prescription-state', async ({
    page,
    browser,
  }, testInfo) => {
    annotateRlsMode(testInfo)

    // 1) Loga como A.
    await loginAs(page, A_EMAIL!, A_PASSWORD!)

    // 2) Captura um id de pedido de A. /pedidos é a rota interna do
    //    portal cliente; a anchor `a[href^="/pedidos/"]` carrega o id.
    await page.goto('/pedidos')
    const aOrderHrefs = await page
      .locator('a[href^="/pedidos/"]')
      .evaluateAll((els) =>
        els
          .map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')
          .filter((h) => /^\/pedidos\/[0-9a-f-]{36}/i.test(h))
      )
    if (aOrderHrefs.length === 0) {
      test.skip(true, 'clinic-A não tem pedidos visíveis — não dá pra testar cross-session')
      return
    }
    const aOrderId = aOrderHrefs[0].split('/')[2]
    expect(aOrderId).toMatch(/^[0-9a-f-]{36}$/i)

    // 3) Abre contexto LIMPO e loga como B.
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await loginAs(pageB, B_EMAIL!, B_PASSWORD!)

    // 4) Tenta ler pedido de A como B.
    const reqB: APIRequestContext = ctxB.request
    const res = await reqB.get(`/api/orders/${aOrderId}/prescription-state`)

    if (res.status() === 200) {
      const body = await res.json().catch(() => null)
      recordFinding(
        testInfo,
        {
          id: 'cross-session-prescription-state-leak',
          description: `clinic-B leu /api/orders/${aOrderId}/prescription-state (pedido de clinic-A)`,
          status: res.status(),
          details: { responseKeys: body ? Object.keys(body).slice(0, 10) : [] },
        },
        { forceHard: true } // cross-tenant data leak = sempre hard.
      )
    } else {
      // 401/403/404 são todos OK.
      expect([401, 403, 404]).toContain(res.status())
    }

    await ctxB.close()
  })
})

/* ─────────────────────────────────────────────────────────────────────
 * Helpers internos
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Helper compartilhado das checagens da Parte A. Uma resposta é
 * "limpa" se for:
 *   - 401/403 (handler explicitamente rejeita anônimo)
 *   - 307 + `location: /login...` (middleware redireciona — convenção
 *     do Next.js middleware do Clinipharma; validado contra prod 2026-05-07)
 *   - 204/empty
 *
 * Findings:
 *   - 200 com array de itens → hard (vazamento real).
 *   - 200 com payload concreto (>1 key) → hard (vazamento provável).
 *   - 200 com array vazio → warn (RLS protegeu, mas status code estranho).
 *   - 200 com body vazio/null/HTML → warn (provavelmente HTML de redirect
 *     seguido — chamador deveria ter passado `maxRedirects: 0`).
 *   - 5xx → warn (handler não trata sessão ausente como 4xx).
 *   - 307 sem location:/login → warn (redirect inesperado).
 */
async function assertNoAnonLeak(
  res: import('@playwright/test').APIResponse,
  id: string,
  testInfo: import('@playwright/test').TestInfo,
  arrayKey?: string,
  opts: { allowed?: number[] } = {}
): Promise<void> {
  const allowed = opts.allowed ?? [401, 403]

  if (allowed.includes(res.status())) {
    // OK — endpoint rejeitou anônimo como esperado.
    return
  }

  // 307/308 + location:/login = middleware redirecionou para auth.
  // Comportamento defensivo correto para rotas que requerem sessão.
  if (res.status() === 307 || res.status() === 308) {
    const location = res.headers()['location'] ?? ''
    if (/^\/login(?:\?|$)/.test(location) || /\/login(?:\?|$)/.test(location)) {
      // OK — middleware fez seu trabalho.
      return
    }
    // Redirect para algo que não é /login: anota mas não fail.
    recordFinding(testInfo, {
      id: `${id}-redirect-non-login`,
      description: `${res.status()} redirect em request anônimo, mas location não aponta para /login`,
      status: res.status(),
      details: { location: location.slice(0, 200) },
    })
    return
  }

  if (res.status() >= 500) {
    const bodyText = await safeBodyTrunc(res)
    recordFinding(testInfo, {
      id: `${id}-5xx`,
      description: `5xx em request anônimo — endpoint não trata sessão ausente como erro do cliente`,
      status: res.status(),
      details: { bodyTrunc: bodyText },
    })
    return
  }

  if (res.status() === 200) {
    const contentType = (res.headers()['content-type'] ?? '').toLowerCase()
    const isHtml = contentType.includes('text/html')

    // 200 com HTML é quase sempre redirect seguido (login page renderizada).
    // Não é vazamento — é falha de configuração do test (deveria usar
    // maxRedirects: 0). Anota como warn com hint de fix.
    if (isHtml) {
      recordFinding(testInfo, {
        id: `${id}-200-html`,
        description: `200 text/html em request anônimo — provavelmente o request seguiu redirect 307→/login. Use maxRedirects: 0 para ver o 307 original.`,
        status: res.status(),
        details: { contentType },
      })
      return
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const arr =
      arrayKey && body && Array.isArray(body[arrayKey]) ? (body[arrayKey] as unknown[]) : null
    const arrLen = arr?.length ?? null

    if (arrLen !== null) {
      if (arrLen === 0) {
        recordFinding(testInfo, {
          id: `${id}-200-empty`,
          description: `200 com [] em request anônimo — esperado 401, mas RLS protegeu`,
          status: res.status(),
        })
        return
      }
      recordFinding(
        testInfo,
        {
          id: `${id}-200-leak`,
          description: `200 com ${arrLen} itens em request anônimo — vazamento real`,
          status: res.status(),
          details: { count: arrLen },
        },
        { forceHard: true }
      )
      return
    }

    if (body && Object.keys(body).length > 1) {
      recordFinding(
        testInfo,
        {
          id: `${id}-200-payload`,
          description: `200 com payload em request anônimo (sem ${arrayKey ?? 'array esperado'})`,
          status: res.status(),
          details: { keys: Object.keys(body).slice(0, 10) },
        },
        { forceHard: true }
      )
      return
    }

    const bodyText = await safeBodyTrunc(res)
    recordFinding(testInfo, {
      id: `${id}-200-empty-payload`,
      description: `200 com payload vazio em request anônimo — esperado 401 ou 307→/login`,
      status: res.status(),
      details: { contentType, bodyTrunc: bodyText },
    })
    return
  }

  // Outros 4xx (ex: 429) — log informativo, não fail.
  recordFinding(testInfo, {
    id: `${id}-unexpected-status`,
    description: `status inesperado em request anônimo: ${res.status()}`,
    status: res.status(),
  })
}

/** Lê body como texto e trunca em 200 chars. Falha silenciosa devolve ''. */
async function safeBodyTrunc(res: import('@playwright/test').APIResponse): Promise<string> {
  try {
    const txt = await res.text()
    return txt.slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Para super-admin com UUID inexistente, esperamos 404. 200 com row
 * = bug (rota usa .single() sem checar) — finding HARD por ser
 * fundação de RLS path-traversal.
 */
async function assertForgedUuidIs404(
  res: import('@playwright/test').APIResponse,
  id: string,
  testInfo: import('@playwright/test').TestInfo
): Promise<void> {
  if (res.status() === 404) return

  if (res.status() >= 500) {
    const bodyText = await safeBodyTrunc(res)
    recordFinding(testInfo, {
      id: `${id}-5xx`,
      description: `5xx em UUID inexistente — endpoint deveria devolver 404`,
      status: res.status(),
      details: { bodyTrunc: bodyText },
    })
    return
  }

  if (res.status() === 200) {
    const contentType = (res.headers()['content-type'] ?? '').toLowerCase()
    // 200 text/html = sessão expirada, redirect→login, etc. Não path-traversal.
    if (contentType.includes('text/html')) {
      recordFinding(testInfo, {
        id: `${id}-200-html`,
        description: `200 text/html em UUID inexistente — provavelmente sessão expirou e middleware redirecionou`,
        status: res.status(),
        details: { contentType },
      })
      return
    }
    recordFinding(
      testInfo,
      {
        id: `${id}-200`,
        description: `200 em UUID inexistente — possível path-traversal / .single() sem guard`,
        status: res.status(),
      },
      { forceHard: true }
    )
    return
  }

  // 307→login = sessão expirou no meio da run. Anota mas não fail.
  if (res.status() === 307 || res.status() === 308) {
    recordFinding(testInfo, {
      id: `${id}-redirect`,
      description: `${res.status()} redirect em UUID inexistente — sessão super-admin pode ter expirado`,
      status: res.status(),
    })
    return
  }

  // 401/403 também aceitáveis (alguns endpoints checam membership antes
  // do lookup). Não anotamos para evitar ruído.
  if ([401, 403].includes(res.status())) {
    return
  }

  recordFinding(testInfo, {
    id: `${id}-unexpected-status`,
    description: `status inesperado para UUID inexistente: ${res.status()}`,
    status: res.status(),
  })
}

/**
 * Login programático via /login com selectors id-based (mesma estratégia
 * do `auth.setup.ts`). Falha se não conseguir chegar a /dashboard|/admin
 * em 15s.
 */
async function loginAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/login', { timeout: 30_000 })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /^entrar$/i }).click()
  await page.waitForURL(/\/dashboard|\/admin|\/pedidos|\/catalog/, { timeout: 15_000 })
}

// Sentinel para garantir que `isHardFail()` não vire dead-code (eslint).
test('mode sentinel — isHardFail() é leitura segura', () => {
  expect(typeof isHardFail()).toBe('boolean')
})
