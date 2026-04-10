import * as Sentry from '@sentry/nextjs'

/**
 * Sentry server-side configuration.
 * Captures unhandled errors in Server Actions, Route Handlers, and middleware.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 10% performance sampling in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,

  // Enrich errors with deployment context
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version,
})
