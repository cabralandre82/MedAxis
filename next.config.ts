import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://apis.google.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://jomdntqlgrupvhrqoyai.supabase.co;
  font-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://o4510907598700544.ingest.us.sentry.io https://www.googleapis.com https://fcm.googleapis.com;
  frame-src 'none';
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
`
  .replace(/\n/g, ' ')
  .trim()

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
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
