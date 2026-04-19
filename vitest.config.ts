import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['lib/**/*.ts', 'services/**/*.ts'],
      exclude: [
        'lib/db/**',
        'lib/firebase/client.ts',
        'lib/firebase-admin.ts',
        'lib/push.ts',
        'lib/sms.ts',
        'lib/whatsapp.ts',
        'lib/asaas.ts',
        'lib/clicksign.ts',
        'lib/email/index.ts',
        'lib/email/templates.ts',
        'lib/session-logger.ts',
        // Inngest jobs require integration testing against Inngest Dev Server
        'lib/jobs/**',
        // Inngest client setup — no testable logic
        'lib/inngest.ts',
        // Uses Next.js unstable_cache — requires real Next.js runtime
        'lib/dashboard.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        // Ratchet plan: after every wave that adds ≥20 tests we lift these
        // floors toward the real measurement, so regressions are caught
        // the next PR. Real measurement at Wave Hardening III: 81.59 %
        // stmts/lines, 81.15 % branches, 89.52 % functions. We ratchet to
        // 80/80/89/80 — leaves a thin 1-2 pt margin for legitimate
        // refactors but blocks any drop below the current floor.
        // Do NOT lower — if a PR regresses, add the missing test instead.
        statements: 80,
        branches: 80,
        functions: 89,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // Stub optional packages that are not installed in the test environment.
      // These are only needed at runtime (Redis-backed rate limiter).
      '@upstash/ratelimit': resolve(__dirname, 'tests/__mocks__/@upstash/ratelimit.ts'),
      '@upstash/redis': resolve(__dirname, 'tests/__mocks__/@upstash/redis.ts'),
      // `server-only` isn't installed in the test environment — stub it so
      // modules guarded by it (lib/features, lib/ai, …) can be imported.
      'server-only': resolve(__dirname, 'tests/__mocks__/server-only.ts'),
    },
  },
})
