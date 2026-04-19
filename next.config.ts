import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

// NOTE: `Content-Security-Policy` is intentionally NOT in this static
// list. It is emitted per-request by `middleware.ts` so each response
// carries a fresh nonce — see `lib/security/csp.ts` and
// `docs/security/csp.md` (Wave Hardening II #8). Defining it here too
// would clash with the dynamic header (the static one ships first and
// the middleware overwrites, but having both is brittle).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'Origin-Agent-Cluster', value: '?1' },
]

const apiCacheHeaders = [
  { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'Expires', value: '0' },
]

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'jomdntqlgrupvhrqoyai.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/(.*)',
        headers: [...securityHeaders, ...apiCacheHeaders],
      },
      {
        source: '/.well-known/security.txt',
        headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }],
      },
    ]
  },
  async rewrites() {
    // Forward /api/v1/* → /api/* for future API versioning compatibility
    return [
      {
        source: '/api/v1/:path*',
        destination: '/api/:path*',
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Sentry org/project for source map uploads (only when SENTRY_AUTH_TOKEN is set)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? 'clinipharma',

  // Silently skip Sentry build steps when not configured (no token = no upload)
  silent: !process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps only in production CI (where SENTRY_AUTH_TOKEN is set)
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },

  // Disable the Sentry.init() auto-wrap for API routes
  // (we call Sentry.init() explicitly in sentry.*.config.ts)
  autoInstrumentServerFunctions: false,
  autoInstrumentMiddleware: false,
})
