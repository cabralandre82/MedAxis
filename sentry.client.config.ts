import * as Sentry from '@sentry/nextjs'

/**
 * Sentry client configuration.
 * Active only when NEXT_PUBLIC_SENTRY_DSN is set.
 * No-op in development or when DSN is missing.
 *
 * To activate:
 *   1. Create a project at https://sentry.io
 *   2. Add to Vercel env vars:
 *      NEXT_PUBLIC_SENTRY_DSN=https://xxx@oyyy.ingest.sentry.io/zzz
 *      SENTRY_ORG=your-org
 *      SENTRY_PROJECT=clinipharma
 *   3. Run: npx @sentry/wizard@latest -i nextjs
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only initialize when DSN is present
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring — 10% sampling in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,

  // Don't send errors from localhost
  beforeSend(event) {
    if (process.env.NODE_ENV !== 'production') return null
    return event
  },

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      // Only replay on errors, not all sessions
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Capture Replay for 0% of sessions, 100% of errors
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
})
