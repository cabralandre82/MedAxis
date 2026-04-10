import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

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
