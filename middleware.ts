import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/db/admin'
import { checkCsrf, ensureCsrfCookie } from '@/lib/security/csrf'
import {
  buildCsp,
  buildReportToHeader,
  cspHeaderName,
  generateNonce,
  NONCE_HEADER,
} from '@/lib/security/csp'
import { incCounter, Metrics } from '@/lib/metrics'

const PUBLIC_ROUTES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/registro',
  '/auth/callback',
  '/unauthorized',
  '/api/auth/forgot-password',
  '/api/registration/submit',
  '/api/registration/draft',
  // Webhook endpoints — verified by their own secrets, no session needed
  '/api/payments/asaas/webhook',
  '/api/contracts/webhook',
  '/api/cron/',
  // Inngest serve handler — authenticated by INNGEST_SIGNING_KEY, not user session
  '/api/inngest',
  // Firebase service worker
  '/firebase-messaging-sw.js',
  // Public order tracking (no login required)
  '/track/',
  '/api/tracking',
  // Health check — intentionally public for monitoring services
  '/api/health',
  // Metrics scrape — gated by METRICS_SECRET, not user session (Wave 11)
  '/api/metrics',
  // Backup ledger ingest — gated by BACKUP_LEDGER_SECRET, called
  // only by GitHub workflows, not user session (Wave 12)
  '/api/backups/record',
  // LGPD public pages
  '/privacy',
  '/terms',
  // CSP violation report endpoint — browsers send these without
  // user credentials and they must not be redirected to /login.
  '/api/csp-report',
]

/** Extract JWT payload without verifying signature (Supabase already verified it). */
function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split('.')[1]
    if (!base64) return null
    return JSON.parse(Buffer.from(base64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** Check if the token's jti (or user sentinel) is in the revocation blacklist. */
async function checkRevocation(jti: string, userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()
    const { data } = await admin
      .from('revoked_tokens')
      .select('jti')
      .or(`jti.eq.${jti},jti.eq.user:${userId}:all`)
      .gt('expires_at', now)
      .limit(1)
    return (data?.length ?? 0) > 0
  } catch {
    // If blacklist check fails, fail open (don't block legitimate users due to DB issues)
    return false
  }
}

export async function middleware(request: NextRequest) {
  // Request correlation id: honour one propagated from an upstream LB/CDN
  // (important for end-to-end tracing when a CF Worker or similar sits in
  // front of us) otherwise mint a fresh UUID. Runs on the Edge runtime so
  // we cannot populate Node's AsyncLocalStorage here — the id is passed to
  // downstream Node handlers via the `x-request-id` *request* header, and
  // to the client via the `X-Request-ID` *response* header.
  const inboundId = request.headers.get('x-request-id')
  const isValidInbound =
    inboundId &&
    inboundId.length <= 128 &&
    // Only allow the subset that cannot break log parsers (uuid, hex, digits
    // and dashes). Anything else gets replaced to prevent log injection.
    /^[A-Za-z0-9_.:-]+$/.test(inboundId)
  const requestId = isValidInbound ? inboundId : crypto.randomUUID()

  // Wave 11 — W3C trace-context. If a CF Worker / Vercel OTEL
  // collector / upstream service already provided a valid
  // `traceparent`, we honour it and our Node handlers will
  // continue the same trace. Otherwise we mint a fresh one here
  // so the *entire* request — middleware + handler + outbound
  // fetches — shares a single trace id. The Edge runtime lacks
  // AsyncLocalStorage, so we forward via request header and
  // Node's `withRouteContext` picks it up.
  const inboundTraceparent = request.headers.get('traceparent')
  const validTraceparent =
    inboundTraceparent &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(inboundTraceparent.trim()) &&
    !/^00-0{32}-/.test(inboundTraceparent.trim()) &&
    !/-0{16}-/.test(inboundTraceparent.trim())
  const traceparent = validTraceparent
    ? inboundTraceparent!.trim().toLowerCase()
    : `00-${crypto.randomUUID().replace(/-/g, '')}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}-01`

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('traceparent', traceparent)

  // Wave Hardening II #8 — per-request CSP nonce.
  // The nonce flows in TWO directions:
  //   • request header  → consumed by SSR (`headers().get('x-nonce')`)
  //                        so server components / `<Script>` can attach
  //                        it to inline tags they emit;
  //   • response header → emitted as part of the CSP value so the
  //                        browser actually trusts those tags.
  // We mint here (Edge runtime) so every request — including 304s —
  // gets a fresh nonce. Reusing nonces across requests defeats the
  // protection, hence no caching.
  const nonce = generateNonce()
  requestHeaders.set(NONCE_HEADER, nonce)
  const cspReportOnly = process.env.CSP_REPORT_ONLY === 'true'
  const allowEval = process.env.NODE_ENV !== 'production'
  const cspValue = buildCsp({ nonce, reportOnly: cspReportOnly, allowEval })
  const cspHeader = cspHeaderName(cspReportOnly)
  const reportToValue = buildReportToHeader()

  // Helper: stamp the per-request transport headers on every response
  // we emit so they survive across the various branches below
  // (CSRF block, redirect, supabase response, …).
  const stampHeaders = (res: NextResponse): NextResponse => {
    res.headers.set('X-Request-ID', requestId)
    res.headers.set('traceparent', traceparent)
    res.headers.set(cspHeader, cspValue)
    res.headers.set('Report-To', reportToValue)
    return res
  }

  // Wave 5 — CSRF gate for state-changing /api/** calls. Webhooks, cron,
  // and Inngest are exempt (checkCsrf knows the prefix list). Origin /
  // Referer must match the request's own origin. The double-submit
  // cookie check is an extra tier enabled only when the env flag is on;
  // keeping it env-driven avoids a middleware-time DB round-trip.
  const enforceDoubleSubmit = process.env.CSRF_ENFORCE_DOUBLE_SUBMIT === 'true'
  const csrf = checkCsrf(request, { enforceDoubleSubmit })
  if (!csrf.ok) {
    const isUnsafeApi = request.method !== 'GET' && request.nextUrl.pathname.startsWith('/api/')
    if (isUnsafeApi) {
      // Wave 6 — count blocks so the deep health endpoint + alerts
      // rule can spot a surge. `reason` keeps the label cardinality
      // bounded (there are ~5 possible values).
      incCounter(Metrics.CSRF_BLOCKED_TOTAL, { reason: csrf.reason ?? 'csrf_blocked' })
      // Only block API calls — a redirect-to-login response on a JSON
      // endpoint would look like a success from an HTTP client.
      return stampHeaders(
        NextResponse.json(
          { error: 'csrf_blocked', reason: csrf.reason ?? 'csrf_blocked' },
          { status: 403 }
        )
      )
    }
  }

  let supabaseResponse = stampHeaders(NextResponse.next({ request: { headers: requestHeaders } }))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = stampHeaders(
            NextResponse.next({ request: { headers: requestHeaders } })
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Get the raw session to extract the access token for revocation check
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token

  const { pathname } = request.nextUrl
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  if (!user && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return stampHeaders(NextResponse.redirect(loginUrl))
  }

  if (user && pathname === '/login') {
    return stampHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
  }

  // Token revocation check — only for authenticated requests on protected routes
  if (user && accessToken && !isPublicRoute) {
    const payload = parseJwtPayload(accessToken)
    const jti = (payload?.jti as string) ?? `fallback:${user.id}`

    const revoked = await checkRevocation(jti, user.id)
    if (revoked) {
      // Clear the session cookie and redirect to login
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('reason', 'session_revoked')
      const redirectResponse = stampHeaders(NextResponse.redirect(loginUrl))
      // Clear Supabase auth cookies
      request.cookies.getAll().forEach(({ name }) => {
        if (name.startsWith('sb-')) redirectResponse.cookies.delete(name)
      })
      return redirectResponse
    }
  }

  // Wave 5 — prime the CSRF cookie on safe navigations so the browser
  // has it ready when a form eventually POSTs. Only set on GET page
  // loads (not on API GETs) to keep the cookie surface small.
  if (request.method === 'GET' && !pathname.startsWith('/api/')) {
    ensureCsrfCookie(request, supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
